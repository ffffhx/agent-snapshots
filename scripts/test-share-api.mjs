#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
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
const GOAL_OBJECTIVE = "Keep the publishing flow safe and visible.";

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
  await assertUnauthorizedDelete(localApiUrl, FIXED_SHARE_ID);
  await assertVerifyScriptReadOnly(localApiUrl);
  await assertPublicList(localApiUrl, 1);
  await assertVerifyScriptPublish(localApiUrl);
  await assertPublicList(localApiUrl, 2);
  await assertLocalViewerPublish(localApiUrl);
  await assertPublicList(localApiUrl, 3);
  await assertDelete(localApiUrl, FIXED_SHARE_ID);
  await assertPublicList(localApiUrl, 2);
  await stopChild(serverProcess);
  serverProcess = null;
  await assertGithubOwnershipAuth();

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
  const siteOrigin = new URL(SITE_URL).origin;
  const getResponse = await fetch(`${apiUrl}/api/snapshots`, {
    headers: {
      origin: siteOrigin,
    },
  });

  assert(getResponse.ok, `cross-origin public list should return ok, got ${getResponse.status}`);
  assert(getResponse.headers.get("access-control-allow-origin") === siteOrigin, "public list should allow configured cross-origin reads");
  assert(getResponse.headers.get("access-control-allow-credentials") === "true", "public list should allow GitHub session credentials");

  const optionsResponse = await fetch(`${apiUrl}/api/snapshots`, {
    method: "OPTIONS",
    headers: {
      "access-control-request-headers": "authorization,content-type",
      "access-control-request-method": "POST",
      origin: siteOrigin,
    },
  });

  assert(optionsResponse.status === 204, `CORS preflight should return 204, got ${optionsResponse.status}`);
  assert(optionsResponse.headers.get("access-control-allow-origin") === siteOrigin, "CORS preflight should allow the public site origin");
  assert(
    String(optionsResponse.headers.get("access-control-allow-methods") || "").includes("OPTIONS"),
    "CORS preflight should include OPTIONS in allowed methods"
  );
  assert(
    String(optionsResponse.headers.get("access-control-allow-methods") || "").includes("DELETE"),
    "CORS preflight should include DELETE in allowed methods"
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
  assert(payload.share?.goalObjective === GOAL_OBJECTIVE, "detail share metadata should include the goal objective");
  assert(payload.snapshot?.goalObjective === GOAL_OBJECTIVE, "detail snapshot metadata should include the goal objective");
  assert(Array.isArray(payload.snapshot?.turns), "detail should include snapshot turns");
  assert(payload.snapshot.turns.length === 2, `detail should include 2 turns, got ${payload.snapshot.turns.length}`);
  assert(!Object.hasOwn(payload.snapshot, "cwd"), "published snapshot should not expose cwd");
  assert(!Object.hasOwn(payload.snapshot, "filePath"), "published snapshot should not expose filePath");
  const assistantTurn = payload.snapshot.turns.find((turn) => turn.role === "assistant");
  assert(!assistantTurn.html.includes("javascript:"), "share API should strip unsafe link protocols from HTML");
  assert(!assistantTurn.html.includes("onclick"), "share API should strip inline event handlers from HTML");
  assert(!assistantTurn.html.includes("<script"), "share API should strip script tags from HTML");
  assert(assistantTurn.html.includes('target="_blank"'), "share API should force links to open in a new tab");
  assert(assistantTurn.html.includes('rel="noopener noreferrer"'), "share API should force safe link rel attributes");
}

async function assertUnauthorizedDelete(apiUrl, shareId) {
  const response = await fetch(`${apiUrl}/api/snapshots/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
  });
  assert(response.status === 401, `unauthorized delete should return 401, got ${response.status}`);

  const payload = await fetchJson(`${apiUrl}/api/snapshots/${encodeURIComponent(shareId)}`);
  assert(payload.share?.id === shareId, "unauthorized delete should leave the share available");
}

async function assertDelete(apiUrl, shareId) {
  const response = await fetch(`${apiUrl}/api/snapshots/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${TOKEN}`,
    },
  });
  const payload = await response.json();

  assert(response.status === 200, `authenticated delete should return 200, got ${response.status}`);
  assert(payload.ok === true, `authenticated delete should return ok=true: ${JSON.stringify(payload)}`);
  assert(payload.deleted === true, `authenticated delete should report deleted=true: ${JSON.stringify(payload)}`);
  assert(payload.id === shareId, `authenticated delete should echo the share id: ${JSON.stringify(payload)}`);

  const detailResponse = await fetch(`${apiUrl}/api/snapshots/${encodeURIComponent(shareId)}`);
  assert(detailResponse.status === 404, `deleted share detail should return 404, got ${detailResponse.status}`);
}

async function assertGithubOwnershipAuth() {
  const port = await getFreePort();
  const apiUrl = `http://127.0.0.1:${port}`;
  const publicApiUrl = "https://snapshots.example.com/codex-snapshots";
  const dataFile = path.join(tempDir, "github-auth-shares.json");
  const sessionSecret = "github-session-secret-for-tests";
  let authServer;

  try {
    authServer = spawn(process.execPath, ["server/share-api.mjs", "--host", "127.0.0.1", "--port", String(port)], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        SNAPSHOT_AUTH_ALLOWED_ORIGINS: SITE_URL.replace(/\/+$/, ""),
        SNAPSHOT_AUTH_COOKIE_SAMESITE: "Lax",
        SNAPSHOT_AUTH_COOKIE_SECURE: "false",
        SNAPSHOT_GITHUB_CLIENT_ID: "test-client-id",
        SNAPSHOT_GITHUB_CLIENT_SECRET: "test-client-secret",
        SNAPSHOT_GITHUB_OWNER_LOGIN: "site-owner",
        SNAPSHOT_SESSION_SECRET: sessionSecret,
        SNAPSHOT_SHARE_DATA_FILE: dataFile,
        SNAPSHOT_SHARE_PUBLIC_API_URL: publicApiUrl,
        SNAPSHOT_SHARE_SITE_URL: SITE_URL,
        SNAPSHOT_SHARE_TOKEN: TOKEN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess = authServer;
    const output = collectChildOutput(authServer);
    await waitForHealth(apiUrl, output);

    const loginState = await fetchJson(`${apiUrl}/api/auth/me?returnTo=${encodeURIComponent(SITE_URL)}`);
    assert(loginState.configured === true, "GitHub auth state should report configured=true");
    assert(
      String(loginState.loginUrl || "").startsWith(`${publicApiUrl}/api/auth/github/start?`),
      `loginUrl should preserve the public API path prefix: ${loginState.loginUrl}`,
    );

    const startResponse = await fetch(`${apiUrl}/api/auth/github/start?returnTo=${encodeURIComponent(SITE_URL)}`, {
      redirect: "manual",
    });
    assert(startResponse.status === 302, `GitHub login start should redirect, got ${startResponse.status}`);
    const githubLocation = new URL(startResponse.headers.get("location"));
    assert(
      githubLocation.searchParams.get("redirect_uri") === `${publicApiUrl}/api/auth/github/callback`,
      `GitHub redirect_uri should preserve the public API path prefix: ${githubLocation.searchParams.get("redirect_uri")}`,
    );

    const aliceCookie = githubSessionCookie(
      {
        id: "42",
        login: "alice",
        avatarUrl: "",
        profileUrl: "https://github.com/alice",
      },
      sessionSecret,
    );
    const bobCookie = githubSessionCookie(
      {
        id: "77",
        login: "bob",
        avatarUrl: "",
        profileUrl: "https://github.com/bob",
      },
      sessionSecret,
    );
    const ownerCookie = githubSessionCookie(
      {
        id: "1",
        login: "site-owner",
        avatarUrl: "",
        profileUrl: "https://github.com/site-owner",
      },
      sessionSecret,
    );

    const siteOrigin = new URL(SITE_URL).origin;
    const corsResponse = await fetch(`${apiUrl}/api/auth/me`, {
      headers: {
        cookie: ownerCookie,
        origin: siteOrigin,
      },
    });
    const corsPayload = await corsResponse.json();
    assert(corsPayload.user?.isOwner === true, "owner GitHub session should be marked as site owner");
    assert(
      corsResponse.headers.get("access-control-allow-origin") === siteOrigin,
      "auth endpoint should echo the configured site origin",
    );
    assert(corsResponse.headers.get("access-control-allow-credentials") === "true", "auth endpoint should allow credentials");

    const tokenPublishResponse = await fetch(`${apiUrl}/api/snapshots`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        origin: SITE_URL.replace(/\/+$/, ""),
      },
      body: JSON.stringify({ shareId: "snap_tokenblocked123456", snapshot: createSnapshot("Token should not publish with GitHub auth") }),
    });
    assert(tokenPublishResponse.status === 401, `GitHub auth mode should reject bearer-token publish by default, got ${tokenPublishResponse.status}`);

    const aliceShare = await publishWithGithubSession(apiUrl, aliceCookie, "snap_aliceowned123456", "Alice owned session");
    assert(aliceShare.owner?.login === "alice", `published share should include owner login: ${JSON.stringify(aliceShare)}`);

    const bobDeleteResponse = await fetch(`${apiUrl}/api/snapshots/snap_aliceowned123456`, {
      method: "DELETE",
      headers: {
        cookie: bobCookie,
        origin: SITE_URL.replace(/\/+$/, ""),
      },
    });
    assert(bobDeleteResponse.status === 403, `other GitHub users should not delete Alice's share, got ${bobDeleteResponse.status}`);

    const aliceDeleteResponse = await fetch(`${apiUrl}/api/snapshots/snap_aliceowned123456`, {
      method: "DELETE",
      headers: {
        cookie: aliceCookie,
        origin: SITE_URL.replace(/\/+$/, ""),
      },
    });
    assert(aliceDeleteResponse.status === 200, `share owner should delete their own share, got ${aliceDeleteResponse.status}`);

    await publishWithGithubSession(apiUrl, aliceCookie, "snap_ownerdelete123456", "Owner can delete this session");
    const ownerDeleteResponse = await fetch(`${apiUrl}/api/snapshots/snap_ownerdelete123456`, {
      method: "DELETE",
      headers: {
        cookie: ownerCookie,
        origin: SITE_URL.replace(/\/+$/, ""),
      },
    });
    assert(ownerDeleteResponse.status === 200, `site owner should delete any share, got ${ownerDeleteResponse.status}`);
  } finally {
    await stopChild(authServer);
    if (serverProcess === authServer) {
      serverProcess = null;
    }
  }
}

async function publishWithGithubSession(apiUrl, cookie, shareId, title) {
  const response = await fetch(`${apiUrl}/api/snapshots`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: SITE_URL.replace(/\/+$/, ""),
    },
    body: JSON.stringify({
      shareId,
      apiUrl,
      siteUrl: SITE_URL,
      snapshot: createSnapshot(title),
    }),
  });
  const payload = await response.json();
  assert(response.status === 200, `GitHub session publish should succeed, got ${response.status}: ${JSON.stringify(payload)}`);
  const detail = await fetchJson(`${apiUrl}/api/snapshots/${encodeURIComponent(shareId)}`);
  return detail.share;
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
  const traeRecordingsDir = path.join(tempDir, "trae-recordings");
  const traeRecordingPath = path.join(traeRecordingsDir, "dom-thread-local-viewer-test.jsonl");
  const tokenFile = path.join(tempDir, "local-publisher-agent.json");
  const viewerPort = await getFreePort();
  const viewerUrl = `http://127.0.0.1:${viewerPort}`;
  let viewerProcess;

  await mkdir(sessionDir, { recursive: true });
  await mkdir(traeRecordingsDir, { recursive: true });
  await writeFile(sessionPath, `${createCodexSessionJsonl()}\n`, "utf8");
  await writeFile(traeRecordingPath, `${createTraeRecordingJsonl()}\n`, "utf8");
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
        traeRecordingsDir,
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
    const allSessions = await fetchJson(`${viewerUrl}/api/sessions?source=all&limit=5&completeOnly=0`);
    assert(
      allSessions.some((session) => session.source === "trae" && session.sourceKind === "recorded"),
      "local viewer should list Trae recorded sessions without runtime reference errors"
    );
    const viewerHtml = await fetchText(viewerUrl);
    assert(viewerHtml.includes(apiUrl), "local viewer should read share API URL from the agent config file");
    assert(viewerHtml.includes(SITE_URL.replace(/\/+$/, "")), "local viewer should read site URL from the agent config file");
    assert(!viewerHtml.includes(TOKEN), "local viewer HTML must not expose the publish token");
    assert(viewerHtml.includes("collapsedProjects"), "local viewer should track collapsed projects");
    assert(viewerHtml.includes("data-project-collapse"), "local viewer project headers should be clickable collapse controls");
    assert(viewerHtml.includes("CODEX_SNAPSHOT_CSRF_TOKEN"), "local viewer should include a CSRF token for publish actions");
    const csrfToken = extractCsrfToken(viewerHtml);

    const options = new URLSearchParams({
      id: sessionPath,
      includeTools: "0",
      includeToolOutput: "0",
      redact: "1",
      safety: "0",
    });
    const publishUrl = `${viewerUrl}/api/publish?${options.toString()}`;
    const snapshotPayload = await fetchJson(`${viewerUrl}/api/snapshot?${options.toString()}`);
    assert(snapshotPayload.goalObjective === GOAL_OBJECTIVE, "local viewer snapshot metadata should expose the goal objective");
    assert(
      !snapshotPayload.turns?.some((turn) => String(turn.text || "").includes("<goal_context>")),
      "local viewer snapshot turns should not include Codex internal goal context",
    );
    const getPublishResponse = await fetch(publishUrl);
    assert(getPublishResponse.status === 405, `local viewer publish should reject GET, got ${getPublishResponse.status}`);

    const noOriginPublishResponse = await fetch(publishUrl, {
      method: "POST",
      headers: {
        "x-codex-snapshot-csrf": csrfToken,
      },
    });
    assert(
      noOriginPublishResponse.status === 403,
      `local viewer publish should reject POST without Origin, got ${noOriginPublishResponse.status}`,
    );

    const badCsrfPublishResponse = await fetch(publishUrl, {
      method: "POST",
      headers: {
        origin: new URL(viewerUrl).origin,
        "x-codex-snapshot-csrf": "bad-token",
      },
    });
    assert(
      badCsrfPublishResponse.status === 403,
      `local viewer publish should reject invalid CSRF tokens, got ${badCsrfPublishResponse.status}`,
    );

    const payload = await fetchJson(publishUrl, {
      method: "POST",
      headers: {
        origin: new URL(viewerUrl).origin,
        "x-codex-snapshot-csrf": csrfToken,
      },
    });

    assert(payload.id?.startsWith("snap_"), `local viewer publish should return a share id: ${JSON.stringify(payload)}`);
    assert(payload.url, `local viewer publish should return a share URL: ${JSON.stringify(payload)}`);

    const url = new URL(payload.url);
    assert(url.origin === new URL(SITE_URL).origin, `local viewer share URL should use site origin: ${payload.url}`);
    assert(url.searchParams.get("api") === apiUrl, `local viewer share URL should include API URL: ${payload.url}`);

    const detail = await fetchJson(`${apiUrl}/api/snapshots/${encodeURIComponent(payload.id)}`);
    assert(detail.share?.title === "Publish this session to the public website.", "local viewer should publish the selected session title");
    assert(detail.share?.goalObjective === GOAL_OBJECTIVE, "local viewer should publish goal metadata on the share summary");
    assert(detail.snapshot?.goalObjective === GOAL_OBJECTIVE, "local viewer should publish goal metadata on the snapshot");
    assert(detail.snapshot?.redacted === true, "local viewer publish should force redacted snapshots");
    assert(
      !detail.snapshot?.turns?.some((turn) => String(turn.text || "").includes("<goal_context>")),
      "local viewer should not publish Codex internal goal context turns",
    );
    const assistantTurn = detail.snapshot?.turns?.find((turn) => turn.role === "assistant");
    assert(
      assistantTurn?.html?.includes('target="_blank"'),
      "local viewer should publish markdown links that open in a new tab"
    );
    assert(
      assistantTurn?.html?.includes('rel="noopener noreferrer"'),
      "local viewer should publish markdown links with opener protection"
    );
  } finally {
    await stopChild(viewerProcess);
  }
}

function createSnapshot(title) {
  return {
    title,
    engine: "codex",
    engineLabel: "Codex",
    goalObjective: GOAL_OBJECTIVE,
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
        html: '<p><a href="javascript:alert(1)" onclick="alert(2)">unsafe</a> <a href="https://example.com">safe</a><script>alert(3)</script></p>',
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
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "<goal_context>",
              "Continue working toward the active thread goal.",
              "",
              "<objective>",
              GOAL_OBJECTIVE,
              "</objective>",
              "",
              "Blocked audit:",
              "- Do not call update_goal unless the goal is complete.",
              "</goal_context>",
            ].join("\n"),
          },
        ],
      },
    },
    {
      type: "response_item",
      timestamp: "2026-05-28T00:00:03.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "The session is redacted and ready for [public listing](https://example.com/share).",
          },
        ],
      },
    },
  ].map((row) => JSON.stringify(row)).join("\n");
}

function createTraeRecordingJsonl() {
  return [
    {
      schema: "trae-local-recorder-event/v1",
      kind: "dom-message",
      source: "dom",
      domThreadId: "dom-thread-local-viewer-test",
      pageSession: "page-local-viewer-test",
      capturedAt: "2026-05-28T00:00:01.000Z",
      sequence: 1,
      body: JSON.stringify({ role: "user", text: "Trae captured question" }),
    },
    {
      schema: "trae-local-recorder-event/v1",
      kind: "dom-message",
      source: "dom",
      domThreadId: "dom-thread-local-viewer-test",
      pageSession: "page-local-viewer-test",
      capturedAt: "2026-05-28T00:00:02.000Z",
      sequence: 2,
      body: JSON.stringify({ role: "assistant", text: "Trae captured answer" }),
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

function extractCsrfToken(html) {
  const match = html.match(/CODEX_SNAPSHOT_CSRF_TOKEN=("(?:\\.|[^"])*")/);
  assert(match, "viewer HTML should expose a JSON-encoded CSRF token");
  const token = JSON.parse(match[1]);
  assert(typeof token === "string" && token.length >= 32, "CSRF token should be a strong string");
  return token;
}

function githubSessionCookie(user, secret) {
  const body = Buffer.from(
    JSON.stringify({
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      user,
    }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `codex_snapshots_session=${encodeURIComponent(`${body}.${signature}`)}`;
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
