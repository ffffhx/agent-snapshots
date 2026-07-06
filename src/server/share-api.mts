#!/usr/bin/env node
// @ts-nocheck

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createShareStore } from "./share-store.js";
import { sanitizeSnapshotHtml as sanitizeSnapshotTurnHtml } from "../shared/sanitize.js";
import { renderTranscriptHtml } from "../renderers/transcript.js";
import { detectRisks, redactText } from "../core/privacy.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const SNAPSHOT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Agent Snapshots"><rect width="64" height="64" rx="14" fill="#231d12"/><circle cx="32" cy="32" r="20" fill="none" stroke="#4f4533" stroke-width="1.6"/><g transform="translate(32,32)"><path d="M -12.71 -14.12 A 19 19 0 0 1 12.71 -14.12 L 5.48 -2.44 A 6 6 0 0 0 -1.85 -5.71 Z" fill="#c9bd9f"/><path d="M 5.87 -18.07 A 19 19 0 0 1 18.58 3.95 L 4.85 3.53 A 6 6 0 0 0 4.01 -4.46 Z" fill="#e7dcc4"/><path d="M 18.58 -3.95 A 19 19 0 0 1 5.87 18.07 L -0.63 5.97 A 6 6 0 0 0 5.87 1.25 Z" fill="#c9bd9f"/><path d="M 12.71 14.12 A 19 19 0 0 1 -12.71 14.12 L -5.48 2.44 A 6 6 0 0 0 1.85 5.71 Z" fill="#e7dcc4"/><path d="M -5.87 18.07 A 19 19 0 0 1 -18.58 -3.95 L -4.85 -3.53 A 6 6 0 0 0 -4.01 4.46 Z" fill="#c9bd9f"/><path d="M -18.58 3.95 A 19 19 0 0 1 -5.87 -18.07 L 0.63 -5.97 A 6 6 0 0 0 -5.87 -1.25 Z" fill="#e7dcc4"/></g><circle cx="32" cy="32" r="3.4" fill="#b23a2b"/></svg>`;

const parsed = parseArgs(process.argv.slice(2));

if (parsed.help) {
  printHelp();
  process.exit(0);
}

const host = parsed.options.host || process.env.HOST || DEFAULT_HOST;
const port = Number(parsed.options.port || process.env.PORT || DEFAULT_PORT);
const dataFile = path.resolve(
  expandHome(parsed.options.dataFile || process.env.SNAPSHOT_SHARE_DATA_FILE || ".agent-snapshots/shares.json")
);
const shareToken =
  parsed.options.token ||
  process.env.SNAPSHOT_SHARE_TOKEN ||
  process.env.AGENT_SNAPSHOTS_SHARE_TOKEN ||
  process.env.CODEX_SNAPSHOTS_SHARE_TOKEN ||
  process.env.TOKEN_BOARD_AGENT_TOKEN ||
  process.env.TOKEN_BOARD_UPLOAD_TOKEN ||
  "";
const githubAuth = readGithubAuthConfig();
const authCookieName = sanitizeCookieName(process.env.SNAPSHOT_AUTH_COOKIE_NAME) || "agent_snapshots_session";
const tokenAuthEnabled =
  Boolean(shareToken) && (!githubAuth.enabled || process.env.SNAPSHOT_SHARE_ALLOW_TOKEN_AUTH === "true");

const storage = createShareStore({ kind: "file", filePath: dataFile });

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("port must be a positive number");
  }

  const server = http.createServer(async (request, response) => {
    try {
      setCorsHeaders(request, response);

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      const shareId = shareIdFromPath(url.pathname);

      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        const user = readSessionUser(request);
        sendJson(response, 200, {
          configured: githubAuth.enabled,
          provider: "github",
          user,
          loginUrl: githubAuth.enabled ? githubLoginStartUrl(request, url.searchParams.get("returnTo")) : null,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/github/start") {
        redirectToGithubLogin(request, response, url.searchParams.get("returnTo"));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/github/callback") {
        await handleGithubCallback(request, response, url);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        requireAllowedMutationOrigin(request);
        clearSessionCookie(request, response);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        send(response, 200, "text/html; charset=utf-8", renderHome());
        return;
      }

      if (request.method === "GET" && (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico")) {
        send(response, 200, "image/svg+xml; charset=utf-8", SNAPSHOT_LOGO_SVG);
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          service: "agent-snapshots-share-api",
          auth: githubAuth.enabled ? "github" : tokenAuthEnabled ? "token" : "disabled",
          owner: githubAuth.ownerLabel || null,
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/snapshots/health") {
        sendJson(response, 200, {
          ok: true,
          shares: await storage.countShares(),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/snapshots/share/") {
        send(response, 200, "text/html; charset=utf-8", await renderSharePage(url.searchParams.get("id") || ""));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/snapshots") {
        const limit = readIntegerParam(url.searchParams.get("limit"), 50, 100);
        const offset = readIntegerParam(url.searchParams.get("offset"), 0, 100_000);
        const records = await storage.listShares();
        const page = records.slice(offset, offset + limit);

        sendJson(response, 200, {
          schemaVersion: 1,
          shares: page.map((record) =>
            toShareSummary(record, request, url.searchParams.get("siteUrl"), url.searchParams.get("apiUrl"))
          ),
          count: page.length,
          total: records.length,
          limit,
          offset,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/snapshots") {
        requireAllowedMutationOrigin(request);
        const auth = requirePublishAuth(request);
        const body = await readJsonBody(request, MAX_BODY_BYTES);
        const snapshot = normalizeSnapshotPayloadForShare(body.snapshot ?? body);

        if (!snapshot.redacted && process.env.SNAPSHOT_SHARE_ALLOW_UNREDACTED !== "true") {
          sendJson(response, 400, {
            error:
              "Refusing to publish an unredacted snapshot. Re-run without --no-redact, or set SNAPSHOT_SHARE_ALLOW_UNREDACTED=true on the server.",
          });
          return;
        }

        if (snapshot.redacted && process.env.SNAPSHOT_SHARE_VERIFY_REDACTION !== "false") {
          const leakedCategories = highRiskCategoriesInShare(snapshot.payload);
          if (leakedCategories.length) {
            sendJson(response, 422, {
              error:
                "Refusing to publish: redaction verification still found high-risk secrets in the snapshot. Re-redact before sharing.",
              categories: leakedCategories,
            });
            return;
          }
        }

        const now = new Date().toISOString();
        const record = {
          id: sanitizeShareId(body.shareId) || createShareId(),
          title: snapshot.title,
          engine: snapshot.engine,
          engineLabel: snapshot.engineLabel,
          sourceRef: snapshot.ref,
          goalObjective: snapshot.goalObjective,
          createdAt: now,
          updatedAt: now,
          expiresAt: expiryFromDays(body.expiresInDays),
          redacted: snapshot.redacted,
          turnCount: snapshot.turnCount,
          owner: auth.user ? shareOwnerFromUser(auth.user) : undefined,
          snapshot: snapshot.payload,
        };

        await storage.putShare(record);

        sendJson(response, 200, {
          ok: true,
          id: record.id,
          title: record.title,
          turnCount: record.turnCount,
          redacted: record.redacted,
          expiresAt: record.expiresAt || null,
          owner: record.owner || null,
          url: snapshotShareUrl(request, record.id, body.siteUrl, body.apiUrl),
        });
        return;
      }

      if (request.method === "GET" && shareId) {
        const record = await storage.getShare(shareId);

        if (!record) {
          sendJson(response, 404, { error: "Snapshot share not found" });
          return;
        }

        sendJson(response, 200, {
          schemaVersion: 1,
          share: {
            id: record.id,
            title: record.title,
            engine: record.engine,
            engineLabel: record.engineLabel,
            sourceRef: record.sourceRef,
            goalObjective: record.goalObjective || record.snapshot?.goalObjective,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            expiresAt: record.expiresAt || null,
            redacted: record.redacted,
            turnCount: record.turnCount,
            owner: record.owner || null,
          },
          snapshot: record.snapshot,
        });
        return;
      }

      if (request.method === "DELETE" && shareId) {
        requireAllowedMutationOrigin(request);
        const auth = requireDeleteAuth(request);
        const record = await storage.getShare(shareId);
        if (!record) {
          sendJson(response, 404, { error: "Snapshot share not found" });
          return;
        }
        if (!canDeleteShare(auth, record)) {
          sendJson(response, 403, { error: "Only the share owner or site owner can delete this snapshot" });
          return;
        }
        const deleted = await storage.deleteShare(shareId);
        sendJson(response, deleted ? 200 : 404, { ok: deleted, deleted, id: shareId });
        return;
      }

      send(response, 404, "text/plain; charset=utf-8", "not found");
    } catch (error) {
      const status = error?.statusCode || 500;
      sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  console.log(`Agent Snapshots share API is running at http://${host}:${port}`);
  console.log(`Storage: ${dataFile}`);
  console.log(`Auth: ${githubAuth.enabled ? "GitHub OAuth required" : tokenAuthEnabled ? "SNAPSHOT_SHARE_TOKEN required" : "disabled (local/dev only)"}`);
}

function toShareSummary(record, request, rawSiteUrl, rawApiUrl) {
  return {
    id: record.id,
    title: record.title,
    engine: record.engine,
    engineLabel: record.engineLabel,
    sourceRef: record.sourceRef,
    goalObjective: record.goalObjective || record.snapshot?.goalObjective,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt || null,
    redacted: record.redacted,
    turnCount: record.turnCount,
    owner: record.owner || null,
    url: snapshotShareUrl(request, record.id, rawSiteUrl, rawApiUrl),
  };
}

function normalizeSnapshotPayloadForShare(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Body must include a snapshot object");
  }

  const payload = removePrivateSnapshotFields(JSON.parse(JSON.stringify(value)));
  stripRemoteImageSources(payload);
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  // Defense in depth: the title and goal objective are derived from raw prompt
  // text. Re-run redaction here so a client that forgot (or skipped) it cannot
  // publish a secret through these display fields.
  const title = sanitizeText(redactText(payload.title), 180) || "Untitled snapshot";
  payload.title = title;
  const engine = sanitizeText(payload.engine, 80) || "codex";
  const engineLabel = sanitizeText(payload.engineLabel, 80) || "Codex";
  const ref = sanitizeText(payload.ref, 240) || undefined;
  const goalObjective = sanitizeMultilineText(redactText(payload.goalObjective), 8000);
  if (goalObjective) {
    payload.goalObjective = goalObjective;
  } else {
    delete payload.goalObjective;
  }

  if (!turns.length) {
    throw new Error("Snapshot has no shareable turns");
  }

  sanitizeTurnHtml(payload);

  return {
    title,
    engine,
    engineLabel,
    ref,
    goalObjective,
    redacted: payload.redacted !== false,
    turnCount: turns.length,
    payload,
  };
}

function removePrivateSnapshotFields(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(removePrivateSnapshotFields);
  }

  delete value.cwd;
  delete value.filePath;
  delete value.displayFilePath;

  for (const [key, item] of Object.entries(value)) {
    value[key] = removePrivateSnapshotFields(item);
  }

  return value;
}

// Only inline data: images may leave the machine. A remote http(s) image src
// would (a) publish the URL — often an internal host with a token query string —
// and (b) turn every viewer's browser into a tracking beacon / blind GET SSRF
// when the <img> loads. Blank those sources and mark them unavailable.
function stripRemoteImageSources(value) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      stripRemoteImageSources(item);
    }
    return;
  }
  if (typeof value.src === "string" && !isInlineImageSrc(value.src)) {
    value.src = "";
    if (!value.unavailableReason) {
      value.unavailableReason = "Remote image omitted from shared snapshot";
    }
  }
  for (const item of Object.values(value)) {
    stripRemoteImageSources(item);
  }
}

function isInlineImageSrc(src) {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(String(src || ""));
}

// Server-side trust boundary: the publish endpoint is the one place data leaves
// the machine, so do not rely solely on the client's `redacted` flag. Re-scan
// the outgoing text for high-severity secrets (medium signals like home paths
// are intentionally ignored) and refuse to store anything that still leaks.
function highRiskCategoriesInShare(payload) {
  const labels = new Set();
  const visit = (turns) => {
    if (!Array.isArray(turns)) {
      return;
    }
    for (const turn of turns) {
      if (!turn || typeof turn !== "object") {
        continue;
      }
      const text = typeof turn.text === "string" ? turn.text : "";
      for (const risk of detectRisks(text)) {
        if (risk.severity === "high") {
          labels.add(risk.label);
        }
      }
    }
  };
  visit(payload?.turns);
  for (const risk of detectRisks(typeof payload?.title === "string" ? payload.title : "")) {
    if (risk.severity === "high") {
      labels.add(risk.label);
    }
  }
  if (Array.isArray(payload?.subagents)) {
    for (const subagent of payload.subagents) {
      visit(subagent?.turns);
    }
  }
  return [...labels];
}

function sanitizeTurnHtml(snapshot) {
  sanitizeSnapshotTurnHtml(snapshot);
}

function renderHome() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Snapshots Share API</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>${shareCss()}</style>
</head>
<body>
  <main class="shell">
    <p class="eyebrow">Agent Snapshots</p>
    <h1>Share API is running</h1>
    <p>Publish redacted snapshots with <code>pnpm snapshot publish</code>, then open the returned share link.</p>
    <dl>
      <div><dt>API</dt><dd><code>/api/snapshots</code></dd></div>
      <div><dt>Viewer</dt><dd><code>/snapshots/share/?id=...</code></dd></div>
      <div><dt>Storage</dt><dd><code>${escapeHtml(dataFile)}</code></dd></div>
    </dl>
  </main>
</body>
</html>`;
}

async function renderSharePage(initialId) {
  const record = initialId ? await storage.getShare(initialId) : null;
  const titleText = !initialId ? "Missing share id" : record ? record.title || "Snapshot" : "Snapshot unavailable";
  const metaText = record
    ? [
        record.engineLabel || "Codex",
        record.id,
        `${record.turnCount || 0} entries`,
        `redacted: ${record.redacted ? "yes" : "no"}`,
      ].join(" | ")
    : initialId
      ? "Snapshot share not found."
      : "Open a link with ?id=snap_...";
  const contentHtml = record
    ? renderTranscriptHtml(record.snapshot?.turns || [], {
        emptyHtml: "<div class='empty'>This snapshot has no shareable turns.</div>",
        labels: {
          processed: "Processed",
          tool: "Tool",
          imageUnavailable: "Image unavailable",
          imageAltPrefix: "Image attachment",
        },
      })
    : `<div class="empty">${escapeHtml(initialId ? "Snapshot share not found." : "Open a link with ?id=snap_...")}</div>`;
  const goalHtml = record?.snapshot?.goalObjective
    ? `<section class="goal-meta"><span>Goal</span><p>${escapeHtml(record.snapshot.goalObjective)}</p></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Snapshot Share</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>${shareCss()}</style>
</head>
<body>
  <main class="share">
    <header class="share-header">
      <p class="eyebrow">Cloud Read-only Snapshot</p>
      <h1 id="title">${escapeHtml(titleText)}</h1>
      <p id="meta" class="meta">${escapeHtml(metaText)}</p>
      ${goalHtml}
    </header>
    <section id="content" class="turns">${contentHtml}</section>
  </main>
</body>
</html>`;
}

function shareCss() {
  return `
:root {
  --ink: #16191f;
  --muted: #69717d;
  --line: #d9dee4;
  --paper: #f4f0e7;
  --panel: #fffdf8;
  --blue: #255f82;
  --shadow-soft: 0 24px 70px -58px rgba(22, 25, 31, 0.5);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--ink);
  background:
    linear-gradient(90deg, rgba(22, 25, 31, 0.065) 1px, transparent 1px),
    linear-gradient(rgba(22, 25, 31, 0.038) 1px, transparent 1px),
    var(--paper);
  background-size: 24px 24px;
  font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
}
code, pre, .eyebrow, .meta { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.shell, .share { width: min(1180px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0 64px; }
.shell {
  min-height: 100vh;
  display: grid;
  align-content: center;
}
.shell > *, .share-header {
  border: 1px solid rgba(22, 25, 31, 0.12);
  background: rgba(255, 253, 248, 0.92);
  box-shadow: var(--shadow-soft);
}
.shell > * { padding: 28px; }
.share-header { padding: 24px; border-bottom: 3px solid var(--ink); }
.eyebrow {
  margin: 0 0 10px;
  color: var(--blue);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
h1 { margin: 0; font-size: clamp(36px, 7vw, 72px); line-height: 0.95; letter-spacing: 0; }
p { color: var(--muted); font-size: 18px; line-height: 1.65; }
dl { display: grid; gap: 10px; margin: 24px 0 0; }
dl div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 16px; border-top: 1px solid var(--line); padding-top: 10px; }
dt { color: var(--muted); font-weight: 700; }
dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.goal-meta {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 14px;
  border-top: 1px solid var(--line);
  margin-top: 18px;
  padding-top: 12px;
}
.goal-meta span {
  color: var(--muted);
  font: 900 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-transform: uppercase;
}
.goal-meta p {
  margin: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 15px;
  line-height: 1.55;
}
.turns { display: grid; gap: 34px; margin-top: 34px; }
.turn { display: flex; min-width: 0; }
.turn.user { justify-content: flex-end; }
.turn.assistant, .turn.tool, .turn.process { justify-content: flex-start; }
.message-card { min-width: 0; max-width: min(960px, 76%); }
.turn.user .message-card {
  border: 1px solid #d6e9e5;
  border-radius: 18px;
  background: #eef9f6;
  padding: 20px 28px;
  box-shadow: var(--shadow-soft);
}
.turn.tool .message-card {
  width: min(960px, 86%);
  border: 1px solid #efd99f;
  border-radius: 8px;
  background: #fff8df;
  padding: 16px 18px;
}
.process-details {
  width: min(960px, 76%);
  border-top: 1px solid rgba(22, 25, 31, 0.12);
  color: rgba(22, 25, 31, 0.62);
}
.process-summary {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  font: 800 17px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.process-summary::-webkit-details-marker { display: none; }
.process-summary::after {
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  content: "";
  transform: translateY(-2px) rotate(45deg);
  transition: transform 0.16s ease;
}
.process-details[open] .process-summary::after {
  transform: translateY(2px) rotate(225deg);
}
.process-body {
  display: grid;
  gap: 22px;
  padding: 6px 0 8px;
}
.process-entry { min-width: 0; }
.process-tool {
  max-width: min(880px, 100%);
  border-left: 3px solid rgba(183, 121, 31, 0.32);
  padding-left: 12px;
}
.body {
  min-width: 0;
  color: var(--ink);
  font-size: 19px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}
.body pre, .tool-details pre {
  max-width: 100%;
  overflow: auto;
  border: 1px solid #253043;
  border-radius: 8px;
  background: #111722;
  color: #edf4ff;
  padding: 16px;
  font: 13px/1.58 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.body code {
  border: 1px solid rgba(22, 25, 31, 0.12);
  border-radius: 6px;
  background: rgba(22, 25, 31, 0.06);
  padding: 0.08rem 0.34rem;
  font-size: 0.9em;
}
.attachment-grid { display: grid; gap: 18px; margin-top: 24px; }
.image-attachment { margin: 0; min-width: 0; }
.image-attachment img {
  display: block;
  max-width: 100%;
  max-height: 540px;
  border: 1px solid rgba(22, 25, 31, 0.18);
  border-radius: 8px;
  background: #fff;
  object-fit: contain;
}
.image-unavailable {
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 16px;
  color: var(--muted);
}
.empty { border: 1px solid var(--line); background: var(--panel); padding: 18px; color: var(--muted); }
@media (max-width: 820px) {
  .message-card, .process-details, .turn.user .message-card, .turn.tool .message-card { max-width: 100%; width: 100%; }
  .body { font-size: 17px; }
}
`;
}

function requirePublishAuth(request) {
  const sessionUser = readSessionUser(request);
  if (githubAuth.enabled && sessionUser) {
    return { kind: "github", user: sessionUser };
  }
  if (tokenAuthEnabled && readBearerToken(request) === shareToken) {
    return { kind: "token", user: null, isOwner: true };
  }
  if (!githubAuth.enabled && !tokenAuthEnabled && process.env.SNAPSHOT_SHARE_ALLOW_ANONYMOUS !== "false") {
    return { kind: "anonymous", user: null };
  }
  const error = new Error(githubAuth.enabled ? "GitHub login required" : "Login required");
  error.statusCode = 401;
  throw error;
}

function requireDeleteAuth(request) {
  return requirePublishAuth(request);
}

function canDeleteShare(auth, record) {
  if (auth.kind === "token" || auth.isOwner) {
    return true;
  }
  if (!auth.user) {
    return false;
  }
  if (auth.user.isOwner) {
    return true;
  }
  return sameGithubUser(auth.user, record.owner);
}

function sameGithubUser(left, right) {
  if (!left || !right) {
    return false;
  }
  const leftId = String(left.id || "");
  const rightId = String(right.id || "");
  if (leftId && rightId && leftId === rightId) {
    return true;
  }
  const leftLogin = String(left.login || "").toLowerCase();
  const rightLogin = String(right.login || "").toLowerCase();
  return Boolean(leftLogin && rightLogin && leftLogin === rightLogin);
}

function shareOwnerFromUser(user) {
  return {
    id: String(user.id || ""),
    login: String(user.login || ""),
    avatarUrl: user.avatarUrl || "",
    profileUrl: user.profileUrl || "",
  };
}

function readGithubAuthConfig() {
  const ownerId = sanitizeText(process.env.SNAPSHOT_GITHUB_OWNER_ID || process.env.SNAPSHOT_GITHUB_SITE_OWNER_ID, 80);
  const ownerLogin = sanitizeText(
    process.env.SNAPSHOT_GITHUB_OWNER_LOGIN ||
      process.env.SNAPSHOT_GITHUB_OWNER ||
      process.env.SNAPSHOT_GITHUB_SITE_OWNER ||
      "",
    80,
  ).toLowerCase();
  const clientId = sanitizeText(process.env.SNAPSHOT_GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID, 200);
  const clientSecret = String(process.env.SNAPSHOT_GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET || "");
  const sessionSecret = String(process.env.SNAPSHOT_SESSION_SECRET || process.env.SNAPSHOT_AUTH_SECRET || "");
  return {
    clientId,
    clientSecret,
    sessionSecret,
    ownerId,
    ownerLogin,
    ownerLabel: ownerLogin || ownerId,
    enabled: Boolean(clientId && clientSecret && sessionSecret),
  };
}

function githubLoginStartUrl(request, rawReturnTo) {
  const url = new URL(apiEndpointUrl(request, "/api/auth/github/start"));
  const returnTo = sanitizeReturnTo(rawReturnTo, request);
  if (returnTo) {
    url.searchParams.set("returnTo", returnTo);
  }
  return url.toString();
}

function redirectToGithubLogin(request, response, rawReturnTo) {
  if (!githubAuth.enabled) {
    sendJson(response, 501, { error: "GitHub OAuth is not configured on this share API" });
    return;
  }
  const redirectUri = githubCallbackUrl(request);
  const state = signAuthPayload(
    {
      createdAt: Date.now(),
      nonce: randomBytes(18).toString("base64url"),
      returnTo: sanitizeReturnTo(rawReturnTo, request),
    },
    githubAuth.sessionSecret,
  );
  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", githubAuth.clientId);
  githubUrl.searchParams.set("redirect_uri", redirectUri);
  githubUrl.searchParams.set("scope", "read:user");
  githubUrl.searchParams.set("state", state);
  response.writeHead(302, {
    location: githubUrl.toString(),
    "cache-control": "no-store",
  });
  response.end();
}

async function handleGithubCallback(request, response, url) {
  if (!githubAuth.enabled) {
    sendJson(response, 501, { error: "GitHub OAuth is not configured on this share API" });
    return;
  }
  const code = sanitizeText(url.searchParams.get("code"), 400);
  const state = sanitizeText(url.searchParams.get("state"), 8000);
  const statePayload = verifyAuthPayload(state, githubAuth.sessionSecret);

  if (!code || !statePayload || Date.now() - Number(statePayload.createdAt || 0) > 10 * 60 * 1000) {
    sendJson(response, 400, { error: "Invalid or expired GitHub login state" });
    return;
  }

  const accessToken = await exchangeGithubCodeForToken(code, githubCallbackUrl(request));
  const githubUser = await fetchGithubUser(accessToken);
  const sessionUser = sessionUserFromGithubUser(githubUser);
  const cookieValue = signAuthPayload(
    {
      expiresAt: Date.now() + sessionMaxAgeSeconds() * 1000,
      user: sessionUser,
    },
    githubAuth.sessionSecret,
  );
  setSessionCookie(request, response, cookieValue);
  response.writeHead(302, {
    location: sanitizeReturnTo(statePayload.returnTo, request),
    "cache-control": "no-store",
  });
  response.end();
}

async function exchangeGithubCodeForToken(code, redirectUri) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "agent-snapshots-share-api",
    },
    body: JSON.stringify({
      client_id: githubAuth.clientId,
      client_secret: githubAuth.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const message = payload.error_description || payload.error || `GitHub token exchange failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }
  return payload.access_token;
}

async function fetchGithubUser(accessToken) {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "agent-snapshots-share-api",
      "x-github-api-version": "2022-11-28",
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id || !payload.login) {
    const error = new Error(payload.message || `GitHub user lookup failed with HTTP ${response.status}`);
    error.statusCode = 502;
    throw error;
  }
  return payload;
}

function sessionUserFromGithubUser(user) {
  const id = String(user.id || "");
  const login = sanitizeText(user.login, 80);
  const sessionUser = {
    id,
    login,
    name: sanitizeText(user.name, 120),
    avatarUrl: sanitizeUrl(user.avatar_url),
    profileUrl: sanitizeUrl(user.html_url) || `https://github.com/${encodeURIComponent(login)}`,
  };
  sessionUser.isOwner = isSiteOwner(sessionUser);
  return sessionUser;
}

function isSiteOwner(user) {
  if (!user) {
    return false;
  }
  if (githubAuth.ownerId && String(user.id || "") === githubAuth.ownerId) {
    return true;
  }
  return Boolean(githubAuth.ownerLogin && String(user.login || "").toLowerCase() === githubAuth.ownerLogin);
}

function readSessionUser(request) {
  if (!githubAuth.enabled) {
    return null;
  }
  const cookie = readCookies(request)[authCookieName];
  const payload = verifyAuthPayload(cookie, githubAuth.sessionSecret);
  if (!payload || Number(payload.expiresAt || 0) <= Date.now()) {
    return null;
  }
  const rawUser = payload.user || {};
  const user = {
    id: sanitizeText(rawUser.id, 80),
    login: sanitizeText(rawUser.login, 80),
    name: sanitizeText(rawUser.name, 120),
    avatarUrl: sanitizeUrl(rawUser.avatarUrl),
    profileUrl: sanitizeUrl(rawUser.profileUrl),
  };
  if (!user.id || !user.login) {
    return null;
  }
  user.isOwner = isSiteOwner(user);
  return user;
}

function signAuthPayload(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signValue(body, secret)}`;
}

function verifyAuthPayload(value, secret) {
  const text = String(value || "");
  const dot = text.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const body = text.slice(0, dot);
  const signature = text.slice(dot + 1);
  if (!constantTimeEqual(signature, signValue(body, secret))) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function signValue(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookies(request) {
  const cookies = {};
  const header = String(request.headers.cookie || "");
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    const name = rawName ? safeDecodeURIComponent(rawName) : "";
    if (!name) {
      continue;
    }
    cookies[name] = safeDecodeURIComponent(rawValue.join("=") || "");
  }
  return cookies;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function setSessionCookie(request, response, value) {
  response.setHeader(
    "set-cookie",
    serializeCookie(authCookieName, value, {
      httpOnly: true,
      maxAge: sessionMaxAgeSeconds(),
      path: "/",
      sameSite: authCookieSameSite(request),
      secure: authCookieSecure(request),
    }),
  );
}

function clearSessionCookie(request, response) {
  response.setHeader(
    "set-cookie",
    serializeCookie(authCookieName, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: authCookieSameSite(request),
      secure: authCookieSecure(request),
    }),
  );
}

function serializeCookie(name, value, options) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, `Path=${options.path || "/"}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  return parts.join("; ");
}

function sessionMaxAgeSeconds() {
  const value = Number(process.env.SNAPSHOT_AUTH_SESSION_DAYS || 30);
  const days = Number.isFinite(value) && value > 0 ? Math.min(value, 365) : 30;
  return days * 24 * 60 * 60;
}

function authCookieSecure(request) {
  if (process.env.SNAPSHOT_AUTH_COOKIE_SECURE === "false") {
    return false;
  }
  if (process.env.SNAPSHOT_AUTH_COOKIE_SECURE === "true") {
    return true;
  }
  return requestOrigin(request).startsWith("https://");
}

function authCookieSameSite(request) {
  const value = sanitizeText(process.env.SNAPSHOT_AUTH_COOKIE_SAMESITE, 16).toLowerCase();
  if (value === "lax" || value === "strict" || value === "none") {
    return value[0].toUpperCase() + value.slice(1);
  }
  return authCookieSecure(request) ? "None" : "Lax";
}

function githubCallbackUrl(request) {
  return apiEndpointUrl(request, "/api/auth/github/callback");
}

function apiEndpointUrl(request, pathname) {
  const base = requestOrigin(request).replace(/\/+$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${path}`;
}

function requestOrigin(request) {
  const publicApiUrl = sanitizeUrl(process.env.SNAPSHOT_SHARE_PUBLIC_API_URL);
  if (publicApiUrl) {
    return publicApiUrl;
  }
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(request.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (request.socket?.encrypted ? "https" : "http");
  const requestHost = forwardedHost || request.headers.host || `${host}:${port}`;
  return `${protocol}://${requestHost}`;
}

function sanitizeReturnTo(value, request) {
  const fallback = sanitizeUrl(process.env.SNAPSHOT_SHARE_SITE_URL) || requestOrigin(request);
  try {
    const url = new URL(String(value || fallback));
    if (isAllowedWebOrigin(url.origin)) {
      return url.toString();
    }
  } catch {}
  return fallback;
}

function requireAllowedMutationOrigin(request) {
  const origin = sanitizeOrigin(request.headers.origin);
  if (!origin || isAllowedWebOrigin(origin)) {
    return;
  }
  const error = new Error("Origin is not allowed");
  error.statusCode = 403;
  throw error;
}

function readBearerToken(request) {
  const header = request.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function readJsonBody(request, maxBytes) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    throw new Error("Request body is empty");
  }
  return JSON.parse(text);
}

function shareIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/snapshots\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function createShareId() {
  return `snap_${randomBytes(18).toString("base64url")}`;
}

function sanitizeShareId(value) {
  const text = sanitizeText(value, 90);
  return /^snap_[A-Za-z0-9_-]{16,80}$/.test(text) ? text : "";
}

function expiryFromDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) {
    return undefined;
  }
  return new Date(Date.now() + Math.min(days, 365) * 24 * 60 * 60 * 1000).toISOString();
}

function snapshotShareUrl(request, id, rawSiteUrl, rawApiUrl) {
  const requestUrl = `http://${request.headers.host || `${host}:${port}`}`;
  const apiUrl = sanitizeUrl(rawApiUrl) || sanitizeUrl(process.env.SNAPSHOT_SHARE_PUBLIC_API_URL) || requestUrl;
  const siteUrl = sanitizeUrl(rawSiteUrl) || sanitizeUrl(process.env.SNAPSHOT_SHARE_SITE_URL) || apiUrl;
  const viewerPath = sanitizeViewerPath(
    process.env.SNAPSHOT_SHARE_VIEWER_PATH || (sameOrigin(siteUrl, apiUrl) ? "/snapshots/share/" : "/share/")
  );
  const url = new URL(`${siteUrl.replace(/\/+$/, "")}${viewerPath}`);
  url.searchParams.set("id", id);

  if (!sameOrigin(siteUrl, apiUrl)) {
    url.searchParams.set("api", apiUrl);
  }

  return url.toString();
}

function readIntegerParam(value, fallback, max) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function sameOrigin(left, right) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function sanitizeViewerPath(value) {
  const text = sanitizeText(value, 160) || "/snapshots/share/";
  const path = text.startsWith("/") ? text : `/${text}`;
  return path.endsWith("/") ? path : `${path}/`;
}

function sanitizeText(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function sanitizeMultilineText(value, maxLength) {
  return typeof value === "string"
    ? value
        .replace(/\r\n/g, "\n")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, maxLength)
    : "";
}

function sanitizeUrl(value) {
  const text = sanitizeText(value, 400).replace(/\/+$/, "");
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function setCorsHeaders(request, response) {
  const origin = sanitizeOrigin(request.headers.origin);
  if (origin && isAllowedWebOrigin(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-credentials", "true");
    response.setHeader("vary", "origin");
  } else {
    response.setHeader("access-control-allow-origin", "*");
  }
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type");
  response.setHeader("access-control-max-age", "86400");
}

function isAllowedWebOrigin(origin) {
  const normalized = sanitizeOrigin(origin);
  if (!normalized) {
    return false;
  }
  if (isLocalOrigin(normalized)) {
    return true;
  }
  const allowed = new Set(
    [
      sanitizeUrl(process.env.SNAPSHOT_SHARE_SITE_URL),
      sanitizeUrl(process.env.SNAPSHOT_SHARE_PUBLIC_API_URL),
      requestlessLocalApiOrigin(),
      ...String(process.env.SNAPSHOT_AUTH_ALLOWED_ORIGINS || process.env.SNAPSHOT_SHARE_ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => sanitizeUrl(value)),
    ]
      .filter(Boolean)
      .map((value) => new URL(value).origin),
  );
  return allowed.has(normalized);
}

function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function sanitizeOrigin(value) {
  const text = sanitizeText(Array.isArray(value) ? value[0] : value, 400);
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function requestlessLocalApiOrigin() {
  return `http://${host}:${port}`;
}

function sanitizeCookieName(value) {
  const text = sanitizeText(value, 80);
  return /^[A-Za-z0-9._-]+$/.test(text) ? text : "";
}

function sendJson(response, status, data) {
  send(response, status, "application/json; charset=utf-8", `${JSON.stringify(data, null, 2)}\n`);
}

function send(response, status, contentType, body) {
  const headers = {
    "content-type": contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  };
  if (contentType.startsWith("text/html")) {
    // The share page renders untrusted session content and ships no scripts, so
    // a tight policy is safe and blocks injected scripts and remote image beacons.
    headers["content-security-policy"] =
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    headers["x-frame-options"] = "DENY";
    headers["referrer-policy"] = "no-referrer";
  }
  response.writeHead(status, headers);
  response.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") {
    return os.homedir();
  }
  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

function parseArgs(args) {
  const options = {
    dataFile: "",
    host: "",
    port: "",
    token: "",
  };
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--host") {
      options.host = String(args[++index] || "");
      continue;
    }
    if (arg === "--port" || arg === "-p") {
      options.port = String(args[++index] || "");
      continue;
    }
    if (arg === "--data-file") {
      options.dataFile = String(args[++index] || "");
      continue;
    }
    if (arg === "--token") {
      options.token = String(args[++index] || "");
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  return { help, options };
}

function printHelp() {
  console.log(`agent-snapshots share-api

Usage:
  node server/share-api.mjs [--host 127.0.0.1] [--port 8787] [--data-file FILE] [--token TOKEN]

Environment:
	  SNAPSHOT_SHARE_TOKEN       Bearer token required for publish/delete
	                             when GitHub OAuth is not configured
	  SNAPSHOT_SHARE_DATA_FILE   JSON storage file. Defaults to .agent-snapshots/shares.json
	  SNAPSHOT_SHARE_SITE_URL    Base URL used in returned share links
	  SNAPSHOT_SHARE_PUBLIC_API_URL
	                             Public API base used in returned share links
	  SNAPSHOT_SHARE_VIEWER_PATH Share page path. Defaults to /snapshots/share/ for same-origin links,
	                             or /share/ when API and site origins differ
	  SNAPSHOT_GITHUB_CLIENT_ID
	  SNAPSHOT_GITHUB_CLIENT_SECRET
	  SNAPSHOT_SESSION_SECRET    Enables GitHub login for publish/delete
	  SNAPSHOT_GITHUB_OWNER_LOGIN
	  SNAPSHOT_GITHUB_OWNER_ID   Site owner; can delete any shared session
	  SNAPSHOT_AUTH_ALLOWED_ORIGINS
	                             Extra comma-separated browser origins allowed to use login cookies
	  SNAPSHOT_SHARE_ALLOW_UNREDACTED=true
	  SNAPSHOT_SHARE_ALLOW_ANONYMOUS=false
	`);
}
