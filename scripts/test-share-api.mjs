#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "test-token";
const SITE_URL = "https://ffffhx.github.io/codex-snapshots/";
const PUBLIC_API_URL = "https://snapshots.example.com";
const FIXED_SHARE_ID = "snap_testshare1234567890";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-snapshots-share-test-"));
let serverProcess;

try {
  const port = await getFreePort();
  const localApiUrl = `http://127.0.0.1:${port}`;
  const dataFile = path.join(tempDir, "shares.json");

  serverProcess = spawn(process.execPath, ["server/share-api.mjs", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      SNAPSHOT_SHARE_TOKEN: TOKEN,
      SNAPSHOT_SHARE_DATA_FILE: dataFile,
      SNAPSHOT_SHARE_SITE_URL: SITE_URL,
      SNAPSHOT_SHARE_PUBLIC_API_URL: PUBLIC_API_URL,
      SNAPSHOT_SHARE_VIEWER_PATH: "/share/",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = collectChildOutput(serverProcess);
  await waitForHealth(localApiUrl, output);

  await assertInitialHealth(localApiUrl);
  await assertCorsHeaders(localApiUrl);
  await assertUnauthorizedPublish(localApiUrl);
  await assertPublish(localApiUrl);
  await assertPublicList(localApiUrl, 1);
  await assertShareDetail(localApiUrl, FIXED_SHARE_ID);
  await assertVerifyScriptReadOnly(localApiUrl);
  await assertPublicList(localApiUrl, 1);
  await assertVerifyScriptPublish(localApiUrl);
  await assertPublicList(localApiUrl, 2);
  await assertLocalViewerPublish(localApiUrl);
  await assertPublicList(localApiUrl, 3);

  console.log("✓ share API integration checks passed");
} finally {
  await stopChild(serverProcess);
  await rm(tempDir, { recursive: true, force: true });
}

async function assertInitialHealth(apiUrl) {
  const payload = await fetchJson(`${apiUrl}/api/snapshots/health`);
  assert(payload.ok === true, "health should return ok=true");
  assert(payload.shares === 0, `initial share count should be 0, got ${payload.shares}`);
  assert(!Object.hasOwn(payload, "storage"), "public health endpoint should not expose the server storage path");

  const rootHealth = await fetchJson(`${apiUrl}/health`);
  assert(rootHealth.ok === true, "root health should return ok=true");
  assert(!Object.hasOwn(rootHealth, "storage"), "root health endpoint should not expose the server storage path");
}

async function assertCorsHeaders(apiUrl) {
  const getResponse = await fetch(`${apiUrl}/api/snapshots`, {
    headers: {
      origin: SITE_URL.replace(/\/+$/, ""),
    },
  });

  assert(getResponse.ok, `cross-origin public list should return ok, got ${getResponse.status}`);
  assert(getResponse.headers.get("access-control-allow-origin") === "*", "public list should allow cross-origin reads");

  const optionsResponse = await fetch(`${apiUrl}/api/snapshots`, {
    method: "OPTIONS",
    headers: {
      "access-control-request-headers": "authorization,content-type",
      "access-control-request-method": "POST",
      origin: SITE_URL.replace(/\/+$/, ""),
    },
  });

  assert(optionsResponse.status === 204, `CORS preflight should return 204, got ${optionsResponse.status}`);
  assert(optionsResponse.headers.get("access-control-allow-origin") === "*", "CORS preflight should allow the public site origin");
  assert(
    String(optionsResponse.headers.get("access-control-allow-methods") || "").includes("OPTIONS"),
    "CORS preflight should include OPTIONS in allowed methods"
  );
  assert(
    String(optionsResponse.headers.get("access-control-allow-headers") || "").includes("authorization"),
    "CORS preflight should allow authorization header"
  );
}

async function assertUnauthorizedPublish(apiUrl) {
  const response = await fetch(`${apiUrl}/api/snapshots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshot: createSnapshot("Unauthorized snapshot") }),
  });
  assert(response.status === 401, `unauthorized publish should return 401, got ${response.status}`);
}

async function assertPublish(apiUrl) {
  const payload = await fetchJson(`${apiUrl}/api/snapshots`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      shareId: FIXED_SHARE_ID,
      apiUrl: PUBLIC_API_URL,
      siteUrl: SITE_URL,
      snapshot: createSnapshot("Public Session from integration test"),
    }),
  });

  assert(payload.ok === true, `publish should return ok=true: ${JSON.stringify(payload)}`);
  assert(payload.id === FIXED_SHARE_ID, `publish should preserve share id: ${payload.id}`);

  const url = new URL(payload.url);
  assert(url.origin === new URL(SITE_URL).origin, `share URL should use site origin: ${payload.url}`);
  assert(url.pathname === "/codex-snapshots/share/", `share URL should use GitHub Pages share path: ${payload.url}`);
  assert(url.searchParams.get("id") === FIXED_SHARE_ID, `share URL should include id: ${payload.url}`);
  assert(url.searchParams.get("api") === PUBLIC_API_URL, `share URL should include public API URL: ${payload.url}`);
}

async function assertPublicList(apiUrl, expectedTotal) {
  const payload = await fetchJson(`${apiUrl}/api/snapshots?limit=12`);
  assert(Array.isArray(payload.shares), "list endpoint should return shares array");
  assert(payload.total === expectedTotal, `list total should be ${expectedTotal}, got ${payload.total}`);
  assert(payload.count === expectedTotal, `list count should be ${expectedTotal}, got ${payload.count}`);

  const [first] = payload.shares;
  assert(first?.id, "list should include summary id");
  assert(!Object.hasOwn(first, "snapshot"), "list summaries must not include full snapshot payloads");
  assert(first.url?.startsWith(`${SITE_URL.replace(/\/+$/, "")}/share/`), `summary URL should point at site: ${first.url}`);
}

async function assertShareDetail(apiUrl, shareId) {
  const payload = await fetchJson(`${apiUrl}/api/snapshots/${encodeURIComponent(shareId)}`);
  assert(payload.share?.id === shareId, `detail should return share id ${shareId}`);
  assert(Array.isArray(payload.snapshot?.turns), "detail should include snapshot turns");
  assert(payload.snapshot.turns.length === 2, `detail should include 2 turns, got ${payload.snapshot.turns.length}`);
  assert(!Object.hasOwn(payload.snapshot, "cwd"), "published snapshot should not expose cwd");
  assert(!Object.hasOwn(payload.snapshot, "filePath"), "published snapshot should not expose filePath");
}

async function assertVerifyScriptReadOnly(apiUrl) {
  const result = await runNode(
    [
      "deploy/aliyun/verify-public-share.mjs",
      "--api-url",
      apiUrl,
      "--site-url",
      SITE_URL,
      "--skip-site-config",
    ],
    {
      SNAPSHOT_SHARE_TOKEN: TOKEN,
    }
  );

  assert(result.stdout.includes("Skipped publish check"), "verify script should skip publish unless --publish is passed");
}

async function assertVerifyScriptPublish(apiUrl) {
  const tokenFile = path.join(tempDir, "verify-local-publisher.json");
  const siteServer = await startTestSiteServer(apiUrl);

  await writeFile(
    tokenFile,
    `${JSON.stringify({
      snapshotShareToken: TOKEN,
      snapshotShareApiUrl: apiUrl,
      snapshotShareSiteUrl: siteServer.url,
    }, null, 2)}\n`,
    "utf8"
  );

  try {
    const result = await runNode(
      [
        "deploy/aliyun/verify-public-share.mjs",
        "--api-url",
        apiUrl,
        "--site-url",
        siteServer.url,
        "--check-local-config",
        "--publish",
        "--token-file",
        tokenFile,
        "--share-id",
        "snap_verifyshare123456",
      ],
      {
        SNAPSHOT_SHARE_TOKEN: "",
      }
    );

    assert(result.stdout.includes("Publish check ok"), "verify script should publish when --publish is passed");
    assert(result.stdout.includes("Site config points at the public API"), "verify script should check site config");
    assert(
      result.stdout.includes("Public share page shell is reachable"),
      "verify script should check the returned public share page"
    );
    assert(
      result.stdout.includes("Local publisher config points at the public API"),
      "verify script should check local publisher config"
    );
  } finally {
    await siteServer.close();
  }
}

async function assertLocalViewerPublish(apiUrl) {
  const codexHome = path.join(tempDir, "codex-home");
  const sessionDir = path.join(codexHome, "sessions");
  const sessionPath = path.join(sessionDir, "local-publish-session.jsonl");
  const tokenFile = path.join(tempDir, "local-publisher-agent.json");
  const viewerPort = await getFreePort();
  const viewerUrl = `http://127.0.0.1:${viewerPort}`;
  let viewerProcess;

  await mkdir(sessionDir, { recursive: true });
  await writeFile(sessionPath, `${createCodexSessionJsonl()}\n`, "utf8");
  await writeFile(
    tokenFile,
    `${JSON.stringify({
      snapshotShareToken: TOKEN,
      snapshotShareApiUrl: apiUrl,
      snapshotShareSiteUrl: SITE_URL,
    }, null, 2)}\n`,
    "utf8"
  );

  try {
    viewerProcess = spawn(
      process.execPath,
      [
        "bin/codex-snapshot.mjs",
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        String(viewerPort),
        "--codex-home",
        codexHome,
        "--claude-home",
        path.join(tempDir, "claude-home"),
        "--trae-home",
        path.join(tempDir, "trae-home"),
        "--trae-app-home",
        path.join(tempDir, "trae-app-home"),
        "--trae-recordings-dir",
        path.join(tempDir, "trae-recordings"),
      ],
      {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          CODEX_SNAPSHOTS_AGENT_FILE: tokenFile,
          CODEX_SNAPSHOTS_SHARE_API_URL: "",
          CODEX_SNAPSHOTS_SHARE_TOKEN: "",
          NEXT_PUBLIC_TOKEN_BOARD_API_URL: "",
          SNAPSHOT_SHARE_API_URL: "",
          SNAPSHOT_SHARE_PUBLIC_API_URL: "",
          SNAPSHOT_SHARE_SITE_URL: "",
          SNAPSHOT_SHARE_TOKEN: "",
          SNAPSHOT_SHARE_TOKEN_FILE: tokenFile,
          TOKEN_BOARD_AGENT_FILE: "",
          TOKEN_BOARD_AGENT_TOKEN: "",
          TOKEN_BOARD_API_URL: "",
          TOKEN_BOARD_UPLOAD_TOKEN: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    const output = collectChildOutput(viewerProcess);
    await waitForJson(`${viewerUrl}/api/sessions?source=codex&limit=5`, output, viewerProcess);
    const viewerHtml = await fetchText(viewerUrl);
    assert(viewerHtml.includes(apiUrl), "local viewer should read share API URL from the agent config file");
    assert(viewerHtml.includes(SITE_URL.replace(/\/+$/, "")), "local viewer should read site URL from the agent config file");
    assert(!viewerHtml.includes(TOKEN), "local viewer HTML must not expose the publish token");

    const options = new URLSearchParams({
      id: sessionPath,
      includeTools: "0",
      includeToolOutput: "0",
      redact: "1",
      safety: "0",
    });
    const payload = await fetchJson(`${viewerUrl}/api/publish?${options.toString()}`, { method: "POST" });

    assert(payload.id?.startsWith("snap_"), `local viewer publish should return a share id: ${JSON.stringify(payload)}`);
    assert(payload.url, `local viewer publish should return a share URL: ${JSON.stringify(payload)}`);

    const url = new URL(payload.url);
    assert(url.origin === new URL(SITE_URL).origin, `local viewer share URL should use site origin: ${payload.url}`);
    assert(url.searchParams.get("api") === apiUrl, `local viewer share URL should include API URL: ${payload.url}`);

    const detail = await fetchJson(`${apiUrl}/api/snapshots/${encodeURIComponent(payload.id)}`);
    assert(detail.share?.title === "Publish this session to the public website.", "local viewer should publish the selected session title");
    assert(detail.snapshot?.redacted === true, "local viewer publish should force redacted snapshots");
  } finally {
    await stopChild(viewerProcess);
  }
}

function createSnapshot(title) {
  return {
    title,
    engine: "codex",
    engineLabel: "Codex",
    cwd: "/Users/example/private-project",
    filePath: "/Users/example/private-project/.codex/session.json",
    redacted: true,
    turns: [
      {
        role: "user",
        text: "Can this session be listed publicly?",
      },
      {
        role: "assistant",
        text: "Yes. A redacted share can be published and listed by the public API.",
      },
    ],
  };
}

function createCodexSessionJsonl() {
  return [
    {
      type: "session_meta",
      timestamp: "2026-05-28T00:00:00.000Z",
      payload: {
        id: "local-publish-session-001",
        cwd: "/Users/example/private-project",
        timestamp: "2026-05-28T00:00:00.000Z",
        model_provider: "openai",
        originator: "codex",
      },
    },
    {
      type: "response_item",
      timestamp: "2026-05-28T00:00:01.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Publish this session to the public website.",
          },
        ],
      },
    },
    {
      type: "response_item",
      timestamp: "2026-05-28T00:00:02.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "The session is redacted and ready for public listing.",
          },
        ],
      },
    },
  ].map((row) => JSON.stringify(row)).join("\n");
}

async function waitForHealth(apiUrl, output) {
  const deadline = Date.now() + 7000;
  let lastError;

  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(`share API exited early with code ${serverProcess.exitCode}\n${output.text()}`);
    }

    try {
      const payload = await fetchJson(`${apiUrl}/api/snapshots/health`, { timeoutMs: 500 });
      if (payload.ok === true) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(120);
  }

  throw new Error(`share API did not become ready: ${lastError?.message || "timeout"}\n${output.text()}`);
}

async function waitForJson(url, output, childProcess) {
  const deadline = Date.now() + 7000;
  let lastError;

  while (Date.now() < deadline) {
    if (childProcess?.exitCode !== null) {
      throw new Error(`process exited early with code ${childProcess.exitCode}\n${output.text()}`);
    }

    try {
      await fetchJson(url, { timeoutMs: 500 });
      return;
    } catch (error) {
      lastError = error;
    }

    await sleep(120);
  }

  throw new Error(`process did not become ready: ${lastError?.message || "timeout"}\n${output.text()}`);
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 2000, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, got ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${payload.error || text}`);
  }

  return payload;
}

async function fetchText(url, options = {}) {
  const { timeoutMs = 2000, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  return text;
}

async function startTestSiteServer(apiUrl) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("method not allowed");
      return;
    }

    if (url.pathname === "/assets/config.js") {
      response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      response.end(`window.CODEX_SNAPSHOTS_CONFIG = { apiUrl: ${JSON.stringify(apiUrl)} };\n`);
      return;
    }

    if (url.pathname === "/share/" || url.pathname === "/share") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Codex Snapshots</title></head>
<body>
  <main id="share-content"></main>
  <script src="../assets/config.js"></script>
  <script src="../assets/share.js"></script>
</body>
</html>`);
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address && typeof address === "object", "test site server should expose a port");

  return {
    url: `http://127.0.0.1:${address.port}`,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = collectChildOutput(child);

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const text = output.text();
      if (code === 0) {
        resolve({
          stdout: output.stdout,
          stderr: output.stderr,
        });
        return;
      }
      reject(new Error(`node ${args.join(" ")} failed with ${signal || code}\n${text}`));
    });
  });
}

function collectChildOutput(child) {
  const chunks = {
    stdout: "",
    stderr: "",
  };

  child?.stdout?.setEncoding("utf8");
  child?.stderr?.setEncoding("utf8");
  child?.stdout?.on("data", (chunk) => {
    chunks.stdout += chunk;
  });
  child?.stderr?.on("data", (chunk) => {
    chunks.stderr += chunk;
  });

  return {
    get stdout() {
      return chunks.stdout;
    },
    get stderr() {
      return chunks.stderr;
    },
    text() {
      return [chunks.stdout, chunks.stderr].filter(Boolean).join("\n");
    },
  };
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Could not allocate a local test port"));
        }
      });
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(1500).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
