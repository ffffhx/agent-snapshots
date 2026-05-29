#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const SNAPSHOT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Codex Snapshots"><rect width="64" height="64" rx="14" fill="#17202a"/><path d="M19 16h26a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H19a3 3 0 0 1-3-3V19a3 3 0 0 1 3-3Z" fill="none" stroke="#eef9f6" stroke-width="4"/><path d="M23 22h11M22 23v11M41 42H30M42 41V30" fill="none" stroke="#7dd3c7" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="32" r="9" fill="#f2cc60"/><path d="M27 32h10M32 27v10" stroke="#17202a" stroke-width="3" stroke-linecap="round"/></svg>`;

const parsed = parseArgs(process.argv.slice(2));

if (parsed.help) {
  printHelp();
  process.exit(0);
}

const host = parsed.options.host || process.env.HOST || DEFAULT_HOST;
const port = Number(parsed.options.port || process.env.PORT || DEFAULT_PORT);
const dataFile = path.resolve(
  expandHome(parsed.options.dataFile || process.env.SNAPSHOT_SHARE_DATA_FILE || ".codex-snapshots/shares.json")
);
const shareToken =
  parsed.options.token ||
  process.env.SNAPSHOT_SHARE_TOKEN ||
  process.env.CODEX_SNAPSHOTS_SHARE_TOKEN ||
  process.env.TOKEN_BOARD_AGENT_TOKEN ||
  process.env.TOKEN_BOARD_UPLOAD_TOKEN ||
  "";

const storage = createFileShareStore(dataFile);

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
      setCorsHeaders(response);

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      const shareId = shareIdFromPath(url.pathname);

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
          service: "codex-snapshots-share-api",
          auth: shareToken ? "token" : "disabled",
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
        send(response, 200, "text/html; charset=utf-8", renderSharePage(url.searchParams.get("id") || ""));
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
        requireAuth(request);
        const body = await readJsonBody(request, MAX_BODY_BYTES);
        const snapshot = normalizeSnapshotPayloadForShare(body.snapshot ?? body);

        if (!snapshot.redacted && process.env.SNAPSHOT_SHARE_ALLOW_UNREDACTED !== "true") {
          sendJson(response, 400, {
            error:
              "Refusing to publish an unredacted snapshot. Re-run without --no-redact, or set SNAPSHOT_SHARE_ALLOW_UNREDACTED=true on the server.",
          });
          return;
        }

        const now = new Date().toISOString();
        const record = {
          id: sanitizeShareId(body.shareId) || createShareId(),
          title: snapshot.title,
          engine: snapshot.engine,
          engineLabel: snapshot.engineLabel,
          sourceRef: snapshot.ref,
          createdAt: now,
          updatedAt: now,
          expiresAt: expiryFromDays(body.expiresInDays),
          redacted: snapshot.redacted,
          turnCount: snapshot.turnCount,
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
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            expiresAt: record.expiresAt || null,
            redacted: record.redacted,
            turnCount: record.turnCount,
          },
          snapshot: record.snapshot,
        });
        return;
      }

      if (request.method === "DELETE" && shareId) {
        requireAuth(request);
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

  console.log(`Codex Snapshots share API is running at http://${host}:${port}`);
  console.log(`Storage: ${dataFile}`);
  console.log(`Auth: ${shareToken ? "SNAPSHOT_SHARE_TOKEN required" : "disabled (local/dev only)"}`);
}

function createFileShareStore(filePath) {
  let queue = Promise.resolve();

  function enqueue(operation) {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    putShare(record) {
      return enqueue(async () => {
        const existing = await readShares(filePath);
        await writeShares(filePath, existing.filter((share) => share.id !== record.id).concat(record));
      });
    },
    async getShare(id) {
      const record = (await readShares(filePath)).find((share) => share.id === id);
      return isExpired(record) ? undefined : record;
    },
    async listShares() {
      return (await readShares(filePath))
        .filter((share) => !isExpired(share))
        .sort(compareSharesNewestFirst);
    },
    deleteShare(id) {
      return enqueue(async () => {
        const existing = await readShares(filePath);
        const next = existing.filter((share) => share.id !== id);
        if (next.length === existing.length) {
          return false;
        }
        await writeShares(filePath, next);
        return true;
      });
    },
    async countShares() {
      return (await readShares(filePath)).filter((share) => !isExpired(share)).length;
    },
  };
}

function compareSharesNewestFirst(left, right) {
  const leftTime = new Date(left.updatedAt || left.createdAt || "").getTime();
  const rightTime = new Date(right.updatedAt || right.createdAt || "").getTime();
  const delta = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  return delta || String(right.id).localeCompare(String(left.id));
}

function toShareSummary(record, request, rawSiteUrl, rawApiUrl) {
  return {
    id: record.id,
    title: record.title,
    engine: record.engine,
    engineLabel: record.engineLabel,
    sourceRef: record.sourceRef,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt || null,
    redacted: record.redacted,
    turnCount: record.turnCount,
    url: snapshotShareUrl(request, record.id, rawSiteUrl, rawApiUrl),
  };
}

async function readShares(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray(parsed.entries)
        ? parsed.entries
        : [];
    return entries.flatMap((entry) => normalizeShareRecord(entry) ?? []);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeShares(filePath, records) {
  const dir = path.dirname(filePath);
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );

  await mkdir(dir, { recursive: true });

  try {
    await writeFile(
      tempFile,
      `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), entries: records }, null, 2)}\n`,
      "utf8"
    );
    await rename(tempFile, filePath);
  } catch (error) {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizeShareRecord(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const id = sanitizeText(value.id, 120);
  if (!id) {
    return undefined;
  }

  return {
    id,
    title: sanitizeText(value.title, 240) || id,
    engine: sanitizeText(value.engine, 80) || "codex",
    engineLabel: sanitizeText(value.engineLabel, 80) || "Codex",
    sourceRef: sanitizeText(value.sourceRef, 240) || undefined,
    createdAt: normalizeDate(value.createdAt) || new Date().toISOString(),
    updatedAt: normalizeDate(value.updatedAt) || new Date().toISOString(),
    expiresAt: normalizeDate(value.expiresAt) || undefined,
    redacted: value.redacted !== false,
    turnCount: Number.isFinite(Number(value.turnCount)) ? Number(value.turnCount) : 0,
    snapshot: value.snapshot,
  };
}

function normalizeSnapshotPayloadForShare(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Body must include a snapshot object");
  }

  const payload = removePrivateSnapshotFields(JSON.parse(JSON.stringify(value)));
  const turns = Array.isArray(payload.turns) ? payload.turns : [];
  const title = sanitizeText(payload.title, 180) || "Untitled snapshot";
  const engine = sanitizeText(payload.engine, 80) || "codex";
  const engineLabel = sanitizeText(payload.engineLabel, 80) || "Codex";
  const ref = sanitizeText(payload.ref, 240) || undefined;

  if (!turns.length) {
    throw new Error("Snapshot has no shareable turns");
  }

  sanitizeTurnHtml(payload);

  return {
    title,
    engine,
    engineLabel,
    ref,
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
    if (key === "images") {
      continue;
    }
    value[key] = removePrivateSnapshotFields(item);
  }

  return value;
}

function sanitizeTurnHtml(snapshot) {
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];

  for (const turn of turns) {
    if (!turn || typeof turn !== "object") {
      continue;
    }
    if (typeof turn.text === "string") {
      turn.text = stripCodexAppDirectives(turn.text);
    }
    if (typeof turn.html === "string") {
      turn.html = stripCodexAppDirectiveHtml(sanitizePublishedHtml(turn.html));
    }
  }
}

function sanitizePublishedHtml(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed)>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function stripCodexAppDirectives(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[^\n]*\}[ \t]*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripCodexAppDirectiveHtml(value) {
  return String(value || "")
    .replace(/<p>\s*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[\s\S]*?\}\s*<\/p>/g, "")
    .trim();
}

function renderHome() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Snapshots Share API</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>${shareCss()}</style>
</head>
<body>
  <main class="shell">
    <p class="eyebrow">Codex Snapshots</p>
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

function renderSharePage(initialId) {
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
      <h1 id="title">Loading snapshot</h1>
      <p id="meta" class="meta"></p>
    </header>
    <section id="content" class="turns">Loading...</section>
  </main>
  <script>
const initialId = ${JSON.stringify(initialId)};
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const id = initialId || new URLSearchParams(location.search).get("id") || "";
const title = document.getElementById("title");
const meta = document.getElementById("meta");
const content = document.getElementById("content");
content.addEventListener("click", handleContentLinkClick);

function renderPlainText(value) {
  const visibleText = stripAppDirectives(value);
  if (!visibleText) return "";
  return visibleText.split(/\\n{2,}/).map((block) => "<p>" + esc(block).replace(/\\n/g, "<br>") + "</p>").join("");
}

function renderImages(images) {
  if (!Array.isArray(images) || !images.length) return "";
  return "<div class='attachment-grid'>" + images.map((image, index) => {
    if (!image.src) {
      return "<figure class='image-attachment image-unavailable'><div>" + esc(image.unavailableReason || "Image unavailable") + "</div></figure>";
    }
    return "<figure class='image-attachment'><img src='" + esc(image.src) + "' alt='" + esc(image.alt || ("Image attachment " + (index + 1))) + "' decoding='async'></figure>";
  }).join("") + "</div>";
}

function renderSnapshot(payload) {
  const snapshot = payload.snapshot || {};
  const share = payload.share || {};
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
  title.textContent = share.title || snapshot.title || "Snapshot";
  meta.textContent = [
    share.engineLabel || snapshot.engineLabel || "Codex",
    share.id || snapshot.id || "unknown",
    (share.turnCount ?? turns.length) + " entries",
    "redacted: " + ((share.redacted ?? snapshot.redacted) ? "yes" : "no"),
  ].join(" | ");
  content.innerHTML = turns.length
    ? buildTranscriptItems(turns).map(renderTranscriptItem).join("")
    : "<div class='empty'>This snapshot has no shareable turns.</div>";
  openContentLinksInNewTabs(content);
}

function buildTranscriptItems(turns) {
  const items = [];
  let index = 0;
  let previousUserTurn = null;
  while (index < turns.length) {
    const turn = turns[index];
    if (isUserMessageTurn(turn)) {
      items.push({ kind: "turn", turn });
      previousUserTurn = turn;
      index += 1;
      continue;
    }

    const segment = [];
    while (index < turns.length && !isUserMessageTurn(turns[index])) {
      segment.push(turns[index]);
      index += 1;
    }

    const finalIndex = segment.map(isAssistantMessageTurn).lastIndexOf(true);
    if (finalIndex === -1) {
      if (segment.length) {
        items.push({
          kind: "process",
          turns: segment,
          durationTurns: buildProcessDurationTurns(previousUserTurn, segment),
        });
      }
      continue;
    }
    if (finalIndex === segment.length - 1) {
      const processTurns = segment.slice(0, finalIndex);
      const finalTurn = segment[finalIndex];
      if (processTurns.length) {
        items.push({
          kind: "process",
          turns: processTurns,
          durationTurns: buildProcessDurationTurns(previousUserTurn, processTurns.concat(finalTurn)),
        });
      }
      items.push({ kind: "turn", turn: finalTurn });
      continue;
    }
    items.push({
      kind: "process",
      turns: segment,
      durationTurns: buildProcessDurationTurns(previousUserTurn, segment),
    });
  }
  return items;
}

function buildProcessDurationTurns(startTurn, turns) {
  return [startTurn, ...turns].filter(Boolean);
}

function isUserMessageTurn(turn) {
  return turn && turn.kind !== "tool" && turn.role === "user";
}

function isAssistantMessageTurn(turn) {
  return turn && turn.kind !== "tool" && turn.role === "assistant";
}

function renderTranscriptItem(item, index) {
  if (item.kind === "process") {
    return renderProcessGroup(item, index);
  }
  return renderTurn(item.turn);
}

function renderTurn(turn) {
  const role = turn.kind === "tool" ? "tool" : turn.role === "user" ? "user" : "assistant";
  return "<article class='turn " + esc(role) + "'><div class='message-card'><div class='body'>" + renderTurnBody(turn) + "</div></div></article>";
}

function renderProcessGroup(item, index) {
  const turns = item.turns || [];
  if (!turns.length) {
    return "";
  }
  return "<article class='turn process'><details class='process-details' data-process-index='" + esc(index) + "'><summary class='process-summary'><span>" + esc(processLabel(item.durationTurns || turns)) + "</span></summary><div class='process-body'>" + turns.map(renderProcessEntry).join("") + "</div></details></article>";
}

function renderProcessEntry(turn) {
  const role = turn.kind === "tool" ? "tool" : turn.role === "user" ? "user" : "assistant";
  return "<section class='process-entry process-" + esc(role) + "'><div class='body'>" + renderTurnBody(turn) + "</div></section>";
}

function renderTurnBody(turn) {
  if (turn.kind === "tool") {
    return "<details class='tool-details'><summary>Tool" + (turn.name ? " / " + esc(turn.name) : "") + "</summary><pre>" + esc(turn.text || "") + "</pre></details>";
  }
  return (stripAppDirectiveHtml(turn.html || "") || renderPlainText(turn.text)) + renderImages(turn.images || []);
}

function processLabel(turns) {
  const duration = processDurationLabel(turns);
  return duration ? "Processed " + duration : "Processed";
}

function processDurationLabel(turns) {
  const times = turns.map((turn) => new Date(turn.timestamp || "").getTime()).filter(Number.isFinite);
  if (times.length < 2) {
    return "";
  }
  const seconds = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
  if (seconds < 60) {
    return seconds + "s";
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest ? minutes + "m " + rest + "s" : minutes + "m";
  }
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? hours + "h " + minuteRest + "m" : hours + "h";
}

function stripAppDirectives(value) {
  return String(value || "")
    .replace(/\\r\\n/g, "\\n")
    .replace(/^[ \\t]*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\\{[^\\n]*\\}[ \\t]*$/gm, "")
    .replace(/[ \\t]+\\n/g, "\\n")
    .replace(/\\n{3,}/g, "\\n\\n")
    .trim();
}

function stripAppDirectiveHtml(value) {
  return String(value || "")
    .replace(/<p>\\s*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\\{[\\s\\S]*?\\}\\s*<\\/p>/g, "")
    .trim();
}

function handleContentLinkClick(event) {
  const link = event.target.closest?.("a[href]");
  if (!link) {
    return;
  }
  event.preventDefault();
  openInNewTab(link.href);
}

function openContentLinksInNewTabs(root) {
  for (const link of root.querySelectorAll("a[href]")) {
    link.target = "_blank";
    link.rel = mergeLinkRel(link.rel);
  }
}

function openInNewTab(url) {
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
    opened.focus?.();
    return;
  }
  window.location.href = url;
}

function mergeLinkRel(value) {
  const rel = new Set(String(value || "").split(/\\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  return Array.from(rel).join(" ");
}

async function load() {
  if (!id) {
    title.textContent = "Missing share id";
    content.textContent = "Open a link with ?id=...";
    return;
  }
  const response = await fetch("/api/snapshots/" + encodeURIComponent(id), { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Failed to load snapshot");
  }
  renderSnapshot(payload);
}

load().catch((error) => {
  title.textContent = "Snapshot unavailable";
  content.textContent = error instanceof Error ? error.message : String(error);
});
  </script>
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

function requireAuth(request) {
  if (!shareToken && process.env.SNAPSHOT_SHARE_ALLOW_ANONYMOUS !== "false") {
    return;
  }
  const token = readBearerToken(request);
  if (token && token === shareToken) {
    return;
  }
  const error = new Error("Login required");
  error.statusCode = 401;
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

function normalizeDate(value) {
  const date = typeof value === "string" ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function isExpired(record) {
  return Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() <= Date.now());
}

function sanitizeText(value, maxLength) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
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

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type");
  response.setHeader("access-control-max-age", "86400");
}

function sendJson(response, status, data) {
  send(response, status, "application/json; charset=utf-8", `${JSON.stringify(data, null, 2)}\n`);
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
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
  console.log(`codex-snapshots share-api

Usage:
  node server/share-api.mjs [--host 127.0.0.1] [--port 8787] [--data-file FILE] [--token TOKEN]

Environment:
  SNAPSHOT_SHARE_TOKEN       Bearer token required for publish/delete
  SNAPSHOT_SHARE_DATA_FILE   JSON storage file. Defaults to .codex-snapshots/shares.json
  SNAPSHOT_SHARE_SITE_URL    Base URL used in returned share links
  SNAPSHOT_SHARE_PUBLIC_API_URL
                             Public API base used in returned share links
  SNAPSHOT_SHARE_VIEWER_PATH Share page path. Defaults to /snapshots/share/ for same-origin links,
                             or /share/ when API and site origins differ
  SNAPSHOT_SHARE_ALLOW_UNREDACTED=true
  SNAPSHOT_SHARE_ALLOW_ANONYMOUS=false
`);
}
