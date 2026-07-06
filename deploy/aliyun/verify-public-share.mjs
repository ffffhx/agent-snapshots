#!/usr/bin/env node

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const parsed = parseArgs(process.argv.slice(2));

if (parsed.help) {
  printHelp();
  process.exit(0);
}

const localPublisherConfig = readLocalPublisherConfig(parsed.options.tokenFile);
const apiUrl = normalizeUrl(
  parsed.options.apiUrl ||
    process.env.SNAPSHOT_SHARE_API_URL ||
    process.env.SNAPSHOT_SHARE_PUBLIC_API_URL ||
    localPublisherConfig.apiUrl
);
const siteUrl = normalizeUrl(
  parsed.options.siteUrl ||
    process.env.SNAPSHOT_SHARE_SITE_URL ||
    localPublisherConfig.siteUrl ||
    "https://ffffhx.github.io/agent-snapshots/"
);
const token = parsed.options.token || process.env.SNAPSHOT_SHARE_TOKEN || localPublisherConfig.token || "";
const shouldPublish = parsed.options.publish;
const shouldCheckSiteConfig = !parsed.options.skipSiteConfig;
const shouldCheckLocalConfig = parsed.options.checkLocalConfig;

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  if (!apiUrl) {
    throw new Error("Missing --api-url or SNAPSHOT_SHARE_API_URL");
  }
  if (!siteUrl) {
    throw new Error("Missing --site-url or SNAPSHOT_SHARE_SITE_URL");
  }

  await checkHealth(apiUrl);
  await checkList(apiUrl);
  await checkCors(apiUrl, siteUrl);

  if (shouldCheckSiteConfig) {
    await checkSiteConfig(siteUrl, apiUrl);
  } else {
    console.log("• Skipped site config check");
  }

  if (shouldCheckLocalConfig) {
    checkLocalPublisherConfig(localPublisherConfig, apiUrl, siteUrl);
  }

  if (shouldPublish) {
    if (!token) {
      throw new Error("--publish requires --token, SNAPSHOT_SHARE_TOKEN, or a local publisher config with snapshotShareToken.");
    }
    await checkPublish(apiUrl, siteUrl, token);
  } else {
    console.log("• Skipped publish check; pass --publish --token <token> for legacy token auth, or verify GitHub OAuth publishing in the browser.");
  }

  console.log("✓ Public share deployment checks passed");
}

async function checkHealth(baseUrl) {
  const payload = await fetchJson(`${baseUrl}/api/snapshots/health`);
  if (payload.ok !== true) {
    throw new Error(`Health check did not return ok=true: ${JSON.stringify(payload)}`);
  }
  if (Object.hasOwn(payload, "storage")) {
    throw new Error("Health check exposes the server storage path.");
  }
  console.log(`✓ Health check ok (${payload.shares ?? 0} shares)`);
}

async function checkList(baseUrl) {
  const payload = await fetchJson(`${baseUrl}/api/snapshots?limit=3`);
  if (!Array.isArray(payload.shares)) {
    throw new Error("List endpoint did not return a shares array");
  }
  console.log(`✓ Public list ok (${payload.total ?? payload.shares.length} total shares)`);
}

async function checkCors(baseUrl, publicSiteUrl) {
  const siteOrigin = new URL(publicSiteUrl).origin;
  const response = await fetchWithTimeout(`${baseUrl}/api/snapshots?limit=1`, {
    headers: {
      origin: siteOrigin,
    },
  });

  if (!response.ok) {
    throw new Error(`CORS list check failed with HTTP ${response.status}`);
  }
  assertAllowedCorsOrigin(response.headers, siteOrigin, "CORS list response");

  const preflight = await fetchWithTimeout(`${baseUrl}/api/snapshots`, {
    method: "OPTIONS",
    headers: {
      "access-control-request-headers": "authorization,content-type",
      "access-control-request-method": "POST",
      origin: siteOrigin,
    },
  });

  if (preflight.status !== 204) {
    throw new Error(`CORS preflight returned HTTP ${preflight.status}, expected 204`);
  }
  assertAllowedCorsOrigin(preflight.headers, siteOrigin, "CORS preflight");

  console.log("✓ CORS allows the public site to read the API");
}

function assertAllowedCorsOrigin(headers, siteOrigin, label) {
  const allowedOrigin = headers.get("access-control-allow-origin");
  if (allowedOrigin !== "*" && allowedOrigin !== siteOrigin) {
    throw new Error(`${label} allowed origin is ${allowedOrigin || "(missing)"}, expected * or ${siteOrigin}.`);
  }
  if (allowedOrigin === siteOrigin && headers.get("access-control-allow-credentials") !== "true") {
    throw new Error(`${label} allows the site origin but is missing access-control-allow-credentials=true.`);
  }
}

async function checkSiteConfig(publicSiteUrl, publicApiUrl) {
  const configUrl = `${publicSiteUrl.replace(/\/+$/, "")}/assets/config.js`;
  const response = await fetchWithTimeout(configUrl);

  if (!response.ok) {
    throw new Error(`Could not load site config at ${configUrl}: HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text.includes(publicApiUrl)) {
    throw new Error(`Site config at ${configUrl} does not include ${publicApiUrl}`);
  }

  console.log("✓ Site config points at the public API");
}

async function checkPublish(baseUrl, publicSiteUrl, publishToken) {
  const shareId = parsed.options.shareId || `snap_verify${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const payload = await fetchJson(`${baseUrl}/api/snapshots`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${publishToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      shareId,
      apiUrl: baseUrl,
      siteUrl: publicSiteUrl,
      snapshot: {
        title: "Agent Snapshots public deployment verification",
        engine: "codex",
        engineLabel: "Codex",
        redacted: true,
        turns: [
          {
            role: "user",
            text: "Verify that the public share API accepts writes.",
          },
          {
            role: "assistant",
            text: "The public share API accepted this verification snapshot.",
          },
        ],
      },
    }),
  });

  if (payload.ok !== true || payload.id !== shareId || !payload.url) {
    throw new Error(`Publish response was unexpected: ${JSON.stringify(payload)}`);
  }

  const url = new URL(payload.url);
  if (url.origin !== new URL(publicSiteUrl).origin) {
    throw new Error(`Published URL should point at the public site, got ${payload.url}`);
  }
  if (url.searchParams.get("api") !== baseUrl) {
    throw new Error(`Published URL is missing api=${baseUrl}: ${payload.url}`);
  }

  const loaded = await fetchJson(`${baseUrl}/api/snapshots/${encodeURIComponent(shareId)}`);
  if (loaded.share?.id !== shareId || !loaded.snapshot) {
    throw new Error(`Published snapshot could not be loaded: ${JSON.stringify(loaded)}`);
  }

  if (shouldCheckSiteConfig) {
    await checkSharePageShell(payload.url);
  }

  console.log(`✓ Publish check ok: ${payload.url}`);
}

async function checkSharePageShell(shareUrl) {
  const response = await fetchWithTimeout(shareUrl);

  if (!response.ok) {
    throw new Error(`Could not load public share page at ${shareUrl}: HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text.includes("assets/share.js") && !text.includes("AGENT_SNAPSHOTS_CONFIG")) {
    throw new Error(`Public share page at ${shareUrl} did not look like the Agent Snapshots viewer.`);
  }

  console.log("✓ Public share page shell is reachable");
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${payload.error || text}`);
  }

  return payload;
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Number(parsed.options.timeoutMs || 8000);
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function normalizeUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) {
    return "";
  }
  const url = new URL(text);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`URL must start with http:// or https://: ${text}`);
  }
  return url.toString().replace(/\/+$/, "");
}

function readLocalPublisherConfig(tokenFile) {
  const candidates = [
    tokenFile,
    process.env.AGENT_SNAPSHOTS_AGENT_FILE,
    process.env.SNAPSHOT_SHARE_TOKEN_FILE,
    path.join(os.homedir(), ".agent-snapshots-agent.json"),
  ].filter(Boolean);

  for (const filePath of candidates) {
    try {
      const payload = JSON.parse(readFileSync(filePath, "utf8"));
      return {
        apiUrl: firstNonEmptyString(
          payload.snapshotShareApiUrl,
          payload.snapshotSharePublicApiUrl,
          payload.shareApiUrl,
          payload.publicApiUrl,
          payload.apiUrl
        ),
        filePath,
        siteUrl: firstNonEmptyString(payload.snapshotShareSiteUrl, payload.shareSiteUrl, payload.siteUrl),
        token: firstNonEmptyString(payload.snapshotShareToken, payload.agentToken, payload.token, payload.uploadToken),
      };
    } catch {}
  }

  return {
    apiUrl: "",
    filePath: candidates[0] || "",
    siteUrl: "",
    token: "",
  };
}

function checkLocalPublisherConfig(config, publicApiUrl, publicSiteUrl) {
  if (!config.filePath || (!config.apiUrl && !config.siteUrl && !config.token)) {
    throw new Error("Local publisher config was not found. Run deploy/aliyun/configure-local-publisher.sh first.");
  }

  const configuredApiUrl = normalizeUrl(config.apiUrl);
  const configuredSiteUrl = normalizeUrl(config.siteUrl);

  if (!configuredApiUrl) {
    throw new Error(`Local publisher config at ${config.filePath} does not include snapshotShareApiUrl.`);
  }
  if (configuredApiUrl !== publicApiUrl) {
    throw new Error(`Local publisher config points at ${configuredApiUrl}, expected ${publicApiUrl}.`);
  }
  if (!configuredSiteUrl) {
    throw new Error(`Local publisher config at ${config.filePath} does not include snapshotShareSiteUrl.`);
  }
  if (configuredSiteUrl !== publicSiteUrl) {
    throw new Error(`Local publisher config site URL is ${configuredSiteUrl}, expected ${publicSiteUrl}.`);
  }

  console.log(`✓ Local publisher config points at the public API (${config.filePath})`);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parseArgs(args) {
  const options = {
    apiUrl: "",
    checkLocalConfig: false,
    help: false,
    publish: false,
    shareId: "",
    skipSiteConfig: false,
    siteUrl: "",
    timeoutMs: "",
    token: "",
    tokenFile: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--publish") {
      options.publish = true;
      continue;
    }
    if (arg === "--skip-site-config") {
      options.skipSiteConfig = true;
      continue;
    }
    if (arg === "--check-local-config") {
      options.checkLocalConfig = true;
      continue;
    }
    if (arg === "--api-url") {
      options.apiUrl = String(args[++index] || "");
      continue;
    }
    if (arg === "--site-url") {
      options.siteUrl = String(args[++index] || "");
      continue;
    }
    if (arg === "--token") {
      options.token = String(args[++index] || "");
      continue;
    }
    if (arg === "--token-file") {
      options.tokenFile = String(args[++index] || "");
      continue;
    }
    if (arg === "--share-id") {
      options.shareId = String(args[++index] || "");
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = String(args[++index] || "");
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  return { help: options.help, options };
}

function printHelp() {
  console.log(`verify-public-share

Usage:
  node deploy/aliyun/verify-public-share.mjs --api-url https://snapshots.example.com --site-url https://ffffhx.github.io/agent-snapshots/
  SNAPSHOT_SHARE_TOKEN=<legacy-token> node deploy/aliyun/verify-public-share.mjs --api-url https://snapshots.example.com --publish

Checks:
  - GET /api/snapshots/health
  - GET /api/snapshots
  - CORS headers for the public site
  - site assets/config.js points at the public API
  - optional local publisher config points at the public API
  - optional legacy-token POST /api/snapshots, GET /api/snapshots/:id, and public share page URL

Options:
  --skip-site-config    Do not check the static site's assets/config.js
  --check-local-config  Check ~/.agent-snapshots-agent.json or --token-file
  --token-file FILE     Local publisher config file
`);
}
