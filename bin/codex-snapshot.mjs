#!/usr/bin/env node

import { createReadStream, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import hljs from "highlight.js";
import markdownit from "markdown-it";

const VERSION = "0.1.0";
const DEFAULT_LIMIT = 40;
const DEFAULT_SERVER_LIMIT = 80;
const MAX_TEXT_CHARS = 20000;
const MAX_SUMMARY_LINES = 140;
const TOOL_OUTPUT_PREVIEW_CHARS = 24000;
const MAX_INLINE_IMAGE_CHARS = 5_000_000;
const DEFAULT_TRAE_RECORDER_PORT = 4732;
const MAX_TRAE_CAPTURE_POST_BYTES = 64 * 1024 * 1024;
const DEFAULT_SNAPSHOT_SHARE_API_URL = "http://127.0.0.1:8787";
const DEFAULT_SNAPSHOT_SHARE_SITE_URL = "http://127.0.0.1:8787";
const SNAPSHOT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Codex Snapshots"><rect width="64" height="64" rx="14" fill="#17202a"/><path d="M19 16h26a3 3 0 0 1 3 3v26a3 3 0 0 1-3 3H19a3 3 0 0 1-3-3V19a3 3 0 0 1 3-3Z" fill="none" stroke="#eef9f6" stroke-width="4"/><path d="M23 22h11M22 23v11M41 42H30M42 41V30" fill="none" stroke="#7dd3c7" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="32" r="9" fill="#f2cc60"/><path d="M27 32h10M32 27v10" stroke="#17202a" stroke-width="3" stroke-linecap="round"/></svg>`;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

const MARKDOWN_LANGUAGE_ALIASES = new Map([
  ["plain", "plaintext"],
  ["plaintext", "plaintext"],
  ["text", "plaintext"],
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["yml", "yaml"],
]);

const markdownRenderer = markdownit({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
  highlight: renderHighlightedCode,
});
configureMarkdownLinks(markdownRenderer);

function configureMarkdownLinks(renderer) {
  const defaultRender = renderer.renderer.rules.link_open || ((tokens, index, options, env, self) => {
    return self.renderToken(tokens, index, options);
  });

  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index];
    setMarkdownTokenAttr(token, "target", "_blank");
    setMarkdownTokenAttr(token, "rel", mergeRelValue(token.attrGet("rel")));
    return defaultRender(tokens, index, options, env, self);
  };
}

function setMarkdownTokenAttr(token, name, value) {
  const index = token.attrIndex(name);
  if (index < 0) {
    token.attrPush([name, value]);
    return;
  }
  token.attrs[index][1] = value;
}

function mergeRelValue(value) {
  const rel = new Set(String(value || "").split(/\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  return Array.from(rel).join(" ");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help || parsed.command === "help" || !parsed.command) {
    printHelp();
    return;
  }

  const codexHome = path.resolve(parsed.options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const claudeHome = path.resolve(parsed.options.claudeHome || process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"));
  const traeHome = path.resolve(parsed.options.traeHome || process.env.TRAE_HOME || path.join(os.homedir(), ".trae-cn"));
  const traeAppHome = path.resolve(parsed.options.traeAppHome || process.env.TRAE_APP_HOME || path.join(os.homedir(), "Library", "Application Support", "Trae CN"));
  const traeRecordingsDir = path.resolve(parsed.options.traeRecordingsDir || process.env.TRAE_RECORDINGS_DIR || path.join(os.homedir(), ".codex-snapshot", "trae-recordings"));

  if (parsed.command === "list") {
    const sessions = await listSessions({
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      limit: parsed.options.limit || DEFAULT_LIMIT,
      cwd: parsed.options.cwd,
      includeArchived: parsed.options.includeArchived,
      source: parsed.options.source,
    });
    if (parsed.options.json) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      printSessionList(sessions);
    }
    return;
  }

  if (parsed.command === "preview") {
    const ref = parsed.positionals[0];
    if (!ref) {
      throw new Error("preview requires a session id or JSONL path");
    }
    const snapshot = await loadSnapshot(ref, {
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      includeTools: parsed.options.includeTools,
      includeToolOutput: parsed.options.includeToolOutput,
      redact: !parsed.options.noRedact,
    });
    if (parsed.options.json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      console.log(renderTextPreview(snapshot));
    }
    return;
  }

  if (parsed.command === "export") {
    const ref = parsed.positionals[0];
    if (!ref) {
      throw new Error("export requires a session id or JSONL path");
    }
    const format = parsed.options.format || (parsed.options.md ? "md" : "html");
    const snapshot = await loadSnapshot(ref, {
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      includeTools: parsed.options.includeTools,
      includeToolOutput: parsed.options.includeToolOutput,
      redact: !parsed.options.noRedact,
    });
    const output = format === "md" ? renderMarkdown(snapshot) : renderHtml(snapshot);
    if (parsed.options.output) {
      await mkdir(path.dirname(path.resolve(parsed.options.output)), { recursive: true });
      await writeFile(parsed.options.output, output, "utf8");
      console.log(path.resolve(parsed.options.output));
    } else {
      console.log(output);
    }
    return;
  }

  if (parsed.command === "publish") {
    const ref = parsed.positionals[0];
    if (!ref) {
      throw new Error("publish requires a session id or JSONL path");
    }
    if (parsed.options.noRedact && !parsed.options.allowUnredacted) {
      throw new Error("publish refuses --no-redact unless --allow-unredacted is also set");
    }
    const snapshot = await loadSnapshot(ref, {
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      includeTools: parsed.options.includeTools,
      includeToolOutput: parsed.options.includeToolOutput,
      redact: !parsed.options.noRedact,
    });
    applySafetyChecksOption(snapshot, Boolean(parsed.options.withSafety));
    const result = await publishSnapshot(snapshot, {
      apiUrl: parsed.options.apiUrl,
      token: parsed.options.shareToken,
      siteUrl: parsed.options.siteUrl,
      expiresInDays: parsed.options.expiresInDays,
    });
    console.log(`Published ${snapshot.engineLabel || "Codex"} snapshot: ${snapshot.title}`);
    console.log(`Share id: ${result.id}`);
    console.log(`URL: ${result.url}`);
    return;
  }

  if (parsed.command === "serve") {
    const port = parsed.options.port || 4321;
    const host = parsed.options.host || "127.0.0.1";
    await serve({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, host, port });
    return;
  }

  if (parsed.command === "record-trae") {
    const port = parsed.options.port || DEFAULT_TRAE_RECORDER_PORT;
    const host = parsed.options.host || "127.0.0.1";
    await serveTraeRecorder({
      host,
      port,
      traeRecordingsDir,
      recordSensitiveContext: parsed.options.recordSensitiveContext,
    });
    return;
  }

  throw new Error(`unknown command: ${parsed.command}`);
}

function parseArgs(args) {
  const options = {
    codexHome: "",
    cwd: "",
    format: "",
    help: false,
    host: "",
    includeArchived: true,
    includeToolOutput: false,
    includeTools: false,
    json: false,
    limit: 0,
    md: false,
    noRedact: false,
    output: "",
    port: 0,
    apiUrl: "",
    siteUrl: "",
    shareToken: "",
    expiresInDays: 0,
    allowUnredacted: false,
    withSafety: false,
    source: "codex",
    claudeHome: "",
    traeAppHome: "",
    traeHome: "",
    traeRecordingsDir: "",
    recordSensitiveContext: false,
  };
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--version") {
      console.log(VERSION);
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--html") {
      options.format = "html";
      continue;
    }
    if (arg === "--md" || arg === "--markdown") {
      options.format = "md";
      options.md = true;
      continue;
    }
    if (arg === "--include-tools") {
      options.includeTools = true;
      continue;
    }
    if (arg === "--include-tool-output") {
      options.includeToolOutput = true;
      options.includeTools = true;
      continue;
    }
    if (arg === "--no-redact") {
      options.noRedact = true;
      continue;
    }
    if (arg === "--record-sensitive-context") {
      options.recordSensitiveContext = true;
      continue;
    }
    if (arg === "--allow-unredacted") {
      options.allowUnredacted = true;
      continue;
    }
    if (arg === "--with-safety") {
      options.withSafety = true;
      continue;
    }
    if (arg === "--live-only") {
      options.includeArchived = false;
      continue;
    }
    if (arg === "--codex-home" || arg === "--claude-home" || arg === "--trae-home" || arg === "--trae-app-home" || arg === "--trae-recordings-dir" || arg === "--cwd" || arg === "--limit" || arg === "--output" || arg === "-o" || arg === "--port" || arg === "--host" || arg === "--source" || arg === "--api-url" || arg === "--site-url" || arg === "--share-token" || arg === "--expires-in-days") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--codex-home") {
        options.codexHome = value;
      } else if (arg === "--claude-home") {
        options.claudeHome = value;
      } else if (arg === "--trae-home") {
        options.traeHome = value;
      } else if (arg === "--trae-app-home") {
        options.traeAppHome = value;
      } else if (arg === "--trae-recordings-dir") {
        options.traeRecordingsDir = value;
      } else if (arg === "--cwd") {
        options.cwd = value;
      } else if (arg === "--limit") {
        options.limit = readPositiveInteger(value, "--limit");
      } else if (arg === "--output" || arg === "-o") {
        options.output = value;
      } else if (arg === "--port") {
        options.port = readPositiveInteger(value, "--port");
      } else if (arg === "--host") {
        options.host = value;
      } else if (arg === "--source") {
        if (!["codex", "claude", "trae", "all"].includes(value)) {
          throw new Error("--source must be codex, claude, trae, or all");
        }
        options.source = value;
      } else if (arg === "--api-url") {
        options.apiUrl = value;
      } else if (arg === "--site-url") {
        options.siteUrl = value;
      } else if (arg === "--share-token") {
        options.shareToken = value;
      } else if (arg === "--expires-in-days") {
        options.expiresInDays = readPositiveInteger(value, "--expires-in-days");
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  return {
    command: positionals[0] || "",
    options,
    positionals: positionals.slice(1),
  };
}

function readPositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function readNonNegativeInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

async function publishSnapshot(snapshot, { apiUrl, token, siteUrl, expiresInDays, shareId }) {
  const normalizedApiUrl = resolveShareApiUrl(apiUrl);
  const shareToken = resolveShareToken(token);
  const normalizedSiteUrl = resolveShareSiteUrl(siteUrl);

  if (!normalizedApiUrl) {
    throw new Error("Missing share API URL. Set SNAPSHOT_SHARE_API_URL or pass --api-url.");
  }
  if (!shareToken) {
    throw new Error("Missing share API token. Set SNAPSHOT_SHARE_TOKEN, pass --share-token, or create ~/.codex-snapshots-agent.json.");
  }

  let response;

  try {
    response = await fetch(`${normalizedApiUrl}/api/snapshots`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${shareToken}`,
        "Content-Type": "application/json",
        "User-Agent": `codex-snapshot/${VERSION}`,
      },
      body: JSON.stringify({
        snapshot: prepareSnapshotForCloud(snapshot),
        siteUrl: normalizedSiteUrl,
        apiUrl: normalizedApiUrl,
        expiresInDays: expiresInDays || undefined,
        shareId: shareId || undefined,
      }),
    });
  } catch (error) {
    throw new Error(formatShareApiNetworkError(error, normalizedApiUrl));
  }

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = { error: text };
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Publish failed with HTTP ${response.status}`);
  }
  if (!payload?.id || !payload?.url) {
    throw new Error("Publish response did not include a share id and URL");
  }

  return payload;
}

function formatShareApiNetworkError(error, apiUrl) {
  const reason = error?.cause?.code || error?.cause?.message || error?.message || String(error);
  return `Could not connect to share API at ${apiUrl}: ${reason}. Start codex-snapshot-share or set SNAPSHOT_SHARE_API_URL to the running share API.`;
}

function resolveShareApiUrl(apiUrl) {
  const config = readDefaultShareConfig();
  return normalizeUrl(
    apiUrl ||
      process.env.SNAPSHOT_SHARE_API_URL ||
      process.env.TOKEN_BOARD_API_URL ||
      process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL ||
      process.env.CODEX_SNAPSHOTS_SHARE_API_URL ||
      config.apiUrl ||
      DEFAULT_SNAPSHOT_SHARE_API_URL
  );
}

function resolveShareToken(token) {
  const config = readDefaultShareConfig();
  return (
    token ||
    process.env.SNAPSHOT_SHARE_TOKEN ||
    process.env.CODEX_SNAPSHOTS_SHARE_TOKEN ||
    process.env.TOKEN_BOARD_AGENT_TOKEN ||
    process.env.TOKEN_BOARD_UPLOAD_TOKEN ||
    config.token ||
    ""
  );
}

function resolveShareSiteUrl(siteUrl) {
  const config = readDefaultShareConfig();
  return normalizeUrl(siteUrl || process.env.SNAPSHOT_SHARE_SITE_URL || config.siteUrl || DEFAULT_SNAPSHOT_SHARE_SITE_URL);
}

function browserShareConfig() {
  return {
    apiUrl: resolveShareApiUrl(""),
    siteUrl: resolveShareSiteUrl(""),
  };
}

async function publishAllSnapshots({
  codexHome,
  claudeHome,
  traeHome,
  traeAppHome,
  traeRecordingsDir,
  cwd,
  includeArchived,
  source,
  completeOnly,
  limit,
  includeTools,
  includeToolOutput,
  safety,
}) {
  const sessions = await listSessions({
    codexHome,
    claudeHome,
    traeHome,
    traeAppHome,
    traeRecordingsDir,
    limit,
    cwd,
    includeArchived,
    source,
    completeOnly,
  });
  const results = [];
  const failures = [];

  for (const session of sessions) {
    const ref = session.ref || session.id;
    if (!ref) {
      failures.push({
        id: "",
        title: session.title || "Untitled session",
        error: "missing session ref",
      });
      continue;
    }

    try {
      const snapshot = await loadSnapshot(ref, {
        codexHome,
        claudeHome,
        traeHome,
        traeAppHome,
        traeRecordingsDir,
        includeTools,
        includeToolOutput,
        redact: true,
      });
      applySafetyChecksOption(snapshot, safety);
      const result = await publishSnapshot(snapshot, {
        apiUrl: "",
        token: "",
        siteUrl: "",
        expiresInDays: 0,
        shareId: stableSnapshotShareId(snapshot),
      });
      results.push({
        id: snapshot.ref || ref,
        title: snapshot.title || session.title || ref,
        url: result.url,
      });
    } catch (error) {
      failures.push({
        id: ref,
        title: session.title || ref,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    total: sessions.length,
    published: results.length,
    failed: failures.length,
    firstUrl: results[0]?.url || "",
    sampleUrls: results.slice(0, 5),
    failures: failures.slice(0, 20),
  };
}

function stableSnapshotShareId(snapshot) {
  const source = [
    snapshot.engine || "codex",
    snapshot.ref || snapshot.id || snapshot.title || "",
  ].join(":");
  const digest = createHash("sha256").update(source).digest("base64url").slice(0, 32);
  return `snap_${digest}`;
}

let defaultShareConfigCache;

function readDefaultShareConfig() {
  if (defaultShareConfigCache) {
    return defaultShareConfigCache;
  }

  defaultShareConfigCache = {
    apiUrl: "",
    siteUrl: "",
    token: "",
  };

  const filePaths = [
    process.env.CODEX_SNAPSHOTS_AGENT_FILE,
    process.env.SNAPSHOT_SHARE_TOKEN_FILE,
    process.env.TOKEN_BOARD_AGENT_FILE,
    path.join(os.homedir(), ".codex-snapshots-agent.json"),
    path.join(os.homedir(), ".token-board-agent.json"),
  ].filter(Boolean);

  for (const filePath of filePaths) {
    try {
      const payload = JSON.parse(readFileSync(filePath, "utf8"));
      const config = {
        apiUrl: firstNonEmptyString(
          payload.snapshotShareApiUrl,
          payload.snapshotSharePublicApiUrl,
          payload.shareApiUrl,
          payload.publicApiUrl,
          payload.apiUrl
        ),
        siteUrl: firstNonEmptyString(payload.snapshotShareSiteUrl, payload.shareSiteUrl, payload.siteUrl),
        token: firstNonEmptyString(payload.snapshotShareToken, payload.agentToken, payload.token, payload.uploadToken),
      };
      if (config.apiUrl || config.siteUrl || config.token) {
        defaultShareConfigCache = config;
        return defaultShareConfigCache;
      }
    } catch {}
  }

  return defaultShareConfigCache;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function prepareSnapshotForCloud(snapshot) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  delete copy.cwd;
  delete copy.filePath;
  delete copy.displayFilePath;
  copy.cloudShared = true;
  copy.cloudSharedAt = new Date().toISOString();
  return removePrivatePathFields(copy);
}

function removePrivatePathFields(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(removePrivatePathFields);
  }
  for (const key of ["cwd", "filePath", "displayFilePath"]) {
    delete value[key];
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "images") {
      continue;
    }
    value[key] = removePrivatePathFields(item);
  }
  return value;
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

async function listSessions({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, limit, cwd, includeArchived, source = "codex", completeOnly = false }) {
  if (source === "all") {
    const [codexSessions, claudeSessions, traeSessions] = await Promise.all([
      listCodexSessions({ codexHome, limit, cwd, includeArchived }),
      listClaudeSessions({ claudeHome, limit, cwd }),
      listTraeSessions({ traeHome, traeAppHome, traeRecordingsDir, limit, cwd }),
    ]);
    const sessions = [...codexSessions, ...claudeSessions, ...traeSessions]
      .filter((summary) => !completeOnly || isCompleteSessionSummary(summary))
      .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
    return Number.isFinite(limit) ? sessions.slice(0, limit) : sessions;
  }
  if (source === "claude") {
    return filterSessionCompleteness(await listClaudeSessions({ claudeHome, limit, cwd }), completeOnly);
  }
  if (source === "trae") {
    return filterSessionCompleteness(await listTraeSessions({ traeHome, traeAppHome, traeRecordingsDir, limit, cwd }), completeOnly);
  }
  return filterSessionCompleteness(await listCodexSessions({ codexHome, limit, cwd, includeArchived }), completeOnly);
}

function filterSessionCompleteness(sessions, completeOnly) {
  return completeOnly ? sessions.filter((summary) => isCompleteSessionSummary(summary)) : sessions;
}

function isCompleteSessionSummary(summary) {
  if (summary.engine === "claude") {
    return summary.sourceKind === "transcript";
  }
  if (summary.engine === "trae") {
    return summary.sourceKind === "recorded";
  }
  return true;
}

async function listCodexSessions({ codexHome, limit, cwd, includeArchived }) {
  const titleIndex = await readTitleIndex(codexHome);
  const files = await discoverSessionFiles(codexHome, includeArchived);
  const cwdFilter = cwd ? path.resolve(cwd) : "";
  const summaries = [];
  const unlimited = !Number.isFinite(limit);
  const scanLimit = unlimited ? files.length : Math.max(limit * 4, limit);

  for (const fileInfo of files.slice(0, scanLimit)) {
    const summary = await scanSessionSummary(fileInfo.filePath, fileInfo, titleIndex);
    if (cwdFilter && summary.cwd && !path.resolve(summary.cwd).startsWith(cwdFilter)) {
      continue;
    }
    summaries.push(summary);
    if (!unlimited && summaries.length >= limit) {
      break;
    }
  }

  return summaries;
}

async function discoverSessionFiles(codexHome, includeArchived = true) {
  const roots = [path.join(codexHome, "sessions")];
  if (includeArchived) {
    roots.push(path.join(codexHome, "archived_sessions"));
  }
  const files = [];
  for (const root of roots) {
    await collectJsonlFiles(root, files);
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

async function collectJsonlFiles(dir, files) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectJsonlFiles(entryPath, files);
        return;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        return;
      }
      const info = await stat(entryPath);
      files.push({
        filePath: entryPath,
        size: info.size,
        mtimeMs: info.mtimeMs,
        mtime: info.mtime.toISOString(),
      });
    }),
  );
}

async function readTitleIndex(codexHome) {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  const map = new Map();
  let raw = "";
  try {
    raw = await readFile(indexPath, "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const row = JSON.parse(line);
      if (row.id && row.thread_name) {
        map.set(row.id, row.thread_name);
      }
    } catch {
      // Ignore malformed index rows.
    }
  }
  return map;
}

async function scanSessionSummary(filePath, fileInfo, titleIndex) {
  const fallbackId = sessionIdFromPath(filePath);
  const summary = {
    id: fallbackId,
    title: "",
    cwd: "",
    filePath,
    size: fileInfo.size,
    mtime: fileInfo.mtime,
    createdAt: "",
    modelProvider: "",
    source: "",
    messageCount: 0,
    toolCallCount: 0,
    riskCount: 0,
  };
  let firstUser = "";
  let lineCount = 0;

  for await (const row of readJsonl(filePath)) {
    lineCount += 1;
    if (row.type === "session_meta" && row.payload) {
      summary.id = row.payload.id || summary.id;
      summary.cwd = row.payload.cwd || "";
      summary.createdAt = row.payload.timestamp || "";
      summary.modelProvider = row.payload.model_provider || "";
      summary.source = row.payload.originator || row.payload.source || "";
    }
    if (row.type === "response_item" && row.payload) {
      if (row.payload.type === "message" && (row.payload.role === "user" || row.payload.role === "assistant")) {
        const message = extractMessageParts(row.payload);
        const text = stripCodexAppDirectives(message.text);
        if (!isBootstrapUserMessage(row.payload.role, text) && (text || message.images.length)) {
          summary.messageCount += 1;
          if (!firstUser && row.payload.role === "user") {
            firstUser = text ? truncateForTitle(text) : "[image]";
          }
        }
      }
      if (isToolPayload(row.payload)) {
        summary.toolCallCount += 1;
      }
      const text = extractMessageText(row.payload) || row.payload.arguments || row.payload.output || "";
      if (text) {
        if (!isBootstrapUserMessage(row.payload.role, text)) {
          summary.riskCount += detectRisks(text).length;
        }
      }
    }
    if (summary.id && summary.cwd && firstUser && lineCount >= 8) {
      break;
    }
    if (lineCount >= MAX_SUMMARY_LINES) {
      break;
    }
  }

  summary.title = titleIndex.get(summary.id) || firstUser || summary.id;
  summary.engine = "codex";
  summary.engineLabel = "Codex";
  summary.projectKind = projectKindForCodexCwd(summary.cwd);
  summary.ref = `codex:${summary.id}`;
  summary.displayCwd = redactText(summary.cwd || "");
  summary.displayFilePath = redactText(summary.filePath || "");
  return summary;
}

function projectKindForCodexCwd(cwd) {
  if (!cwd) {
    return "none";
  }
  return isCodexStandaloneConversationCwd(cwd) ? "conversation" : "project";
}

function isCodexStandaloneConversationCwd(cwd) {
  const parts = String(cwd || "").trim().replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  const codexIndex = parts.findIndex((part, index) => part === "Codex" && parts[index - 1] === "Documents");
  if (codexIndex < 0 || codexIndex + 3 !== parts.length) {
    return false;
  }
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(parts[codexIndex + 1]) && Boolean(parts[codexIndex + 2]);
}

async function loadSnapshot(ref, { codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, includeTools, includeToolOutput, redact }) {
  const target = splitSnapshotRef(ref);
  if (target.engine === "claude") {
    return loadClaudeSnapshot(target.ref, {
      claudeHome,
      includeTools,
      includeToolOutput,
      redact,
    });
  }
  if (target.engine === "trae") {
    return loadTraeSnapshot(target.ref, {
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      includeTools,
      includeToolOutput,
      redact,
    });
  }
  return loadCodexSnapshot(target.ref, {
    codexHome,
    includeTools,
    includeToolOutput,
    redact,
  });
}

async function loadCodexSnapshot(ref, { codexHome, includeTools, includeToolOutput, redact }) {
  const titleIndex = await readTitleIndex(codexHome);
  const filePath = await resolveSessionRef(ref, codexHome);
  const fileInfo = await stat(filePath);
  const summary = await scanSessionSummary(filePath, {
    filePath,
    size: fileInfo.size,
    mtimeMs: fileInfo.mtimeMs,
    mtime: fileInfo.mtime.toISOString(),
  }, titleIndex);
  const risks = new Map();
  const turns = [];
  let turnNumber = 0;

  for await (const row of readJsonl(filePath)) {
    if (row.type !== "response_item" || !row.payload) {
      continue;
    }
    const item = row.payload;
    if (item.type === "message") {
      if (item.role !== "user" && item.role !== "assistant") {
        continue;
      }
      const message = extractMessageParts(item);
      const rawMessageText = message.text;
      if (isBootstrapUserMessage(item.role, rawMessageText)) {
        continue;
      }
      const rawText = stripCodexAppDirectives(rawMessageText);
      if (!rawText.trim() && !message.images.length) {
        continue;
      }
      turnNumber += 1;
      addRisks(risks, rawText, turnNumber);
      addImageRisk(risks, message.images.length, turnNumber);
      const text = redact ? redactText(rawText) : rawText;
      turns.push({
        kind: "message",
        role: item.role,
        turn: turnNumber,
        text,
        html: renderMarkdownHtml(text),
        images: message.images,
        timestamp: row.timestamp || "",
      });
      continue;
    }
    if (includeTools && isToolPayload(item)) {
      const rawText = renderToolText(item, includeToolOutput);
      if (!rawText.trim()) {
        continue;
      }
      addRisks(risks, rawText, turnNumber || 1);
      turns.push({
        kind: "tool",
        role: "tool",
        turn: turnNumber || 1,
        name: toolName(item),
        text: redact ? redactText(rawText) : rawText,
        timestamp: row.timestamp || "",
      });
    }
  }

  return {
    ...summary,
    engine: "codex",
    engineLabel: "Codex",
    ref: `codex:${summary.id}`,
    displayCwd: redact ? redactText(summary.cwd || "") : summary.cwd,
    displayFilePath: redact ? redactText(summary.filePath || "") : summary.filePath,
    generatedAt: new Date().toISOString(),
    redacted: redact,
    includeTools,
    includeToolOutput,
    notices: [],
    risks: [...risks.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    turns,
  };
}

function splitSnapshotRef(ref) {
  if (ref.startsWith("claude:")) {
    return { engine: "claude", ref: ref.slice("claude:".length) };
  }
  if (ref.startsWith("trae:")) {
    return { engine: "trae", ref: ref.slice("trae:".length) };
  }
  if (ref.startsWith("codex:")) {
    return { engine: "codex", ref: ref.slice("codex:".length) };
  }
  return { engine: "codex", ref };
}

async function listClaudeSessions({ claudeHome, limit, cwd }) {
  const files = await discoverClaudeSessionFiles(claudeHome);
  const cwdFilter = cwd ? path.resolve(cwd) : "";
  const summaries = [];
  const fileSessionIds = new Set();

  for (const fileInfo of files) {
    const summary = await scanClaudeFileSessionSummary(fileInfo.filePath, fileInfo, claudeHome);
    fileSessionIds.add(summary.id);
    if (cwdFilter && summary.cwd && !path.resolve(summary.cwd).startsWith(cwdFilter)) {
      continue;
    }
    summaries.push(summary);
  }

  for (const historyGroup of await readClaudeHistoryGroups(claudeHome, fileSessionIds)) {
    const { entries: _entries, ...summary } = historyGroup;
    if (cwdFilter && summary.cwd && !path.resolve(summary.cwd).startsWith(cwdFilter)) {
      continue;
    }
    summaries.push(summary);
  }

  summaries.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
  return Number.isFinite(limit) ? summaries.slice(0, limit) : summaries;
}

async function discoverClaudeSessionFiles(claudeHome) {
  const roots = [path.join(claudeHome, "projects"), path.join(claudeHome, "sessions")];
  const files = [];
  for (const root of roots) {
    await collectJsonlFiles(root, files);
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

async function scanClaudeFileSessionSummary(filePath, fileInfo, claudeHome) {
  const summary = createClaudeSummary({
    id: sessionIdFromPath(filePath),
    filePath,
    size: fileInfo.size,
    mtime: fileInfo.mtime,
    sourceKind: "transcript",
  });
  summary.cwd = cwdFromClaudeProjectPath(filePath, claudeHome);
  let firstUser = "";
  let lineCount = 0;

  for await (const row of readJsonl(filePath)) {
    lineCount += 1;
    if (row.sessionId) {
      summary.id = row.sessionId;
    }
    if (row.cwd) {
      summary.cwd = row.cwd;
    }
    const timestamp = normalizeClaudeTimestamp(row.timestamp);
    if (timestamp && !summary.createdAt) {
      summary.createdAt = timestamp;
    }
    const role = claudeRole(row);
    if (!role) {
      continue;
    }
    const message = extractClaudeMessageParts(row.message || row);
    const rawText = stripCodexAppDirectives(message.text);
    summary.toolCallCount += message.toolCalls.length + message.toolResults.length;
    if (rawText || message.images.length) {
      summary.messageCount += 1;
      if (!firstUser && role === "user" && !isClaudeCommand(rawText)) {
        firstUser = rawText ? truncateForTitle(rawText) : "[image]";
      }
      summary.riskCount += detectRisks(rawText).length;
      if (message.images.length) {
        summary.riskCount += 1;
      }
    }
    for (const tool of message.toolCalls) {
      summary.riskCount += detectRisks(tool.text).length;
    }
    if (summary.id && summary.cwd && firstUser && lineCount >= 12) {
      break;
    }
    if (lineCount >= MAX_SUMMARY_LINES) {
      break;
    }
  }

  summary.title = firstUser || summary.id;
  return finishClaudeSummary(summary);
}

async function readClaudeHistoryGroups(claudeHome, excludeIds = new Set()) {
  const historyPath = path.join(claudeHome, "history.jsonl");
  let info;
  try {
    info = await stat(historyPath);
  } catch {
    return [];
  }

  const groups = new Map();
  let fallbackIndex = 0;
  for await (const row of readJsonl(historyPath)) {
    const id = row.sessionId || `history-${fallbackIndex += 1}`;
    if (excludeIds.has(id)) {
      continue;
    }
    const timestamp = normalizeClaudeTimestamp(row.timestamp) || info.mtime.toISOString();
    if (!groups.has(id)) {
      groups.set(id, createClaudeSummary({
        id,
        filePath: historyPath,
        size: info.size,
        mtime: timestamp,
        sourceKind: "history",
        entries: [],
      }));
    }
    const group = groups.get(id);
    group.entries.push(row);
    group.cwd = row.project || group.cwd;
    group.createdAt = group.createdAt || timestamp;
    if (new Date(timestamp).getTime() > new Date(group.mtime).getTime()) {
      group.mtime = timestamp;
    }
    const display = String(row.display || "").trim();
    if (!display) {
      continue;
    }
    group.messageCount += 1;
    group.riskCount += detectRisks(display).length;
    if (!group.title && !isClaudeCommand(display)) {
      group.title = truncateForTitle(display);
    }
  }

  return [...groups.values()].map((group) => finishClaudeSummary({
    ...group,
    title: group.title || group.id,
  }));
}

function createClaudeSummary({ id, filePath, size, mtime, sourceKind, entries }) {
  return {
    id,
    title: "",
    cwd: "",
    filePath,
    size,
    mtime,
    createdAt: "",
    modelProvider: "anthropic",
    source: "claude-code",
    sourceKind,
    messageCount: 0,
    toolCallCount: 0,
    riskCount: 0,
    entries,
  };
}

function finishClaudeSummary(summary) {
  summary.engine = "claude";
  summary.engineLabel = "Claude Code";
  summary.ref = `claude:${summary.id}`;
  summary.historyOnly = summary.sourceKind === "history";
  summary.sourceDetail = summary.historyOnly ? "history only" : "full transcript";
  summary.displayCwd = redactText(summary.cwd || "");
  summary.displayFilePath = redactText(summary.filePath || "");
  return summary;
}

async function loadClaudeSnapshot(ref, { claudeHome, includeTools, includeToolOutput, redact }) {
  const resolved = await resolveClaudeSessionRef(ref, claudeHome);
  if (resolved.kind === "history") {
    return loadClaudeHistorySnapshot(resolved.group, { includeTools, includeToolOutput, redact });
  }
  return loadClaudeFileSnapshot(resolved.filePath, { claudeHome, includeTools, includeToolOutput, redact });
}

async function loadClaudeFileSnapshot(filePath, { claudeHome, includeTools, includeToolOutput, redact }) {
  const fileInfo = await stat(filePath);
  const summary = await scanClaudeFileSessionSummary(filePath, {
    filePath,
    size: fileInfo.size,
    mtimeMs: fileInfo.mtimeMs,
    mtime: fileInfo.mtime.toISOString(),
  }, claudeHome);
  const risks = new Map();
  const turns = [];
  let turnNumber = 0;

  for await (const row of readJsonl(filePath)) {
    const role = claudeRole(row);
    if (!role) {
      continue;
    }
    const message = extractClaudeMessageParts(row.message || row);
    const rawText = stripCodexAppDirectives(message.text);
    if (rawText.trim() || message.images.length) {
      turnNumber += 1;
      addRisks(risks, rawText, turnNumber);
      addImageRisk(risks, message.images.length, turnNumber);
      const text = redact ? redactText(rawText) : rawText;
      turns.push({
        kind: "message",
        role,
        turn: turnNumber,
        text,
        html: renderMarkdownHtml(text),
        images: message.images,
        timestamp: normalizeClaudeTimestamp(row.timestamp),
      });
    }
    if (includeTools) {
      for (const tool of message.toolCalls) {
        addRisks(risks, tool.text, turnNumber || 1);
        turns.push({
          kind: "tool",
          role: "tool",
          turn: turnNumber || 1,
          name: tool.name,
          text: redact ? redactText(tool.text) : tool.text,
          timestamp: normalizeClaudeTimestamp(row.timestamp),
        });
      }
      for (const tool of message.toolResults) {
        const text = includeToolOutput ? tool.text : "Tool output hidden. Re-run with Output enabled to include it.";
        addRisks(risks, text, turnNumber || 1);
        turns.push({
          kind: "tool",
          role: "tool",
          turn: turnNumber || 1,
          name: tool.name,
          text: redact ? redactText(text) : text,
          timestamp: normalizeClaudeTimestamp(row.timestamp),
        });
      }
    }
  }

  return {
    ...summary,
    displayCwd: redact ? redactText(summary.cwd || "") : summary.cwd,
    displayFilePath: redact ? redactText(summary.filePath || "") : summary.filePath,
    generatedAt: new Date().toISOString(),
    redacted: redact,
    includeTools,
    includeToolOutput,
    notices: [],
    risks: [...risks.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    turns,
  };
}

async function loadClaudeHistorySnapshot(group, { includeTools, includeToolOutput, redact }) {
  const risks = new Map();
  const turns = [];
  let turnNumber = 0;
  for (const row of group.entries || []) {
    const rawText = stripCodexAppDirectives(row.display);
    if (!rawText) {
      continue;
    }
    turnNumber += 1;
    addRisks(risks, rawText, turnNumber);
    const text = redact ? redactText(rawText) : rawText;
    turns.push({
      kind: "message",
      role: "user",
      turn: turnNumber,
      text,
      html: renderMarkdownHtml(text),
      images: [],
      timestamp: normalizeClaudeTimestamp(row.timestamp),
    });
  }

  const { entries: _entries, ...summary } = group;
  return {
    ...summary,
    displayCwd: redact ? redactText(summary.cwd || "") : summary.cwd,
    displayFilePath: redact ? redactText(summary.filePath || "") : summary.filePath,
    generatedAt: new Date().toISOString(),
    redacted: redact,
    includeTools,
    includeToolOutput,
    notices: [{
      severity: "medium",
      label: "History only",
      text: "No Claude Code transcript file was found under ~/.claude/projects or ~/.claude/sessions for this session, so this preview is built from ~/.claude/history.jsonl and contains user prompts only.",
    }],
    risks: [...risks.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    turns,
  };
}

async function resolveClaudeSessionRef(ref, claudeHome) {
  const maybePath = path.resolve(ref);
  if (ref.endsWith(".jsonl")) {
    assertInsideClaudeHome(maybePath, claudeHome);
    return { kind: "file", filePath: maybePath };
  }

  const files = await discoverClaudeSessionFiles(claudeHome);
  const exact = files.find((file) => sessionIdFromPath(file.filePath) === ref || path.basename(file.filePath, ".jsonl") === ref);
  if (exact) {
    return { kind: "file", filePath: exact.filePath };
  }

  for (const file of files) {
    const summary = await scanClaudeFileSessionSummary(file.filePath, file, claudeHome);
    if (summary.id === ref || summary.id.startsWith(ref)) {
      return { kind: "file", filePath: file.filePath };
    }
  }

  const groups = await readClaudeHistoryGroups(claudeHome);
  const group = groups.find((item) => item.id === ref || item.id.startsWith(ref));
  if (group) {
    return { kind: "history", group };
  }
  throw new Error(`Claude Code session not found: ${ref}`);
}

function claudeRole(row) {
  const role = row.message?.role || row.role || row.type;
  return role === "user" || role === "assistant" ? role : "";
}

function extractClaudeMessageParts(message) {
  const parts = [];
  const images = [];
  const toolCalls = [];
  const toolResults = [];
  const content = message?.content;

  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      if (typeof item?.text === "string" && (item.type === "text" || !item.type)) {
        parts.push(item.text);
        continue;
      }
      const image = extractClaudeImageAttachment(item, images.length + 1);
      if (image) {
        images.push(image);
        continue;
      }
      if (item?.type === "tool_use") {
        toolCalls.push({
          name: item.name || "tool_use",
          text: renderClaudeToolCall(item),
        });
        continue;
      }
      if (item?.type === "tool_result") {
        toolResults.push({
          name: item.tool_use_id || "tool_result",
          text: trimLongText(stringifyClaudeContent(item.content), TOOL_OUTPUT_PREVIEW_CHARS),
        });
      }
    }
  }

  return {
    text: trimLongText(parts.join("\n\n").trim(), MAX_TEXT_CHARS),
    images,
    toolCalls,
    toolResults,
  };
}

function renderClaudeToolCall(item) {
  return `Tool call: ${item.name || "unknown"}\n${trimLongText(stringifyClaudeContent(item.input || {}), TOOL_OUTPUT_PREVIEW_CHARS)}`;
}

function stringifyClaudeContent(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (typeof item?.text === "string") {
        return item.text;
      }
      return JSON.stringify(item, null, 2);
    }).join("\n\n");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value || "");
}

function extractClaudeImageAttachment(item, index) {
  if (item?.type !== "image") {
    return null;
  }
  const source = item.source || {};
  const src = source.type === "base64" && source.data
    ? `data:${source.media_type || "image/png"};base64,${source.data}`
    : source.type === "url"
      ? source.url || ""
      : "";
  const safe = isSafeImageSource(src);
  const srcLength = src.length;
  const tooLarge = srcLength > MAX_INLINE_IMAGE_CHARS;
  return {
    alt: `Image attachment ${index}`,
    detail: "",
    mimeType: source.media_type || imageMimeType(src),
    size: imageSourceSize(src),
    src: safe && !tooLarge ? src : "",
    unavailableReason: !safe ? "Unsupported image source" : tooLarge ? `Image is larger than ${formatBytes(MAX_INLINE_IMAGE_CHARS)}` : "",
  };
}

function normalizeClaudeTimestamp(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function cwdFromClaudeProjectPath(filePath, claudeHome) {
  const projectsRoot = path.join(claudeHome, "projects");
  const relative = path.relative(projectsRoot, path.dirname(filePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  const projectDir = relative.split(path.sep)[0] || "";
  if (!projectDir.startsWith("-")) {
    return "";
  }
  return projectDir.replace(/-/g, "/");
}

function isClaudeCommand(text) {
  return String(text || "").trim().startsWith("/");
}

async function listTraeSessions({ traeHome, traeAppHome, traeRecordingsDir, limit, cwd }) {
  const [recordedSessions, memorySessions, inputHistorySessions] = await Promise.all([
    readTraeRecordedSummaries(traeRecordingsDir),
    readTraeMemorySummaries(traeHome),
    readTraeInputHistorySummaries(traeAppHome),
  ]);
  const cwdFilter = cwd ? path.resolve(cwd) : "";
  const sessions = [...recordedSessions, ...memorySessions, ...inputHistorySessions]
    .filter((summary) => !cwdFilter || !summary.cwd || path.resolve(summary.cwd).startsWith(cwdFilter))
    .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
  return Number.isFinite(limit) ? sessions.slice(0, limit) : sessions;
}

async function readTraeRecordedSummaries(traeRecordingsDir) {
  const files = [];
  await collectJsonlFiles(traeRecordingsDir, files);
  const summaries = [];
  for (const fileInfo of files) {
    const records = await readTraeCaptureRecords(fileInfo.filePath);
    for (const group of groupTraeRecordedRecords(fileInfo, records)) {
      const summary = await scanTraeRecordedSummaryFromRecords(fileInfo, group.records, group.id);
      if (summary) {
        summaries.push(summary);
      }
    }
  }
  return summaries;
}

async function scanTraeRecordedSummary(fileInfo) {
  const records = await readTraeCaptureRecords(fileInfo.filePath);
  return scanTraeRecordedSummaryFromRecords(fileInfo, records, path.basename(fileInfo.filePath, ".jsonl"));
}

function groupTraeRecordedRecords(fileInfo, records) {
  if (!records.length) {
    return [];
  }
  const fallbackId = path.basename(fileInfo.filePath, ".jsonl");
  const groups = new Map();
  for (const record of records) {
    const key = record.domThreadId || record.captureSessionId || record.actualSessionId || record.pageSession || fallbackId;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(record);
  }
  return [...groups.entries()].map(([id, groupRecords]) => ({
    id: safeCaptureId(id || fallbackId),
    records: groupRecords,
  }));
}

async function scanTraeRecordedSummaryFromRecords(fileInfo, records, captureId) {
  if (!records.length) {
    return null;
  }
  const { turns } = buildTraeRecordedTurns(records, { redact: false });
  if (!turns.length) {
    return null;
  }
  const firstUser = turns.find((turn) => turn.role === "user" && turn.text.trim());
  const firstAssistant = turns.find((turn) => turn.role === "assistant" && turn.text.trim());
  const firstRecord = records[0] || {};
  const lastRecord = records[records.length - 1] || {};
  const cwd = records.map(extractTraeCwdFromRecord).find(Boolean) || "";
  const title = firstUser?.text || firstAssistant?.text || firstRecord.pageTitle || "Trae local capture";
  const createdAt = firstRecord.capturedAt || "";
  const lastTimestamp = lastRecord.capturedAt || fileInfo.mtime;
  const summary = createTraeSummary({
    id: `recorded-${captureId || path.basename(fileInfo.filePath, ".jsonl")}`,
    filePath: fileInfo.filePath,
    filePaths: [fileInfo.filePath],
    size: fileInfo.size,
    mtime: normalizeRecordedTimestamp(lastTimestamp) || fileInfo.mtime,
    cwd,
    sourceKind: "recorded",
  });
  summary.title = truncateForTitle(title);
  summary.createdAt = normalizeRecordedTimestamp(createdAt);
  summary.messageCount = turns.length;
  summary.toolCallCount = records.length;
  summary.riskCount = turns.reduce((total, turn) => total + detectRisks(turn.text).length, 0);
  summary.recordGroupId = captureId || "";
  const actualSessionIds = uniqueStrings(records.map((record) => record.actualSessionId).filter(Boolean));
  summary.actualSessionIds = summary.recordGroupId.startsWith("dom-thread")
    ? actualSessionIds.filter((id) => safeCaptureId(id) === summary.recordGroupId)
    : actualSessionIds;
  summary.captureSessionIds = uniqueStrings(records.map((record) => record.domThreadId || record.captureSessionId).filter(Boolean));
  return finishTraeSummary(summary);
}

async function readTraeCaptureRecords(filePath) {
  const records = [];
  for await (const row of readJsonl(filePath)) {
    if (row && typeof row === "object" && String(row.schema || "").startsWith("trae-local-recorder-event")) {
      records.push(row);
    }
  }
  records.sort((a, b) => {
    const seqA = Number(a.sequence || 0);
    const seqB = Number(b.sequence || 0);
    if (seqA !== seqB) {
      return seqA - seqB;
    }
    return new Date(a.capturedAt || 0).getTime() - new Date(b.capturedAt || 0).getTime();
  });
  return records;
}

async function loadTraeRecordedSnapshot(summary, { includeTools, includeToolOutput, redact }) {
  const allRecords = await readTraeCaptureRecords(summary.filePath);
  const records = summary.recordGroupId
    ? allRecords.filter((record) => {
      const key = safeCaptureId(record.domThreadId || record.captureSessionId || record.actualSessionId || record.pageSession || "");
      return key === summary.recordGroupId;
    })
    : allRecords;
  const { risks, turns } = buildTraeRecordedTurns(records, { redact });
  const notices = [{
    severity: "medium",
    label: "Local recorder",
    text: "This transcript was reconstructed from opt-in local Trae DOM, fetch, WebSocket, EventSource, and stream capture events. Raw capture events are preserved in the local JSONL file for re-parsing.",
  }];
  if (!turns.length && records.length) {
    notices.push({
      severity: "medium",
      label: "No extracted turns",
      text: "Capture events were recorded, but no user or assistant message fields matched the current parser heuristics yet.",
    });
  }
  return {
    ...summary,
    displayCwd: redact ? redactText(summary.cwd || "") : summary.cwd,
    displayFilePath: redact ? redactText(summary.filePath || "") : summary.filePath,
    generatedAt: new Date().toISOString(),
    redacted: redact,
    includeTools,
    includeToolOutput,
    notices,
    risks,
    turns,
  };
}

function buildTraeRecordedTurns(records, { redact }) {
  const turns = [];
  const seen = new Set();
  const pendingDeltas = new Map();
  const replaceableTurns = new Map();
  let turnNumber = 0;

  function flushDelta(key) {
    const pending = pendingDeltas.get(key);
    if (!pending) {
      return;
    }
    pendingDeltas.delete(key);
    pushTurn(pending.role, pending.text, pending.timestamp);
  }

  function flushAllDeltas() {
    for (const key of [...pendingDeltas.keys()]) {
      flushDelta(key);
    }
  }

  function pushTurn(role, rawText, timestamp, options = {}) {
    const cleaned = cleanCapturedMessageText(rawText);
    if (!cleaned || isNoiseCapturedMessage(cleaned)) {
      return;
    }
    if (options.replaceKey && replaceableTurns.has(options.replaceKey)) {
      const existing = replaceableTurns.get(options.replaceKey);
      existing.rawText = cleaned;
      existing.text = redact ? redactText(cleaned) : cleaned;
      existing.html = renderMarkdownHtml(existing.text);
      existing.timestamp = normalizeRecordedTimestamp(timestamp) || existing.timestamp;
      return;
    }
    const dedupeKey = stableHash(`${role}\0${normalizeDedupeText(cleaned)}`);
    const last = turns[turns.length - 1];
    if (seen.has(dedupeKey) || (last && last.role === role && normalizeDedupeText(last.rawText || last.text) === normalizeDedupeText(cleaned))) {
      return;
    }
    seen.add(dedupeKey);
    turnNumber += 1;
    const text = redact ? redactText(cleaned) : cleaned;
    const turn = {
      kind: "message",
      role,
      turn: turnNumber,
      rawText: cleaned,
      text,
      html: renderMarkdownHtml(text),
      images: [],
      timestamp: normalizeRecordedTimestamp(timestamp),
    };
    turns.push(turn);
    if (options.replaceKey) {
      replaceableTurns.set(options.replaceKey, turn);
    }
  }

  for (const record of expandTraeFetchChunkRecords(records)) {
    const candidates = extractTraeCaptureCandidates(record);
    for (const candidate of candidates) {
      if (candidate.isDelta) {
        const key = `${candidate.role}:${candidate.sourceKey || "stream"}`;
        const pending = pendingDeltas.get(key) || {
          role: candidate.role,
          text: "",
          timestamp: candidate.timestamp,
        };
        pending.text += candidate.text;
        pending.timestamp = candidate.timestamp || pending.timestamp;
        pendingDeltas.set(key, pending);
        continue;
      }
      if (candidate.role === "user") {
        flushAllDeltas();
      } else {
        flushDelta(`${candidate.role}:${candidate.sourceKey || "stream"}`);
      }
      pushTurn(candidate.role, candidate.text, candidate.timestamp, {
        replaceKey: candidate.replaceKey,
      });
    }
  }
  flushAllDeltas();

  const risks = new Map();
  const finalTurns = turns.map((turn, index) => {
    const nextTurn = {
      ...turn,
      turn: index + 1,
    };
    addRisks(risks, nextTurn.rawText || nextTurn.text, nextTurn.turn);
    const { rawText: _rawText, ...publicTurn } = nextTurn;
    return publicTurn;
  });

  return {
    risks: [...risks.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    turns: finalTurns,
  };
}

function expandTraeFetchChunkRecords(records) {
  const expanded = [];
  const buffers = new Map();
  for (const record of records) {
    const key = record.requestId || record.url || record.pageSession || "fetch";
    if (record.kind === "fetch-response-chunk") {
      const existing = buffers.get(key) || { ...record, body: "", kind: "fetch-response" };
      existing.body += String(record.chunk || "");
      existing.capturedAt = record.capturedAt || existing.capturedAt;
      buffers.set(key, existing);
      continue;
    }
    if (record.kind === "fetch-response-end") {
      const existing = buffers.get(key);
      if (existing) {
        expanded.push({ ...existing, capturedAt: record.capturedAt || existing.capturedAt });
        buffers.delete(key);
      }
      continue;
    }
    if (record.kind === "fetch-response" && buffers.has(key)) {
      buffers.delete(key);
    }
    expanded.push(record);
  }
  for (const record of buffers.values()) {
    expanded.push(record);
  }
  return expanded;
}

function extractTraeCaptureCandidates(record) {
  const sourceKey = record.requestId || record.wsId || record.eventSourceId || record.url || record.pageSession || "";
  const defaultRole = defaultRoleForCaptureKind(record.kind);
  const bodyText = String(record.body ?? record.chunk ?? "");
  if (!bodyText.trim()) {
    return [];
  }
  const payloads = parseCapturePayloads(bodyText);
  const candidates = [];
  if (record.kind === "dom-message") {
    for (const payload of payloads) {
      const role = normalizeCaptureRole(payload?.role);
      const text = stringifyCapturedContent(payload?.text ?? payload?.content ?? payload?.message ?? payload);
      if (!role || !text) {
        continue;
      }
      candidates.push({
        role,
        text,
        isDelta: false,
        sourceKey,
        replaceKey: payload?.messageId ? `dom:${payload.messageId}` : "",
        timestamp: payload?.timestamp || record.capturedAt,
      });
    }
    return candidates;
  }
  if (!isLikelyTraeChatNetworkRecord(record, payloads)) {
    return [];
  }
  for (const payload of payloads) {
    collectCaptureMessageCandidates(payload, {
      defaultRole,
      sourceKey,
      timestamp: record.capturedAt,
      depth: 0,
    }, candidates);
  }
  return candidates;
}

function isLikelyTraeChatNetworkRecord(record, payloads) {
  const url = String(record.url || record.responseUrl || "").toLowerCase();
  if (/ide-market|extensions\/vscode|\/gallery\/extensionquery|\/release\/note|\/asr\/get\/a/.test(url)) {
    return false;
  }
  if (record.source === "dom") {
    return true;
  }
  return payloads.some((payload) => hasExplicitChatMessageShape(payload, 0));
}

function hasExplicitChatMessageShape(value, depth) {
  if (!value || depth > 8) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasExplicitChatMessageShape(item, depth + 1));
  }
  if (typeof value !== "object") {
    return false;
  }
  const role = normalizeCaptureRole(value.role || value.sender || value.speaker || value.from || value.author?.role || value.author);
  if (role === "user" || role === "assistant") {
    return Boolean(stringifyCapturedContent(value.content ?? value.text ?? value.message ?? value.parts ?? value.delta ?? value));
  }
  if (Array.isArray(value.messages) || Array.isArray(value.choices)) {
    return true;
  }
  return Object.values(value).some((child) => hasExplicitChatMessageShape(child, depth + 1));
}

function defaultRoleForCaptureKind(kind) {
  if (kind === "fetch-request" || kind === "ws-send") {
    return "user";
  }
  if (kind === "fetch-response" || kind === "ws-message" || kind === "eventsource-message") {
    return "assistant";
  }
  return "";
}

function parseCapturePayloads(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return [];
  }
  const direct = parseMaybeJson(trimmed);
  if (direct.ok) {
    return [direct.value];
  }
  const payloads = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const item = line.trim();
    if (!item || item === "data: [DONE]" || item === "[DONE]") {
      continue;
    }
    const data = item.startsWith("data:") ? item.slice(5).trim() : item;
    const parsed = parseMaybeJson(data);
    if (parsed.ok) {
      payloads.push(parsed.value);
    }
  }
  return payloads.length ? payloads : [trimmed];
}

function parseMaybeJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function collectCaptureMessageCandidates(value, context, candidates) {
  if (context.depth > 10 || value == null) {
    return;
  }
  if (typeof value === "string") {
    const parsed = parseMaybeJson(value.trim());
    if (parsed.ok && parsed.value && typeof parsed.value === "object") {
      collectCaptureMessageCandidates(parsed.value, { ...context, depth: context.depth + 1 }, candidates);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCaptureMessageCandidates(item, { ...context, depth: context.depth + 1 }, candidates);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  const role = normalizeCaptureRole(value.role || value.sender || value.speaker || value.from || value.author?.role || value.author);
  if (role === "tool" || role === "system") {
    return;
  }
  collectOpenAiStyleCandidates(value, context, candidates);
  collectAnthropicStyleCandidates(value, context, candidates);

  for (const key of Object.keys(value)) {
    const child = value[key];
    const lowerKey = key.toLowerCase();
    if (lowerKey === "choices" || lowerKey === "delta") {
      continue;
    }
    const keyRole = roleForCaptureContentKey(lowerKey, context.defaultRole);
    const candidateRole = role || keyRole;
    if (candidateRole) {
      const text = stringifyCapturedContent(child);
      if (text && shouldUseCaptureContentKey(lowerKey, role, keyRole)) {
        candidates.push({
          role: candidateRole,
          text,
          isDelta: isDeltaCaptureObject(value, lowerKey),
          sourceKey: context.sourceKey,
          timestamp: context.timestamp,
        });
        continue;
      }
    }
    if (child && typeof child === "object") {
      collectCaptureMessageCandidates(child, { ...context, depth: context.depth + 1 }, candidates);
    }
  }
}

function collectOpenAiStyleCandidates(value, context, candidates) {
  if (!Array.isArray(value.choices)) {
    return;
  }
  for (const choice of value.choices) {
    if (!choice || typeof choice !== "object") {
      continue;
    }
    const deltaText = stringifyCapturedContent(choice.delta?.content ?? choice.delta?.text);
    if (deltaText) {
      candidates.push({
        role: "assistant",
        text: deltaText,
        isDelta: true,
        sourceKey: context.sourceKey,
        timestamp: context.timestamp,
      });
    }
    const message = choice.message;
    if (message) {
      collectCaptureMessageCandidates(message, { ...context, defaultRole: "assistant", depth: context.depth + 1 }, candidates);
    }
    if (typeof choice.text === "string" && choice.text.trim()) {
      candidates.push({
        role: "assistant",
        text: choice.text,
        isDelta: true,
        sourceKey: context.sourceKey,
        timestamp: context.timestamp,
      });
    }
  }
}

function collectAnthropicStyleCandidates(value, context, candidates) {
  const type = String(value.type || value.event || "").toLowerCase();
  const deltaText = stringifyCapturedContent(value.delta?.text ?? value.delta?.content ?? value.completion);
  if (deltaText && (type.includes("delta") || Object.hasOwn(value, "delta") || Object.hasOwn(value, "completion"))) {
    candidates.push({
      role: "assistant",
      text: deltaText,
      isDelta: true,
      sourceKey: context.sourceKey,
      timestamp: context.timestamp,
    });
  }
  if (Array.isArray(value.content) && normalizeCaptureRole(value.role) === "assistant") {
    const text = stringifyCapturedContent(value.content);
    if (text) {
      candidates.push({
        role: "assistant",
        text,
        isDelta: false,
        sourceKey: context.sourceKey,
        timestamp: context.timestamp,
      });
    }
  }
}

function normalizeCaptureRole(value) {
  const text = String(value || "").toLowerCase();
  if (!text) {
    return "";
  }
  if (/(user|human|customer|client|me)/.test(text)) {
    return "user";
  }
  if (/(assistant|agent|bot|ai|model|claude|gpt|trae)/.test(text)) {
    return "assistant";
  }
  if (/(tool|function)/.test(text)) {
    return "tool";
  }
  if (/(system|developer)/.test(text)) {
    return "system";
  }
  return "";
}

function roleForCaptureContentKey(lowerKey, defaultRole) {
  if (["inputtext", "input", "prompt", "query", "question", "userinput", "utterance"].includes(lowerKey)) {
    return "user";
  }
  if (["answer", "response", "reply", "output", "completion", "assistantmessage", "assistantresponse", "resulttext", "markdown"].includes(lowerKey)) {
    return "assistant";
  }
  if (["content", "text", "message", "value"].includes(lowerKey)) {
    return defaultRole === "user" || defaultRole === "assistant" ? defaultRole : "";
  }
  return "";
}

function shouldUseCaptureContentKey(lowerKey, explicitRole, keyRole) {
  if (explicitRole && ["content", "text", "message", "value"].includes(lowerKey)) {
    return true;
  }
  return Boolean(keyRole);
}

function isDeltaCaptureObject(value, lowerKey) {
  const type = String(value.type || value.event || "").toLowerCase();
  return lowerKey.includes("delta") || type.includes("delta") || Object.hasOwn(value, "delta");
}

function stringifyCapturedContent(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyCapturedContent(item)).filter(Boolean).join("\n");
  }
  if (typeof value !== "object") {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.content === "string") {
    return value.content;
  }
  if (typeof value.markdown === "string") {
    return value.markdown;
  }
  if (typeof value.value === "string") {
    return value.value;
  }
  if (typeof value.message === "string") {
    return value.message;
  }
  if (Array.isArray(value.parts)) {
    return stringifyCapturedContent(value.parts);
  }
  return "";
}

function cleanCapturedMessageText(text) {
  const cleaned = String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
  return repairTraeFlattenedCodeBlocks(stripCodexAppDirectives(cleaned));
}

const TRAE_FLATTENED_CODE_LANGUAGES = new Map([
  ["bash", "bash"],
  ["css", "css"],
  ["html", "html"],
  ["javascript", "js"],
  ["js", "js"],
  ["json", "json"],
  ["jsx", "jsx"],
  ["plaintext", "text"],
  ["plain text", "text"],
  ["text", "text"],
  ["tsx", "tsx"],
  ["ts", "ts"],
  ["typescript", "ts"],
  ["xml", "xml"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
]);

function normalizeTraeFlattenedCodeLanguage(line) {
  const key = String(line || "").trim().toLowerCase();
  return TRAE_FLATTENED_CODE_LANGUAGES.get(key) || "";
}

function isTraeFlattenedLineNumber(line) {
  return /^\d{1,4}$/.test(String(line || "").trim());
}

function looksLikeTraeCodeLine(line) {
  const value = String(line || "").trim();
  if (!value) {
    return false;
  }
  if (/^(\/\/|\/\*|\*|#|<!--)/.test(value)) {
    return true;
  }
  if (/^[}\])>;,{]|.*[{}\[\]();=<>|].*$/.test(value)) {
    return true;
  }
  if (/^(const|let|var|return|if|else|for|while|switch|case|break|continue|await|async|function|class|type|interface|export|import|from|use[A-Z]|set[A-Z]|on[A-Z])\b/.test(value)) {
    return true;
  }
  if (/^[A-Za-z_$][\w$]*(\.|:|\?|\(|<)/.test(value)) {
    return true;
  }
  if (/^<\/?[A-Za-z][\w.-]*/.test(value)) {
    return true;
  }
  return false;
}

function isTraeCodeBlockBoundary(line, nextLine, codeLines, language) {
  const value = String(line || "").trim();
  if (!value) {
    return true;
  }
  if (normalizeTraeFlattenedCodeLanguage(value) && isTraeFlattenedLineNumber(nextLine)) {
    return true;
  }
  if (/^[一二三四五六七八九十]+、/.test(value)) {
    return true;
  }
  if (/^第\s*\d/.test(value)) {
    return true;
  }
  if (/^\d+\.\s+/.test(value) && /[\u4e00-\u9fff]/.test(value)) {
    return true;
  }
  if (/^[A-Za-z_$][\w$]*：/.test(value) && /[\u4e00-\u9fff]/.test(value)) {
    return true;
  }
  if (/^[^:：]{1,32}：/.test(value) && /[\u4e00-\u9fff]/.test(value) && !/[{}()[\];<>]/.test(value)) {
    return true;
  }
  if (/^(要点|支付成功时|组件卸载时|Hook 返回|职责分离|支付与升级解耦|健壮的轮询取消|等级读取兜底|遵循|如果你希望|这部分|返回最新值|用 Promise|没有 uid|否则|命中后|首轮|升级条件|令牌模式)/.test(value)) {
    return true;
  }
  const previous = String(codeLines[codeLines.length - 1] || "").trim();
  const plainTextBlock = language === "text";
  if (!plainTextBlock && /[\u4e00-\u9fff]/.test(value) && !previous.endsWith("//") && !looksLikeTraeCodeLine(value)) {
    return true;
  }
  return false;
}

function repairTraeFlattenedCodeBlocks(text) {
  const lines = String(text || "").split("\n");
  const output = [];
  let changed = false;
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      output.push(line);
      continue;
    }
    if (inFence) {
      output.push(line);
      continue;
    }

    const language = normalizeTraeFlattenedCodeLanguage(line);
    if (!language || !isTraeFlattenedLineNumber(lines[index + 1])) {
      output.push(line);
      continue;
    }

    let cursor = index + 1;
    while (cursor < lines.length && isTraeFlattenedLineNumber(lines[cursor])) {
      cursor += 1;
    }

    const code = [];
    while (cursor < lines.length) {
      const candidate = lines[cursor];
      if (isTraeCodeBlockBoundary(candidate, lines[cursor + 1], code, language)) {
        break;
      }
      code.push(candidate.replace(/\s+$/g, ""));
      cursor += 1;
    }

    if (!code.length) {
      output.push(line);
      continue;
    }

    while (code.length && !code[code.length - 1].trim()) {
      code.pop();
    }
    output.push(`\`\`\`${language}`, ...repairTraeFlattenedCodeLines(code, language), "```");
    changed = true;
    index = cursor - 1;
  }

  return changed ? output.join("\n") : String(text || "");
}

function repairTraeFlattenedCodeLines(lines, language) {
  if (!/^(ts|tsx|js|jsx)$/.test(language)) {
    return lines;
  }
  const repaired = [];
  for (let index = 0; index < lines.length; index += 1) {
    let current = String(lines[index] || "").replace(/\s+$/g, "");
    while (index + 1 < lines.length && shouldJoinTraeCodeLine(current, lines[index + 1])) {
      current = joinTraeCodeLines(current, lines[index + 1]);
      index += 1;
    }
    repaired.push(current);
  }
  return repaired;
}

function shouldJoinTraeCodeLine(currentLine, nextLine) {
  const current = String(currentLine || "").trimEnd();
  const next = String(nextLine || "").trimStart();
  if (!current || !next) {
    return false;
  }
  if (/^[一二三四五六七八九十]+、/.test(next) || /^第\s*\d/.test(next)) {
    return false;
  }
  if (/^(\/\/|\/\*)/.test(next)) {
    return false;
  }
  if (current.endsWith("//")) {
    return true;
  }
  if (/(\.|=|:|\?|,|<|\+|-|\*|\/|&&|\|\||!==|===|!=|==|\bextends|\bimplements|\bawait|\basync|\breturn|\bfrom)\s*$/.test(current)) {
    return true;
  }
  if (/^(=>|\)|\]|\}|[A-Za-z_$][\w$.]*(?:[;),}]|$)|\(|<)/.test(next) && hasOpenTraeExpression(current)) {
    return true;
  }
  if (/^(=>|\(|<|\+\+|--)/.test(next)) {
    return true;
  }
  if (/^(export\s+)?(interface|type|class|function|const|let|var|return|if|for|while|switch|use[A-Z]|set[A-Z]|on[A-Z])$/.test(current)) {
    return true;
  }
  return false;
}

function hasOpenTraeExpression(line) {
  const value = String(line || "");
  const openParen = (value.match(/\(/g) || []).length - (value.match(/\)/g) || []).length;
  const openBracket = (value.match(/\[/g) || []).length - (value.match(/\]/g) || []).length;
  const openAngle = (value.match(/</g) || []).length - (value.match(/>/g) || []).length;
  return openParen > 0 || openBracket > 0 || openAngle > 0;
}

function joinTraeCodeLines(currentLine, nextLine) {
  const current = String(currentLine || "").trimEnd();
  const next = String(nextLine || "").trimStart();
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  if (current.endsWith(".") || /^(\)|\]|\}|,|;)/.test(next) || /^(\(|<|\[)/.test(next)) {
    return current + next;
  }
  return `${current} ${next}`;
}

function isNoiseCapturedMessage(text) {
  const value = String(text || "").trim();
  if (!value || value === "[DONE]") {
    return true;
  }
  if (/^https?:\/\//i.test(value) || /^data:[^,]+,/i.test(value)) {
    return true;
  }
  if (/^[A-Za-z0-9_-]{40,}$/.test(value)) {
    return true;
  }
  return false;
}

function normalizeDedupeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function stableHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 20);
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeRecordedTimestamp(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function extractTraeCwdFromRecord(record) {
  const values = [];
  collectNamedStringValues(record, new Set([
    "cwd",
    "projectpath",
    "workspacepath",
    "workspacefolder",
    "folderpath",
    "rootpath",
  ]), values, 0);
  for (const value of values) {
    const decoded = decodeFileUrlPath(value);
    if (decoded.startsWith("/") || decoded.startsWith("~")) {
      return decoded;
    }
  }
  return "";
}

function collectNamedStringValues(value, keys, results, depth) {
  if (!value || depth > 8 || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNamedStringValues(item, keys, results, depth + 1);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && keys.has(key.toLowerCase())) {
      results.push(child);
    } else if (child && typeof child === "object") {
      collectNamedStringValues(child, keys, results, depth + 1);
    }
  }
}

async function readTraeMemorySummaries(traeHome) {
  const files = [];
  await collectJsonlFiles(path.join(traeHome, "memory", "projects"), files);
  const groups = new Map();

  for (const fileInfo of files) {
    const id = traeMemorySessionIdFromPath(fileInfo.filePath);
    const key = `${cwdFromTraeMemoryPath(fileInfo.filePath, traeHome)}::${id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(fileInfo);
  }

  const summaries = [];
  for (const groupedFiles of groups.values()) {
    summaries.push(await scanTraeMemorySummary(groupedFiles, traeHome));
  }
  return summaries;
}

async function scanTraeMemorySummary(files, traeHome) {
  const sortedFiles = files.slice().sort((a, b) => a.mtimeMs - b.mtimeMs);
  const latestFile = sortedFiles[sortedFiles.length - 1];
  const summary = createTraeSummary({
    id: traeMemorySessionIdFromPath(latestFile.filePath),
    filePath: latestFile.filePath,
    filePaths: sortedFiles.map((file) => file.filePath),
    size: sortedFiles.reduce((total, file) => total + file.size, 0),
    mtime: latestFile.mtime,
    cwd: cwdFromTraeMemoryPath(latestFile.filePath, traeHome),
    sourceKind: "memory",
  });

  for (const fileInfo of sortedFiles) {
    for await (const row of readJsonl(fileInfo.filePath)) {
      const text = renderTraeMemoryText(row);
      if (!text.trim()) {
        continue;
      }
      summary.messageCount += 1;
      summary.riskCount += detectRisks(text).length;
      const timestamp = normalizeTraeTimestamp(row.message_summary_time);
      summary.createdAt = summary.createdAt || timestamp;
      if (timestamp && new Date(timestamp).getTime() > new Date(summary.mtime).getTime()) {
        summary.mtime = timestamp;
      }
      if (!summary.title && row.intent) {
        summary.title = truncateForTitle(String(row.intent));
      }
    }
  }

  summary.title = summary.title || summary.id;
  return finishTraeSummary(summary);
}

async function readTraeInputHistorySummaries(traeAppHome) {
  const workspaces = await discoverTraeWorkspaceStores(traeAppHome);
  const summaries = [];
  for (const workspace of workspaces) {
    const entries = await readTraeInputHistoryEntries(workspace.dbPath);
    if (!entries.length) {
      continue;
    }
    const latestPrompt = entries.slice().reverse().find((entry) => String(entry.inputText || "").trim());
    const summary = createTraeSummary({
      id: `input-history-${workspace.workspaceId}`,
      filePath: workspace.dbPath,
      filePaths: [workspace.dbPath],
      size: workspace.size,
      mtime: workspace.mtime,
      cwd: workspace.cwd,
      sourceKind: "input-history",
    });
    summary.workspaceId = workspace.workspaceId;
    summary.title = latestPrompt ? truncateForTitle(String(latestPrompt.inputText || "")) : "Input history";
    summary.messageCount = entries.length;
    summary.riskCount = entries.reduce((total, entry) => total + detectRisks(traeInputEntryText(entry)).length, 0);
    summaries.push(finishTraeSummary(summary));
  }
  return summaries;
}

async function discoverTraeWorkspaceStores(traeAppHome) {
  const root = path.join(traeAppHome, "User", "workspaceStorage");
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const workspaces = [];
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory()) {
      return;
    }
    const workspaceDir = path.join(root, entry.name);
    const dbPath = path.join(workspaceDir, "state.vscdb");
    let info;
    try {
      info = await stat(dbPath);
    } catch {
      return;
    }
    workspaces.push({
      workspaceId: entry.name,
      dbPath,
      cwd: await readTraeWorkspaceCwd(path.join(workspaceDir, "workspace.json")),
      size: info.size,
      mtime: info.mtime.toISOString(),
    });
  }));
  return workspaces;
}

async function readTraeWorkspaceCwd(workspacePath) {
  let raw = "";
  try {
    raw = await readFile(workspacePath, "utf8");
  } catch {
    return "";
  }
  try {
    const workspace = JSON.parse(raw);
    return decodeFileUrlPath(workspace.folder || workspace.workspace || "");
  } catch {
    return "";
  }
}

function decodeFileUrlPath(value) {
  if (!value) {
    return "";
  }
  if (String(value).startsWith("file://")) {
    try {
      return fileURLToPath(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

async function readTraeInputHistoryEntries(dbPath) {
  const raw = await readSqliteItem(dbPath, "icube-ai-agent-storage-input-history");
  if (!raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => String(entry?.inputText || "").trim())
      : [];
  } catch {
    return [];
  }
}

async function readSqliteItem(dbPath, key) {
  try {
    const { stdout } = await execFileAsync("sqlite3", [
      dbPath,
      `select cast(value as text) from ItemTable where key=${sqliteString(key)};`,
    ], { maxBuffer: 32 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return "";
  }
}

function sqliteString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function createTraeSummary({ id, filePath, filePaths, size, mtime, cwd, sourceKind }) {
  return {
    id,
    title: "",
    cwd: cwd || "",
    filePath,
    filePaths,
    size,
    mtime,
    createdAt: "",
    modelProvider: "trae",
    source: "trae",
    sourceKind,
    messageCount: 0,
    toolCallCount: 0,
    riskCount: 0,
  };
}

function finishTraeSummary(summary) {
  summary.engine = "trae";
  summary.engineLabel = "Trae";
  summary.ref = `trae:${summary.id}`;
  summary.historyOnly = summary.sourceKind === "input-history";
  summary.sourceDetail = summary.sourceKind === "input-history"
    ? "input history only"
    : summary.sourceKind === "recorded"
      ? "local recorder"
      : "memory summary";
  summary.displayCwd = redactText(summary.cwd || "");
  summary.displayFilePath = redactText(summary.filePath || "");
  return summary;
}

async function loadTraeSnapshot(ref, { traeHome, traeAppHome, traeRecordingsDir, includeTools, includeToolOutput, redact }) {
  const resolved = await resolveTraeSessionRef(ref, traeHome, traeAppHome, traeRecordingsDir);
  if (resolved.kind === "recorded") {
    return loadTraeRecordedSnapshot(resolved.summary, { includeTools, includeToolOutput, redact });
  }
  if (resolved.kind === "input-history") {
    return loadTraeInputHistorySnapshot(resolved.summary, { includeTools, includeToolOutput, redact });
  }
  return loadTraeMemorySnapshot(resolved.summary, { includeTools, includeToolOutput, redact });
}

async function resolveTraeSessionRef(ref, traeHome, traeAppHome, traeRecordingsDir) {
  const maybePath = path.resolve(ref);
  if (ref.endsWith(".jsonl")) {
    if (isInsideHome(maybePath, traeRecordingsDir)) {
      const info = await stat(maybePath);
      const summary = await scanTraeRecordedSummary({
        filePath: maybePath,
        size: info.size,
        mtimeMs: info.mtimeMs,
        mtime: info.mtime.toISOString(),
      });
      return { kind: "recorded", summary };
    }
    assertInsideTraeHome(maybePath, traeHome);
    const info = await stat(maybePath);
    const summary = await scanTraeMemorySummary([{
      filePath: maybePath,
      size: info.size,
      mtimeMs: info.mtimeMs,
      mtime: info.mtime.toISOString(),
    }], traeHome);
    return { kind: "memory", summary };
  }

  const [recordedSummaries, memorySummaries, inputHistorySummaries] = await Promise.all([
    readTraeRecordedSummaries(traeRecordingsDir),
    readTraeMemorySummaries(traeHome),
    readTraeInputHistorySummaries(traeAppHome),
  ]);
  const recordedSummary = recordedSummaries.find((summary) => summary.id === ref || summary.id.startsWith(ref));
  if (recordedSummary) {
    return { kind: "recorded", summary: recordedSummary };
  }
  const memorySummary = memorySummaries.find((summary) => summary.id === ref || summary.id.startsWith(ref));
  if (memorySummary) {
    return { kind: "memory", summary: memorySummary };
  }
  const inputSummary = inputHistorySummaries.find((summary) => summary.id === ref || summary.id.startsWith(ref));
  if (inputSummary) {
    return { kind: "input-history", summary: inputSummary };
  }
  throw new Error(`Trae session not found: ${ref}`);
}

async function loadTraeMemorySnapshot(summary, { includeTools, includeToolOutput, redact }) {
  const risks = new Map();
  const turns = [];
  let turnNumber = 0;

  for (const filePath of summary.filePaths || [summary.filePath]) {
    for await (const row of readJsonl(filePath)) {
      const rawText = stripCodexAppDirectives(renderTraeMemoryText(row));
      if (!rawText.trim()) {
        continue;
      }
      turnNumber += 1;
      addRisks(risks, rawText, turnNumber);
      const text = redact ? redactText(rawText) : rawText;
      turns.push({
        kind: "message",
        role: "assistant",
        turn: turnNumber,
        text,
        html: renderMarkdownHtml(text),
        images: [],
        timestamp: normalizeTraeTimestamp(row.message_summary_time),
      });
    }
  }

  return {
    ...summary,
    displayCwd: redact ? redactText(summary.cwd || "") : summary.cwd,
    displayFilePath: redact ? redactText(summary.filePath || "") : summary.filePath,
    generatedAt: new Date().toISOString(),
    redacted: redact,
    includeTools,
    includeToolOutput,
    notices: [{
      severity: "medium",
      label: "Memory summary",
      text: "Trae local storage exposed session memory summaries here, not the full raw user/assistant transcript.",
    }],
    risks: [...risks.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    turns,
  };
}

async function loadTraeInputHistorySnapshot(summary, { includeTools, includeToolOutput, redact }) {
  const entries = await readTraeInputHistoryEntries(summary.filePath);
  const risks = new Map();
  const turns = [];
  let turnNumber = 0;

  for (const entry of entries) {
    const rawText = stripCodexAppDirectives(traeInputEntryText(entry));
    if (!rawText.trim()) {
      continue;
    }
    turnNumber += 1;
    addRisks(risks, rawText, turnNumber);
    if (Array.isArray(entry.multiMedia) && entry.multiMedia.length) {
      addImageRisk(risks, entry.multiMedia.length, turnNumber);
    }
    const text = redact ? redactText(rawText) : rawText;
    turns.push({
      kind: "message",
      role: "user",
      turn: turnNumber,
      text,
      html: renderMarkdownHtml(text),
      images: [],
      timestamp: "",
    });
  }

  return {
    ...summary,
    displayCwd: redact ? redactText(summary.cwd || "") : summary.cwd,
    displayFilePath: redact ? redactText(summary.filePath || "") : summary.filePath,
    generatedAt: new Date().toISOString(),
    redacted: redact,
    includeTools,
    includeToolOutput,
    notices: [{
      severity: "medium",
      label: "Input history only",
      text: "No full Trae transcript was found in local storage for this item, so this preview is built from Trae input history and contains user prompts only.",
    }],
    risks: [...risks.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    turns,
  };
}

function renderTraeMemoryText(row) {
  const blocks = [];
  if (row.intent) {
    blocks.push(`### Intent\n${String(row.intent).trim()}`);
  }
  if (Array.isArray(row.actions) && row.actions.length) {
    blocks.push(`### Actions\n${row.actions.map((item) => `- ${String(item).trim()}`).join("\n")}`);
  }
  if (row.outcome) {
    blocks.push(`### Outcome\n${String(row.outcome).trim()}`);
  }
  if (Array.isArray(row.learned) && row.learned.length) {
    blocks.push(`### Learned\n${row.learned.map((item) => `- ${String(item).trim()}`).join("\n")}`);
  }
  const meta = [
    row.message_summary_time ? `time: ${row.message_summary_time}` : "",
    row.message_id ? `message: ${row.message_id}` : "",
  ].filter(Boolean).join(" | ");
  if (meta) {
    blocks.push(`_${meta}_`);
  }
  if (!blocks.length && row && typeof row === "object") {
    return trimLongText(JSON.stringify(row, null, 2), MAX_TEXT_CHARS);
  }
  return trimLongText(blocks.join("\n\n"), MAX_TEXT_CHARS);
}

function traeInputEntryText(entry) {
  const text = String(entry?.inputText || "").trim();
  const mediaCount = Array.isArray(entry?.multiMedia) ? entry.multiMedia.length : 0;
  return mediaCount ? `${text}\n\n[media attachments: ${mediaCount}]` : text;
}

function traeMemorySessionIdFromPath(filePath) {
  return path.basename(filePath, ".jsonl").replace(/^session_memory_/, "");
}

function cwdFromTraeMemoryPath(filePath, traeHome) {
  const root = path.join(traeHome, "memory", "projects");
  const relative = path.relative(root, path.dirname(filePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  return decodeTraeProjectPath(relative.split(path.sep)[0] || "");
}

function decodeTraeProjectPath(value) {
  const text = String(value || "");
  if (!text.startsWith("-")) {
    return text;
  }
  const parts = text.slice(1).split("-").filter(Boolean);
  if (parts.length >= 4) {
    return `/${parts[0]}/${parts[1]}/${parts[2]}/${parts.slice(3).join("-")}`;
  }
  return `/${parts.join("/")}`;
}

function normalizeTraeTimestamp(value) {
  if (!value) {
    return "";
  }
  const text = String(value).trim();
  const withTimezone = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
    ? `${text.replace(" ", "T")}+08:00`
    : text;
  const date = new Date(withTimezone);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

async function resolveSessionRef(ref, codexHome) {
  const maybePath = path.resolve(ref);
  if (ref.endsWith(".jsonl")) {
    assertInsideCodexHome(maybePath, codexHome);
    return maybePath;
  }

  const files = await discoverSessionFiles(codexHome, true);
  const exact = files.find((file) => sessionIdFromPath(file.filePath) === ref);
  if (exact) {
    return exact.filePath;
  }

  for (const file of files) {
    const summary = await scanSessionSummary(file.filePath, file, new Map());
    if (summary.id === ref || summary.id.startsWith(ref)) {
      return file.filePath;
    }
  }
  throw new Error(`session not found: ${ref}`);
}

function assertInsideCodexHome(filePath, codexHome) {
  assertInsideHome(filePath, codexHome, "Codex");
}

function assertInsideClaudeHome(filePath, claudeHome) {
  assertInsideHome(filePath, claudeHome, "Claude Code");
}

function assertInsideTraeHome(filePath, traeHome) {
  assertInsideHome(filePath, traeHome, "Trae");
}

function isInsideHome(filePath, home) {
  const relative = path.relative(path.resolve(home), filePath);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertInsideHome(filePath, home, label) {
  const relative = path.relative(path.resolve(home), filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`JSONL paths must live inside the ${label} home directory`);
  }
}

async function* readJsonl(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line.trim()) {
        continue;
      }
      try {
        yield JSON.parse(line);
      } catch {
        yield { type: "parse_error", payload: { lineLength: line.length } };
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}

function extractMessageText(item) {
  return extractMessageParts(item).text;
}

function extractMessageParts(item) {
  const parts = [];
  const images = [];
  for (const content of item.content || []) {
    if (typeof content.text === "string") {
      const text = stripImageMarkers(content.text);
      if (text) {
        parts.push(text);
      }
    }
    const image = extractImageAttachment(content, images.length + 1);
    if (image) {
      images.push(image);
    }
  }
  return {
    text: trimLongText(parts.join("\n\n"), MAX_TEXT_CHARS),
    images,
  };
}

function stripImageMarkers(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*<\/?image>\s*$/i.test(line))
    .join("\n")
    .trim();
}

function extractImageAttachment(content, index) {
  const src = typeof content.image_url === "string"
    ? content.image_url.trim()
    : typeof content.imageUrl === "string"
      ? content.imageUrl.trim()
      : typeof content.url === "string"
        ? content.url.trim()
        : "";
  if (!src && content.type !== "input_image") {
    return null;
  }
  const safe = isSafeImageSource(src);
  const srcLength = src.length;
  const tooLarge = srcLength > MAX_INLINE_IMAGE_CHARS;
  return {
    alt: `Image attachment ${index}`,
    detail: typeof content.detail === "string" ? content.detail : "",
    mimeType: imageMimeType(src),
    size: imageSourceSize(src),
    src: safe && !tooLarge ? src : "",
    unavailableReason: !safe ? "Unsupported image source" : tooLarge ? `Image is larger than ${formatBytes(MAX_INLINE_IMAGE_CHARS)}` : "",
  };
}

function isSafeImageSource(src) {
  if (!src) {
    return false;
  }
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(src) || /^https?:\/\//i.test(src);
}

function imageMimeType(src) {
  const match = src.match(/^data:(image\/[^;,]+)[;,]/i);
  if (match) {
    return match[1].toLowerCase();
  }
  if (/^https?:\/\//i.test(src)) {
    const clean = src.split(/[?#]/)[0] || "";
    const ext = path.extname(clean).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") {
      return "image/jpeg";
    }
    if (ext === ".png") {
      return "image/png";
    }
    if (ext === ".gif") {
      return "image/gif";
    }
    if (ext === ".webp") {
      return "image/webp";
    }
  }
  return "image";
}

function imageSourceSize(src) {
  const comma = src.indexOf(",");
  if (!src.startsWith("data:") || comma === -1) {
    return "";
  }
  const base64 = src.slice(comma + 1).replace(/\s/g, "");
  const padding = (base64.match(/=+$/)?.[0].length) || 0;
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  return formatBytes(bytes);
}

function isBootstrapUserMessage(role, text) {
  return role === "user" && (
    text.startsWith("# AGENTS.md instructions for ") ||
    text.includes("<environment_context>")
  );
}

function isToolPayload(item) {
  return item.type === "function_call" || item.type === "function_call_output" || item.type === "web_search_call";
}

function renderToolText(item, includeToolOutput) {
  if (item.type === "function_call") {
    return `Tool call: ${item.name || "unknown"}\n${trimLongText(item.arguments || "", TOOL_OUTPUT_PREVIEW_CHARS)}`;
  }
  if (item.type === "function_call_output") {
    if (!includeToolOutput) {
      return "Tool output hidden. Re-run with --include-tool-output to include it.";
    }
    return trimLongText(item.output || "", TOOL_OUTPUT_PREVIEW_CHARS);
  }
  if (item.type === "web_search_call") {
    return `Web search: ${item.action?.query || item.action?.url || item.status || "completed"}`;
  }
  return "";
}

function toolName(item) {
  if (item.type === "function_call") {
    return item.name || "function_call";
  }
  if (item.type === "function_call_output") {
    return "function_output";
  }
  return "web_search";
}

function trimLongText(text, maxChars) {
  if (!text || text.length <= maxChars) {
    return text || "";
  }
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function sessionIdFromPath(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : base.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "");
}

function truncateForTitle(text) {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > 80 ? `${singleLine.slice(0, 77)}...` : singleLine;
}

function detectRisks(text) {
  const checks = [
    { id: "private-key", label: "Private key block", severity: "high", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
    { id: "jwt", label: "JWT-like token", severity: "high", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
    { id: "api-key", label: "API key or secret assignment", severity: "high", pattern: /\b(api[_-]?key|secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|cookie|authorization)\b\s*[:=]\s*["']?[^"'\s`]{8,}/gi },
    { id: "bearer", label: "Bearer token", severity: "high", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
    { id: "openai-key", label: "OpenAI-style API key", severity: "high", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
    { id: "aws-key", label: "AWS access key", severity: "high", pattern: /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g },
    { id: "home-path", label: "Local home path", severity: "medium", pattern: new RegExp(escapeRegExp(os.homedir()), "g") },
    { id: "internal-domain", label: "Internal-looking domain", severity: "medium", pattern: /\b[A-Za-z0-9.-]+\.(bytedance|byteintl|corp|internal|local)\b/gi },
    { id: "env-file", label: "Environment file mention", severity: "medium", pattern: /(^|[\/\s])\.env([.\w-]*)?\b/g },
  ];

  const risks = [];
  for (const check of checks) {
    const matches = text.match(check.pattern);
    if (matches?.length) {
      risks.push({
        id: check.id,
        label: check.label,
        severity: check.severity,
        count: matches.length,
      });
    }
  }
  return risks;
}

function addRisks(risks, text, turn) {
  for (const risk of detectRisks(text)) {
    addRiskEntry(risks, risk, turn);
  }
}

function addImageRisk(risks, count, turn) {
  if (!count) {
    return;
  }
  addRiskEntry(risks, {
    id: "image-attachment",
    label: "Image attachment",
    severity: "medium",
    count,
  }, turn);
}

function addRiskEntry(risks, risk, turn) {
  const key = risk.id;
  const current = risks.get(key) || {
    id: risk.id,
    label: risk.label,
    severity: risk.severity,
    count: 0,
    turns: [],
  };
  current.count += risk.count;
  if (!current.turns.includes(turn)) {
    current.turns.push(turn);
  }
  risks.set(key, current);
}

function severityRank(severity) {
  if (severity === "high") {
    return 3;
  }
  if (severity === "medium") {
    return 2;
  }
  return 1;
}

function redactText(text) {
  let output = text;
  output = output.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
  output = output.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]");
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, "Bearer [REDACTED]");
  output = output.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "sk-[REDACTED]");
  output = output.replace(/\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]");
  output = output.replace(/\b(api[_-]?key|secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|password|passwd|cookie|authorization)\b(\s*[:=]\s*)["']?[^"'\s`]{8,}/gi, "$1$2[REDACTED]");
  output = output.replace(new RegExp(escapeRegExp(os.homedir()), "g"), "~");
  return output;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printSessionList(sessions) {
  if (!sessions.length) {
    console.log("No Codex sessions found.");
    return;
  }
  for (const session of sessions) {
    const size = formatBytes(session.size).padStart(8, " ");
    const date = formatDate(session.mtime).padEnd(16, " ");
    const risk = session.riskCount ? ` risks:${session.riskCount}` : "";
    const source = (session.engineLabel || "Codex").padEnd(11, " ");
    console.log(`${source} ${session.id.slice(0, 8)}  ${date} ${size}  ${session.title}${risk}`);
    if (session.displayCwd || session.cwd) {
      console.log(`          ${session.displayCwd || session.cwd}`);
    }
  }
}

function renderTextPreview(snapshot) {
  const lines = [
    `${snapshot.title}`,
    `${snapshot.id}`,
    `${snapshot.engineLabel || "Codex"}${snapshot.sourceDetail ? ` | ${snapshot.sourceDetail}` : ""} | ${snapshot.displayCwd || snapshot.cwd || "No cwd"} | ${formatBytes(snapshot.size)} | ${snapshot.turns.length} entries`,
    "",
    `Risks: ${snapshot.risks.length ? snapshot.risks.map((risk) => `${risk.label}(${risk.count})`).join(", ") : "none detected"}`,
    "",
  ];
  for (const turn of snapshot.turns) {
    lines.push(`--- ${turn.role}${turn.kind === "tool" ? `:${turn.name}` : ""} #${turn.turn} ---`);
    const visibleText = stripCodexAppDirectives(turn.text);
    if (visibleText) {
      lines.push(visibleText);
    }
    for (const image of turn.images || []) {
      lines.push(`[image: ${image.mimeType || "image"}${image.size ? `, ${image.size}` : ""}${image.src ? "" : `, ${image.unavailableReason || "unavailable"}`}]`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderMarkdown(snapshot) {
  const lines = [
    `# ${escapeMarkdown(snapshot.title)}`,
    "",
    `- Source: \`${snapshot.engineLabel || "Codex"}\``,
    ...(snapshot.sourceDetail ? [`- Source detail: \`${snapshot.sourceDetail}\``] : []),
    `- Session: \`${snapshot.id}\``,
    `- CWD: \`${snapshot.displayCwd || "unknown"}\``,
    `- Source file: \`${snapshot.displayFilePath || "unknown"}\``,
    `- Generated: \`${snapshot.generatedAt}\``,
    `- Redacted: \`${snapshot.redacted ? "yes" : "no"}\``,
    "",
  ];

  if (snapshot.safetyChecks !== false) {
    lines.push("## Sharing risks", "");
    if (snapshot.risks.length) {
      for (const risk of snapshot.risks) {
        lines.push(`- **${risk.severity.toUpperCase()}** ${risk.label}: ${risk.count} match(es), turns ${risk.turns.join(", ")}`);
      }
    } else {
      lines.push("- No common high-risk patterns detected.");
    }

    if (snapshot.notices?.length) {
      lines.push("", "## Notices", "");
      for (const notice of snapshot.notices) {
        lines.push(`- **${escapeMarkdown(notice.label)}**: ${escapeMarkdown(notice.text)}`);
      }
    }
    lines.push("");
  }

  lines.push("## Transcript", "");
  for (const turn of snapshot.turns) {
    const heading = turn.kind === "tool" ? `Tool: ${turn.name}` : turn.role === "user" ? "User" : "Assistant";
    lines.push(`### ${heading} ${turn.turn}`, "");
    if (turn.kind === "tool") {
      lines.push("```text", turn.text, "```", "");
    } else {
      const visibleText = stripCodexAppDirectives(turn.text);
      if (visibleText) {
        lines.push(visibleText, "");
      }
      for (const image of turn.images || []) {
        if (image.src) {
          lines.push(`![${escapeMarkdown(image.alt || "Image attachment")}](${image.src})`, "");
        } else {
          lines.push(`> [image unavailable: ${escapeMarkdown(image.unavailableReason || "unsupported image source")}]`, "");
        }
      }
    }
  }
  return lines.join("\n");
}

function renderHtml(snapshot) {
  const riskRows = snapshot.risks.length
    ? snapshot.risks.map((risk) => `
      <li class="risk risk-${escapeHtml(risk.severity)}">
        <span>${escapeHtml(risk.severity.toUpperCase())}</span>
        <strong>${escapeHtml(risk.label)}</strong>
        <em>${risk.count} match(es), turns ${escapeHtml(risk.turns.join(", "))}</em>
      </li>`).join("")
    : `<li class="risk risk-low"><span>OK</span><strong>No common high-risk patterns detected</strong><em>Still review before sharing.</em></li>`;
  const noticeRows = (snapshot.notices || []).map((notice) => `
      <li class="risk risk-${escapeHtml(notice.severity || "medium")}">
        <span>NOTE</span>
        <strong>${escapeHtml(notice.label || "Notice")}</strong>
        <em>${escapeHtml(notice.text || "")}</em>
      </li>`).join("");
  const riskPanel = snapshot.safetyChecks === false ? "" : `
    <section class="risk-panel">
      <div>
        <p class="eyebrow">Share review</p>
        <h2>${snapshot.risks.length} risk type${snapshot.risks.length === 1 ? "" : "s"} flagged</h2>
      </div>
      <ul>${noticeRows}${riskRows}</ul>
    </section>`;
  const turns = buildStaticTranscriptItems(snapshot.turns || []).map(renderStaticTranscriptItem).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(snapshot.title)} - Codex Snapshot</title>
  <link rel="icon" type="image/svg+xml" href="${snapshotLogoDataUri()}">
  <style>${snapshotCss()}</style>
</head>
<body>
  <main class="snapshot-shell">
    <header class="snapshot-header">
      <div>
        <p class="eyebrow">${escapeHtml(snapshot.engineLabel || "Codex")} read-only snapshot</p>
        <h1>${escapeHtml(snapshot.title)}</h1>
      </div>
      <dl class="meta-grid">
        <div><dt>Session</dt><dd>${escapeHtml(snapshot.id)}</dd></div>
        <div><dt>Generated</dt><dd>${escapeHtml(formatDate(snapshot.generatedAt))}</dd></div>
        <div><dt>Size</dt><dd>${escapeHtml(formatBytes(snapshot.size))}</dd></div>
        <div><dt>Redacted</dt><dd>${snapshot.redacted ? "yes" : "no"}</dd></div>
        ${snapshot.sourceDetail ? `<div><dt>Source detail</dt><dd>${escapeHtml(snapshot.sourceDetail)}</dd></div>` : ""}
      </dl>
    </header>
    <section class="path-band">
      <span>CWD</span>
      <code>${escapeHtml(snapshot.displayCwd || "unknown")}</code>
    </section>
    ${riskPanel}
    <section class="transcript">
      ${turns || `<p class="empty">No shareable user or assistant messages found.</p>`}
    </section>
    <footer class="snapshot-footer">Generated by codex-snapshot ${VERSION}. Static read-only file.</footer>
  </main>
</body>
</html>`;
}

function buildStaticTranscriptItems(turns) {
  const items = [];
  let index = 0;
  let previousUserTurn = null;
  while (index < turns.length) {
    const turn = turns[index];
    if (isStaticUserMessageTurn(turn)) {
      items.push({ kind: "turn", turn });
      previousUserTurn = turn;
      index += 1;
      continue;
    }

    const segment = [];
    while (index < turns.length && !isStaticUserMessageTurn(turns[index])) {
      segment.push(turns[index]);
      index += 1;
    }

    const finalIndex = segment.map(isStaticAssistantMessageTurn).lastIndexOf(true);
    if (finalIndex === -1) {
      if (segment.length) {
        items.push({
          kind: "process",
          turns: segment,
          durationTurns: buildStaticProcessDurationTurns(previousUserTurn, segment),
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
          durationTurns: buildStaticProcessDurationTurns(previousUserTurn, processTurns.concat(finalTurn)),
        });
      }
      items.push({ kind: "turn", turn: finalTurn });
      continue;
    }
    items.push({
      kind: "process",
      turns: segment,
      durationTurns: buildStaticProcessDurationTurns(previousUserTurn, segment),
    });
  }
  return items;
}

function buildStaticProcessDurationTurns(startTurn, turns) {
  return [startTurn, ...turns].filter(Boolean);
}

function isStaticUserMessageTurn(turn) {
  return turn && turn.kind !== "tool" && turn.role === "user";
}

function isStaticAssistantMessageTurn(turn) {
  return turn && turn.kind !== "tool" && turn.role === "assistant";
}

function renderStaticTranscriptItem(item, index) {
  if (item.kind === "process") {
    return renderStaticProcessGroup(item, index);
  }
  return renderStaticTurnArticle(item.turn);
}

function renderStaticTurnArticle(turn) {
  const role = turn.kind === "tool" ? "tool" : turn.role || "assistant";
  return `
      <article class="turn turn-${escapeHtml(role)}">
        <div class="message-card">
          ${renderStaticTurnBody(turn)}
        </div>
      </article>`;
}

function renderStaticProcessGroup(item, index) {
  const turns = item.turns || [];
  if (!turns.length) {
    return "";
  }
  return `
      <article class="turn turn-process">
        <details class="process-details" data-process-index="${escapeHtml(index)}">
          <summary class="process-summary"><span>${escapeHtml(staticProcessLabel(item.durationTurns || turns))}</span></summary>
          <div class="process-body">${turns.map(renderStaticProcessEntry).join("")}</div>
        </details>
      </article>`;
}

function renderStaticProcessEntry(turn) {
  const role = turn.kind === "tool" ? "tool" : turn.role || "assistant";
  return `
            <section class="process-entry process-${escapeHtml(role)}">
              ${renderStaticTurnBody(turn)}
            </section>`;
}

function renderStaticTurnBody(turn) {
  if (turn.kind === "tool") {
    const label = `Tool / ${turn.name || "call"}`;
    return `<details class="tool-details"><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(turn.text || "")}</pre></details>`;
  }
  const html = stripCodexAppDirectiveHtml(turn.html || "") || renderMarkdownHtml(turn.text);
  return `<div class="markdown-body">${html}${renderImageAttachments(turn.images || [])}</div>`;
}

function staticProcessLabel(turns) {
  const duration = staticProcessDurationLabel(turns);
  return duration ? `Processed ${duration}` : "Processed";
}

function staticProcessDurationLabel(turns) {
  const times = turns.map((turn) => new Date(turn.timestamp || "").getTime()).filter(Number.isFinite);
  if (times.length < 2) {
    return "";
  }
  const seconds = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

function renderImageAttachments(images) {
  if (!images?.length) {
    return "";
  }
  return `<div class="attachment-grid">${images.map((image, index) => renderImageAttachment(image, index)).join("")}</div>`;
}

function renderImageAttachment(image, index) {
  const label = image.size ? `${image.mimeType || "image"} / ${image.size}` : image.mimeType || "image";
  if (!image.src) {
    return `
      <figure class="image-attachment image-unavailable">
        <div>${escapeHtml(image.unavailableReason || "Image unavailable")}</div>
        <figcaption>${escapeHtml(label)}</figcaption>
      </figure>`;
  }
  return `
    <figure class="image-attachment">
      <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || `Image attachment ${index + 1}`)}" decoding="async">
      <figcaption>${escapeHtml(label)}</figcaption>
    </figure>`;
}

function renderMarkdownHtml(text) {
  return markdownRenderer.render(stripCodexAppDirectives(text)).trim();
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

function renderHighlightedCode(source, rawLanguage) {
  const language = normalizeMarkdownLanguage(rawLanguage);
  const displayLanguage = language || normalizeMarkdownLanguageLabel(rawLanguage) || "text";
  const code = String(source || "");
  let html = "";
  if (language && hljs.getLanguage(language)) {
    html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
  } else {
    html = escapeHtml(code);
  }
  const className = language ? ` class="hljs language-${escapeHtml(language)}"` : " class=\"hljs\"";
  return `<pre data-language="${escapeHtml(displayLanguage)}"><code${className}>${html}</code></pre>`;
}

function normalizeMarkdownLanguage(rawLanguage) {
  const language = normalizeMarkdownLanguageLabel(rawLanguage);
  if (!language) {
    return "";
  }
  const mapped = MARKDOWN_LANGUAGE_ALIASES.get(language) || language;
  return hljs.getLanguage(mapped) ? mapped : "";
}

function normalizeMarkdownLanguageLabel(rawLanguage) {
  return String(rawLanguage || "")
    .trim()
    .split(/\s+/)[0]
    .replace(/[^A-Za-z0-9_+-]/g, "")
    .toLowerCase();
}

function snapshotCss() {
  return `
:root {
  color-scheme: light;
  --ink: #16191f;
  --muted: #5f6978;
  --line: #d8dde5;
  --paper: #f5f1e8;
  --panel: #fffdf8;
  --panel-strong: #fef7dd;
  --green: #0d6b57;
  --red: #a33a2b;
  --amber: #a66a16;
  --blue: #245d83;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background:
    linear-gradient(90deg, rgba(22, 25, 31, 0.06) 1px, transparent 1px),
    linear-gradient(rgba(22, 25, 31, 0.045) 1px, transparent 1px),
    var(--paper);
  background-size: 28px 28px;
  color: var(--ink);
  font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
}
.snapshot-shell { width: min(1180px, calc(100vw - 28px)); margin: 0 auto; padding: 24px 0 56px; }
.snapshot-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 460px);
  gap: 24px;
  align-items: end;
  border-bottom: 3px solid var(--ink);
  padding: 24px 0 18px;
}
.eyebrow {
  margin: 0 0 10px;
  color: var(--blue);
  font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0;
}
h1 { margin: 0; font-size: clamp(34px, 5vw, 72px); line-height: 0.95; letter-spacing: 0; overflow-wrap: anywhere; }
h2 { margin: 0; font-size: 24px; letter-spacing: 0; }
.meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
.meta-grid div, .path-band, .risk-panel {
  border: 1px solid var(--line);
  background: rgba(255, 253, 248, 0.92);
}
.meta-grid div { padding: 12px; min-width: 0; }
dt, .path-band span {
  color: var(--muted);
  font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
dd { margin: 5px 0 0; overflow-wrap: anywhere; font-size: 14px; }
.path-band {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  margin-top: 18px;
  padding: 12px 14px;
}
code, pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
}
.path-band code { overflow-wrap: anywhere; }
.risk-panel {
  display: grid;
  grid-template-columns: minmax(220px, 0.6fr) minmax(0, 1fr);
  gap: 18px;
  margin-top: 18px;
  padding: 18px;
}
.risk-panel ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.risk {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 8px 12px;
  align-items: center;
  border-left: 5px solid var(--green);
  background: #f6fbf7;
  padding: 10px 12px;
}
.risk span { color: var(--green); font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
.risk strong { font-size: 15px; }
.risk em { grid-column: 2; color: var(--muted); font-size: 13px; font-style: normal; }
.risk-high { border-color: var(--red); background: #fff1ee; }
.risk-high span { color: var(--red); }
.risk-medium { border-color: var(--amber); background: #fff8e7; }
.risk-medium span { color: var(--amber); }
.transcript {
  display: grid;
  gap: 52px;
  width: min(1600px, 100%);
  margin: 42px auto 0;
}
.turn {
  display: flex;
  min-width: 0;
}
.turn-user { justify-content: flex-end; }
.turn-assistant, .turn-tool, .turn-process { justify-content: flex-start; }
.message-card {
  min-width: 0;
  max-width: min(1160px, 74%);
  border: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}
.turn-user .message-card {
  max-width: min(1220px, 76%);
  border: 1px solid #d6e9e5;
  border-radius: 18px;
  background: #eef9f6;
  padding: 23px 34px 26px;
  box-shadow: 0 24px 60px -54px rgba(22, 25, 31, 0.42);
}
.turn-assistant .message-card {
  max-width: min(1120px, 72%);
}
.turn-tool .message-card {
  max-width: min(1160px, 80%);
  border: 1px solid #efd99f;
  border-radius: 10px;
  background: #fff8df;
  padding: 16px 18px;
}
.process-details {
  width: min(1120px, 74%);
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
.process-summary::-webkit-details-marker {
  display: none;
}
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
  gap: 24px;
  padding: 6px 0 8px;
}
.process-entry {
  min-width: 0;
}
.process-tool {
  max-width: min(980px, 100%);
  border-left: 3px solid rgba(183, 121, 31, 0.32);
  padding-left: 12px;
}
.turn-meta {
  margin-bottom: 20px;
  color: var(--muted);
  font: 800 13px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.turn-meta span { font-weight: 700; }
.markdown-body {
  max-width: 78ch;
  color: var(--ink);
  font-size: 20px;
  line-height: 1.7;
}
.markdown-body > * { margin: 0; }
.markdown-body > * + * { margin-top: 18px; }
.markdown-body p, .markdown-body li { overflow-wrap: anywhere; }
.markdown-body strong { font-weight: 800; }
.markdown-body em { font-style: italic; }
.markdown-body a { color: #155e75; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.markdown-body code {
  border: 1px solid rgba(22, 25, 31, 0.12);
  border-radius: 8px;
  background: rgba(22, 25, 31, 0.06);
  padding: 0.08rem 0.34rem;
  font-size: 0.9em;
}
.markdown-body pre {
  max-width: 100%;
  overflow: auto;
  border: 1px solid #253043;
  border-radius: 8px;
  background: #111722;
  color: #edf4ff;
  padding: 14px 16px;
  font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre;
}
.markdown-body pre code {
  display: block;
  min-width: max-content;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
}
.markdown-body .hljs-keyword,
.markdown-body .hljs-selector-tag,
.markdown-body .hljs-built_in { color: #8ab4f8; }
.markdown-body .hljs-title,
.markdown-body .hljs-title.class_,
.markdown-body .hljs-title.function_ { color: #f2cc60; }
.markdown-body .hljs-string,
.markdown-body .hljs-attr,
.markdown-body .hljs-symbol { color: #9ccc65; }
.markdown-body .hljs-number,
.markdown-body .hljs-literal { color: #f8a978; }
.markdown-body .hljs-comment { color: #7d8796; font-style: italic; }
.markdown-body .hljs-type,
.markdown-body .hljs-params,
.markdown-body .hljs-variable,
.markdown-body .hljs-property { color: #c4b5fd; }
.markdown-body ul, .markdown-body ol {
  padding-left: 1.35rem;
}
.markdown-body li + li { margin-top: 0.25rem; }
.markdown-body blockquote {
  border-left: 3px solid #ccd5df;
  margin-left: 0;
  padding-left: 14px;
  color: #4b5563;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3 {
  line-height: 1.25;
  font-size: 1.08em;
}
.attachment-grid {
  display: grid;
  gap: 18px;
  margin-top: 24px;
}
.markdown-body > .attachment-grid { margin-top: 24px; }
.image-attachment {
  margin: 0;
  min-width: 0;
}
.image-attachment img {
  display: block;
  max-width: 100%;
  max-height: 540px;
  border: 1px solid rgba(22, 25, 31, 0.18);
  border-radius: 8px;
  background: #fff;
  object-fit: contain;
}
.image-attachment figcaption {
  margin-top: 10px;
  color: var(--muted);
  font: 800 14px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.image-unavailable {
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 16px;
  color: var(--muted);
}
.tool-details summary {
  min-height: 34px;
  color: var(--amber);
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
pre {
  overflow: auto;
  max-height: 520px;
  margin: 8px 0 0;
  border: 1px solid #253043;
  background: #111722;
  color: #edf4ff;
  padding: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.empty, .snapshot-footer { color: var(--muted); }
.snapshot-footer { margin-top: 24px; font: 700 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
@media (max-width: 820px) {
  .snapshot-header, .risk-panel { grid-template-columns: 1fr; }
  .meta-grid { grid-template-columns: 1fr; }
  .risk { grid-template-columns: 1fr; }
  .risk em { grid-column: auto; }
  .transcript { gap: 36px; }
  .message-card, .process-details, .turn-user .message-card { max-width: 94%; }
  .turn-assistant .message-card { max-width: 100%; }
  .turn-user .message-card { padding: 18px 20px 20px; }
  .markdown-body { font-size: 18px; }
}
`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function snapshotLogoDataUri() {
  return `data:image/svg+xml,${encodeURIComponent(SNAPSHOT_LOGO_SVG)}`;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toISOString().replace("T", " ").slice(0, 16);
}

async function serve({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, host, port }) {
  const server = http.createServer(async (request, response) => {
    try {
      setSnapshotServerCorsHeaders(request, response);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (!isAllowedSnapshotServerRequest(request)) {
        sendJson(response, { error: "origin is not allowed to access this local snapshot server" }, 403);
        return;
      }
      const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      if (url.pathname === "/") {
        send(response, 200, "text/html; charset=utf-8", renderServerApp());
        return;
      }
      if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
        send(response, 200, "image/svg+xml; charset=utf-8", SNAPSHOT_LOGO_SVG);
        return;
      }
      if (url.pathname === "/api/sessions") {
        const limit = url.searchParams.get("all") === "1"
          ? Number.POSITIVE_INFINITY
          : readPositiveInteger(url.searchParams.get("limit") || String(DEFAULT_SERVER_LIMIT), "limit");
        const offset = readNonNegativeInteger(url.searchParams.get("offset") || "0", "offset");
        const scanLimit = Number.isFinite(limit) ? limit + offset : Number.POSITIVE_INFINITY;
        const sessions = await listSessions({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          limit: scanLimit,
          cwd: url.searchParams.get("cwd") || "",
          includeArchived: url.searchParams.get("liveOnly") !== "1",
          source: url.searchParams.get("source") || "codex",
          completeOnly: url.searchParams.get("completeOnly") !== "0",
        });
        sendJson(response, Number.isFinite(limit) ? sessions.slice(offset, offset + limit) : sessions.slice(offset));
        return;
      }
      if (url.pathname === "/api/snapshot") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(response, { error: "missing id" }, 400);
          return;
        }
        const snapshot = await loadSnapshot(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          redact: url.searchParams.get("redact") !== "0",
        });
        applySafetyChecksOption(snapshot, url.searchParams.get("safety") !== "0");
        sendJson(response, snapshot);
        return;
      }
      if (url.pathname === "/api/publish-all") {
        if (url.searchParams.get("redact") === "0") {
          sendJson(response, { error: "Cloud publish requires Redact enabled in the local viewer." }, 400);
          return;
        }
        const result = await publishAllSnapshots({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          cwd: url.searchParams.get("cwd") || "",
          includeArchived: url.searchParams.get("liveOnly") !== "1",
          source: "all",
          completeOnly: url.searchParams.get("completeOnly") !== "0",
          limit: url.searchParams.get("limit")
            ? readPositiveInteger(url.searchParams.get("limit"), "limit")
            : Number.POSITIVE_INFINITY,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          safety: url.searchParams.get("safety") === "1",
        });
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/api/publish") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(response, { error: "missing id" }, 400);
          return;
        }
        if (url.searchParams.get("redact") === "0") {
          sendJson(response, { error: "Cloud publish requires Redact enabled in the local viewer." }, 400);
          return;
        }
        const snapshot = await loadSnapshot(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          redact: true,
        });
        applySafetyChecksOption(snapshot, url.searchParams.get("safety") === "1");
        const result = await publishSnapshot(snapshot, {
          apiUrl: "",
          token: "",
          siteUrl: "",
          expiresInDays: 0,
          shareId: stableSnapshotShareId(snapshot),
        });
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/export") {
        const id = url.searchParams.get("id");
        const format = url.searchParams.get("format") === "md" ? "md" : "html";
        if (!id) {
          send(response, 400, "text/plain; charset=utf-8", "missing id");
          return;
        }
        const snapshot = await loadSnapshot(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          redact: url.searchParams.get("redact") !== "0",
        });
        applySafetyChecksOption(snapshot, url.searchParams.get("safety") !== "0");
        const body = format === "md" ? renderMarkdown(snapshot) : renderHtml(snapshot);
        const fileName = `${safeFileName(snapshot.title || snapshot.id)}.${format === "md" ? "md" : "html"}`;
        response.writeHead(200, {
          "content-type": format === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="${fileName}"`,
          "cache-control": "no-store",
        });
        response.end(body);
        return;
      }
      send(response, 404, "text/plain; charset=utf-8", "not found");
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const url = `http://${host}:${port}`;
  console.log(`Codex Snapshot is running at ${url}`);
  console.log(`Codex home: ${codexHome}`);
  console.log(`Claude Code home: ${claudeHome}`);
  console.log(`Trae home: ${traeHome}`);
  console.log(`Trae app home: ${traeAppHome}`);
  console.log(`Trae recordings: ${traeRecordingsDir}`);
}

async function serveTraeRecorder({ host, port, traeRecordingsDir, recordSensitiveContext }) {
  await mkdir(traeRecordingsDir, { recursive: true });
  const endpoint = `http://${host}:${port}/capture`;
  const wsEndpoint = `ws://${host}:${port}/capture-ws`;
  const server = http.createServer(async (request, response) => {
    try {
      setCorsHeaders(response);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      if (url.pathname === "/") {
        send(response, 200, "text/html; charset=utf-8", renderTraeRecorderHome({ host, port, traeRecordingsDir, recordSensitiveContext }));
        return;
      }
      if (url.pathname === "/health") {
        sendJson(response, {
          ok: true,
          endpoint,
          wsEndpoint,
          recordingsDir: traeRecordingsDir,
          recordSensitiveContext,
        });
        return;
      }
      if (url.pathname === "/trae-recorder.js") {
        send(response, 200, "application/javascript; charset=utf-8", renderTraeRecorderScript({ endpoint, wsEndpoint, recordSensitiveContext }));
        return;
      }
      if (url.pathname === "/capture" && request.method === "POST") {
        const event = await readJsonRequest(request, MAX_TRAE_CAPTURE_POST_BYTES);
        const saved = await saveTraeCaptureEvent(event, { traeRecordingsDir, recordSensitiveContext });
        sendJson(response, saved);
        return;
      }
      send(response, 404, "text/plain; charset=utf-8", "not found");
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
  server.on("upgrade", (request, socket) => {
    handleTraeRecorderUpgrade(request, socket, { traeRecordingsDir, recordSensitiveContext });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const url = `http://${host}:${port}`;
  console.log(`Trae local recorder is running at ${url}`);
  console.log(`Recorder script: import("${url}/trae-recorder.js")`);
  console.log(`Recorder WebSocket: ${wsEndpoint}`);
  console.log(`Recordings dir: ${traeRecordingsDir}`);
  console.log(`Sensitive context recording: ${recordSensitiveContext ? "enabled" : "disabled"}`);
}

function handleTraeRecorderUpgrade(request, socket, { traeRecordingsDir, recordSensitiveContext }) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/capture-ws") {
      socket.destroy();
      return;
    }
    const key = request.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"));
    let buffer = Buffer.alloc(0);
    let fragmentedOpcode = 0;
    let fragmentedPayloads = [];
    const handleTextPayload = (payload) => {
      try {
        const event = JSON.parse(payload.toString("utf8"));
        saveTraeCaptureEvent(event, {
          traeRecordingsDir,
          recordSensitiveContext,
        }).catch(() => {});
      } catch {}
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = readWebSocketFrames(buffer);
      buffer = parsed.remaining;
      for (const frame of parsed.frames) {
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x1) {
          if (frame.fin) {
            handleTextPayload(frame.payload);
          } else {
            fragmentedOpcode = frame.opcode;
            fragmentedPayloads = [frame.payload];
          }
          continue;
        }
        if (frame.opcode === 0x0 && fragmentedOpcode === 0x1) {
          fragmentedPayloads.push(frame.payload);
          if (frame.fin) {
            handleTextPayload(Buffer.concat(fragmentedPayloads));
            fragmentedOpcode = 0;
            fragmentedPayloads = [];
          }
        }
      }
    });
  } catch {
    socket.destroy();
  }
}

function readWebSocketFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) {
        break;
      }
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      length = high * 2 ** 32 + low;
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const totalLength = headerLength + maskLength + length;
    if (buffer.length - offset < totalLength) {
      break;
    }
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    frames.push({ fin, opcode, payload });
    offset += totalLength;
  }
  return {
    frames,
    remaining: buffer.subarray(offset),
  };
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-max-age", "86400");
}

function setSnapshotServerCorsHeaders(request, response) {
  const origin = request.headers.origin || "";
  if (!origin) {
    response.setHeader("access-control-allow-origin", "*");
  } else if (isAllowedSnapshotOrigin(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-max-age", "86400");
}

function isAllowedSnapshotServerRequest(request) {
  const origin = request.headers.origin || "";
  return !origin || isAllowedSnapshotOrigin(origin);
}

function isAllowedSnapshotOrigin(origin) {
  const configuredOrigins = String(process.env.SNAPSHOT_VIEWER_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    ...configuredOrigins,
  ]);
  if (allowedOrigins.has(origin)) {
    return true;
  }
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function readJsonRequest(request, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new Error(`capture body is larger than ${formatBytes(limitBytes)}`);
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    throw new Error("empty capture body");
  }
  return JSON.parse(text);
}

async function saveTraeCaptureEvent(event, { traeRecordingsDir, recordSensitiveContext }) {
  if (!event || typeof event !== "object") {
    throw new Error("capture event must be a JSON object");
  }
  const pageSession = safeCaptureId(event.pageSession || event.page?.session || `trae-${new Date().toISOString().slice(0, 10)}`);
  const body = normalizeCapturedBody(event.body);
  const chunk = normalizeCapturedBody(event.chunk);
  const sessionEvent = { ...event, body, chunk };
  const actualSessionId = extractActualTraeSessionId(sessionEvent) || "";
  const captureSessionId = extractTraeCaptureSessionId(sessionEvent, actualSessionId) || "";
  const captureFileId = safeCaptureId(captureSessionId || actualSessionId || pageSession);
  const filePath = path.join(traeRecordingsDir, `${captureFileId}.jsonl`);
  const domThreadId = cleanTraeSessionId(event.domThreadId || event.dom_thread_id || "");
  if (actualSessionId && domThreadId) {
    await migrateTraeCaptureAlias(traeRecordingsDir, domThreadId, captureFileId);
  }
  const record = {
    schema: "trae-local-recorder-event.v1",
    capturedAt: normalizeRecordedTimestamp(event.capturedAt) || new Date().toISOString(),
    pageSession,
    captureSessionId,
    captureFileId,
    domThreadId,
    sequence: Number(event.sequence || 0),
    kind: String(event.kind || "capture"),
    source: String(event.source || ""),
    requestId: event.requestId ? String(event.requestId) : "",
    wsId: event.wsId ? String(event.wsId) : "",
    eventSourceId: event.eventSourceId ? String(event.eventSourceId) : "",
    method: event.method ? String(event.method) : "",
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : undefined,
    statusText: event.statusText ? String(event.statusText) : "",
    contentType: event.contentType ? String(event.contentType) : "",
    url: sanitizeCaptureUrl(event.url),
    responseUrl: sanitizeCaptureUrl(event.responseUrl),
    pageUrl: sanitizeCaptureUrl(event.page?.href || event.pageUrl),
    pageTitle: event.page?.title ? String(event.page.title) : event.pageTitle ? String(event.pageTitle) : "",
    body,
    chunk,
    bodyEncoding: event.bodyEncoding ? String(event.bodyEncoding) : "",
    actualSessionId,
    sensitiveContextRecorded: Boolean(recordSensitiveContext),
    headers: recordSensitiveContext ? normalizeCaptureHeaders(event.headers) : undefined,
  };
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return {
    ok: true,
    file: filePath,
    captureSessionId: record.captureSessionId,
    actualSessionId: record.actualSessionId,
    eventKind: record.kind,
    sequence: record.sequence,
  };
}

function normalizeCapturedBody(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeCaptureHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[String(key).toLowerCase()] = Array.isArray(value)
      ? value.map((item) => String(item))
      : String(value);
  }
  return normalized;
}

function sanitizeCaptureUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, "<redacted>");
    }
    url.hash = "";
    return url.toString();
  } catch {
    return String(value).replace(/[?&]([^=&#]+)=([^&#]+)/g, (_match, key) => `?${key}=<redacted>`);
  }
}

function safeCaptureId(value) {
  const clean = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!clean) {
    return `trae-${Date.now().toString(36)}`;
  }
  return clean.length > 96 ? `${clean.slice(0, 72)}-${stableHash(clean)}` : clean;
}

async function migrateTraeCaptureAlias(traeRecordingsDir, fromId, toId) {
  const fromFileId = safeCaptureId(fromId);
  const toFileId = safeCaptureId(toId);
  if (!fromFileId || !toFileId || fromFileId === toFileId) {
    return;
  }
  const fromPath = path.join(traeRecordingsDir, `${fromFileId}.jsonl`);
  const toPath = path.join(traeRecordingsDir, `${toFileId}.jsonl`);
  try {
    const existing = await readFile(fromPath, "utf8");
    if (existing.trim()) {
      await appendFile(toPath, existing.endsWith("\n") ? existing : `${existing}\n`, "utf8");
    }
    await unlink(fromPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

const TRAE_ACTUAL_SESSION_KEYS = new Set([
  "agentsessionid",
  "chatsessionid",
  "conversationid",
  "conversationuuid",
  "currentsessionid",
  "sessionid",
  "sessionuuid",
  "threadid",
  "taskid",
  "chatid",
]);

const TRAE_CAPTURE_SESSION_KEYS = new Set([
  ...TRAE_ACTUAL_SESSION_KEYS,
  "capturesessionid",
  "domthreadid",
]);

function normalizeTraeSessionKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanTraeSessionId(value) {
  const clean = String(value || "").trim();
  if (!clean || clean.length < 8 || clean.length > 240) {
    return "";
  }
  if (/^(<redacted>|undefined|null|true|false)$/i.test(clean)) {
    return "";
  }
  if (/^(data:|blob:|https?:)/i.test(clean)) {
    return "";
  }
  return clean;
}

function extractActualTraeSessionId(event) {
  const values = [];
  const explicit = cleanTraeSessionId(event.actualSessionId || event.actual_session_id);
  if (explicit) {
    return explicit;
  }
  collectTraeSessionValues(event, TRAE_ACTUAL_SESSION_KEYS, values, 0);
  for (const payloadText of [event.body, event.chunk]) {
    if (!payloadText || typeof payloadText !== "string") {
      continue;
    }
    for (const payload of parseCapturePayloads(payloadText)) {
      collectTraeSessionValues(payload, TRAE_ACTUAL_SESSION_KEYS, values, 0);
    }
  }
  for (const value of values) {
    const clean = cleanTraeSessionId(value);
    if (clean) {
      return clean;
    }
  }
  for (const url of [event.url, event.responseUrl, event.page?.href, event.pageUrl]) {
    const fromUrl = extractTraeSessionIdFromUrl(url);
    if (fromUrl) {
      return fromUrl;
    }
  }
  return "";
}

function extractTraeCaptureSessionId(event, actualSessionId) {
  if (actualSessionId) {
    return actualSessionId;
  }
  const explicit = cleanTraeSessionId(event.captureSessionId || event.capture_session_id || event.page?.captureSessionId);
  if (explicit) {
    return explicit;
  }
  const values = [];
  collectTraeSessionValues(event, TRAE_CAPTURE_SESSION_KEYS, values, 0);
  for (const payloadText of [event.body, event.chunk]) {
    if (!payloadText || typeof payloadText !== "string") {
      continue;
    }
    for (const payload of parseCapturePayloads(payloadText)) {
      collectTraeSessionValues(payload, TRAE_CAPTURE_SESSION_KEYS, values, 0);
    }
  }
  for (const value of values) {
    const clean = cleanTraeSessionId(value);
    if (clean) {
      return clean;
    }
  }
  return "";
}

function collectTraeSessionValues(value, keys, results, depth) {
  if (!value || depth > 8 || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTraeSessionValues(item, keys, results, depth + 1);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && keys.has(normalizeTraeSessionKey(key))) {
      results.push(child);
    } else if (child && typeof child === "object") {
      collectTraeSessionValues(child, keys, results, depth + 1);
    }
  }
}

function extractTraeSessionIdFromUrl(value) {
  if (!value) {
    return "";
  }
  const raw = String(value);
  try {
    const url = new URL(raw);
    for (const [key, child] of url.searchParams.entries()) {
      if (TRAE_ACTUAL_SESSION_KEYS.has(normalizeTraeSessionKey(key))) {
        const clean = cleanTraeSessionId(child);
        if (clean) {
          return clean;
        }
      }
    }
    const pathMatch = url.pathname.match(/(?:session|conversation|chat|thread|task)[/_-]([A-Za-z0-9._:-]{8,})/i);
    if (pathMatch) {
      return cleanTraeSessionId(pathMatch[1]);
    }
  } catch {
    const match = raw.match(/[?&#](?:[^=]*?(?:session|conversation|chat|thread|task)[^=]*?id)=([^&#]+)/i)
      || raw.match(/(?:session|conversation|chat|thread|task)[/_-]([A-Za-z0-9._:-]{8,})/i);
    if (match) {
      return cleanTraeSessionId(decodeURIComponent(match[1]));
    }
  }
  return "";
}

function renderTraeRecorderHome({ host, port, traeRecordingsDir, recordSensitiveContext }) {
  const scriptUrl = `http://${host}:${port}/trae-recorder.js`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trae Local Recorder</title>
  <style>
    body { margin: 40px; max-width: 920px; background: #f5efe4; color: #15191f; font: 18px/1.55 ui-serif, Georgia, serif; }
    h1 { font-size: 48px; line-height: 1; margin: 0 0 24px; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre { background: #15191f; color: #fff; padding: 18px; overflow: auto; }
    .meta { color: #687386; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  </style>
</head>
<body>
  <h1>Trae Local Recorder</h1>
  <p class="meta">status: running | recordings: ${escapeHtml(traeRecordingsDir)} | sensitive context: ${recordSensitiveContext ? "enabled" : "disabled"}</p>
  <p>Open Trae DevTools for the Trae window you want to record, then run:</p>
  <pre>import(${JSON.stringify(scriptUrl)})</pre>
  <p>If dynamic import is blocked, run:</p>
  <pre>fetch(${JSON.stringify(scriptUrl)}).then((r) => r.text()).then((code) => (0, eval)(code))</pre>
</body>
</html>`;
}

function renderTraeRecorderScript({ endpoint, wsEndpoint, recordSensitiveContext }) {
  return `(() => {
  const ENDPOINT = ${JSON.stringify(endpoint)};
  const WS_ENDPOINT = ${JSON.stringify(wsEndpoint)};
  const RECORD_SENSITIVE_CONTEXT = ${recordSensitiveContext ? "true" : "false"};
  const nativeFetch = window.fetch;
  const nativeFetchBound = nativeFetch.bind(window);
  const nativeWebSocket = window.WebSocket;
  if (window.__codexTraeRecorder && window.__codexTraeRecorder.installed) {
    console.info("[codex-snapshot] Trae recorder already installed", window.__codexTraeRecorder);
    return;
  }
  const recorder = {
    installed: true,
    endpoint: ENDPOINT,
    pageSession: "trae-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
    actualSessionId: "",
    actualSessionUpdatedAt: 0,
    actualSessionSource: "",
    captureSessionId: "",
    pageStateSessionId: "",
    domThreadId: "",
    domThreadSignature: "",
    sequence: 0,
  };
  const transport = { socket: null, queue: [], opening: false, failed: false };
  window.__codexTraeRecorder = recorder;

  function nextId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + (++recorder.sequence).toString(36);
  }

  function sanitizeUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), location.href);
      for (const key of Array.from(url.searchParams.keys())) {
        url.searchParams.set(key, "<redacted>");
      }
      url.hash = "";
      return url.toString();
    } catch {
      return String(value);
    }
  }

  const TRAE_SESSION_ID_KEYS = new Set([
    "agentsessionid",
    "chatsessionid",
    "conversationid",
    "conversationuuid",
    "currentsessionid",
    "sessionid",
    "sessionuuid",
    "threadid",
    "taskid",
    "chatid",
  ]);

  function normalizeSessionKey(key) {
    return String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function isSessionIdKey(key) {
    const normalized = normalizeSessionKey(key);
    return TRAE_SESSION_ID_KEYS.has(normalized)
      || (normalized.startsWith("data") && TRAE_SESSION_ID_KEYS.has(normalized.slice(4)));
  }

  function cleanSessionId(value) {
    const clean = String(value || "").trim();
    if (!clean || clean.length < 8 || clean.length > 240) return "";
    if (/^(<redacted>|undefined|null|true|false)$/i.test(clean)) return "";
    if (/^(data:|blob:|https?:)/i.test(clean)) return "";
    if (clean.includes("\\n")) return "";
    return clean;
  }

  function rememberActualSessionId(value, source) {
    const clean = cleanSessionId(value);
    if (!clean) return "";
    recorder.actualSessionId = clean;
    recorder.actualSessionUpdatedAt = Date.now();
    recorder.actualSessionSource = source || "network";
    if (recorder.actualSessionSource !== "page-state") {
      recorder.captureSessionId = clean;
    }
    return clean;
  }

  function rememberCaptureSessionId(value) {
    const clean = cleanSessionId(value);
    if (!clean) return "";
    if (!recorder.actualSessionId) recorder.captureSessionId = clean;
    return clean;
  }

  function currentCaptureSessionId() {
    return (recorder.actualSessionSource !== "page-state" ? recorder.actualSessionId : "")
      || recorder.captureSessionId
      || recorder.domThreadId
      || "";
  }

  function collectSessionIds(value, out, depth) {
    if (value == null || depth > 8) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text || text.length > 300000) return;
      if (text[0] === "{" || text[0] === "[") {
        try {
          collectSessionIds(JSON.parse(text), out, depth + 1);
          return;
        } catch {}
      }
      for (const line of text.split(/\\r?\\n/)) {
        const item = line.trim();
        if (!item.startsWith("data:")) continue;
        const data = item.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          collectSessionIds(JSON.parse(data), out, depth + 1);
        } catch {}
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectSessionIds(item, out, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (isSessionIdKey(key)) {
        const clean = cleanSessionId(child);
        if (clean) out.push(clean);
      }
      if (child && (typeof child === "object" || typeof child === "string")) {
        collectSessionIds(child, out, depth + 1);
      }
    }
  }

  function rememberSessionIdsFromText(text) {
    const values = [];
    collectSessionIds(text, values, 0);
    return values.length ? rememberActualSessionId(values[0], "network-body") : "";
  }

  function rememberSessionIdsFromUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), location.href);
      for (const [key, child] of url.searchParams.entries()) {
        if (isSessionIdKey(key)) {
          const remembered = rememberActualSessionId(child, "network-url");
          if (remembered) return remembered;
        }
      }
      const pathMatch = url.pathname.match(/(?:session|conversation|chat|thread|task)[/_-]([A-Za-z0-9._:-]{8,})/i);
      if (pathMatch) return rememberActualSessionId(pathMatch[1], "network-url");
    } catch {}
    return "";
  }

  function rememberSessionIdsFromCapture(url, text) {
    return rememberSessionIdsFromUrl(url) || rememberSessionIdsFromText(text);
  }

  function rememberSessionIdsFromPageState() {
    rememberSessionIdsFromUrl(location.href);
    const values = [];
    try {
      collectSessionIds(history.state, values, 0);
    } catch {}
    try {
      for (const storage of [localStorage, sessionStorage]) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          const value = key ? storage.getItem(key) : "";
          if (isSessionIdKey(key)) {
            const clean = cleanSessionId(value);
            if (clean) values.push(clean);
          }
          collectSessionIds(value, values, 0);
        }
      }
    } catch {}
    try {
      const selectors = [
        "[data-session-id]",
        "[data-conversation-id]",
        "[data-chat-id]",
        "[data-thread-id]",
        "[data-task-id]",
        "[aria-current='true']",
        ".active",
        ".selected",
        ".current",
      ].join(",");
      const elements = Array.from(document.querySelectorAll(selectors)).slice(0, 80);
      for (const element of elements) {
        for (const attr of Array.from(element.attributes || [])) {
          if (isSessionIdKey(attr.name)) {
            const clean = cleanSessionId(attr.value);
            if (clean) values.push(clean);
          }
        }
      }
    } catch {}
    if (values.length) {
      recorder.pageStateSessionId = cleanSessionId(values[0]);
    }
    return values[0] || "";
  }

  function headersToObject(headers) {
    if (!RECORD_SENSITIVE_CONTEXT || !headers) return undefined;
    try {
      const out = {};
      new Headers(headers).forEach((value, key) => { out[key] = value; });
      return out;
    } catch {
      return undefined;
    }
  }

  async function readBody(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (value instanceof URLSearchParams) return value.toString();
    if (typeof FormData !== "undefined" && value instanceof FormData) {
      const out = {};
      for (const [key, item] of value.entries()) {
        out[key] = typeof item === "string" ? item : "[File " + (item.name || "blob") + " " + (item.type || "application/octet-stream") + "]";
      }
      return JSON.stringify(out);
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      if (value.type && !/^text\\/|json|javascript|xml|x-www-form-urlencoded/i.test(value.type)) {
        return "[Blob " + value.type + " " + value.size + " bytes]";
      }
      return await value.text();
    }
    if (value instanceof ArrayBuffer) {
      return new TextDecoder().decode(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new TextDecoder().decode(value);
    }
    if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
      return "[ReadableStream request body]";
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  async function readFetchRequestBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, "body")) {
      return readBody(init.body);
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      try {
        return await input.clone().text();
      } catch {
        return "";
      }
    }
    return "";
  }

  function requestHeaders(input, init) {
    if (init && init.headers) return headersToObject(init.headers);
    if (typeof Request !== "undefined" && input instanceof Request) return headersToObject(input.headers);
    return undefined;
  }

  async function post(kind, payload) {
    rememberSessionIdsFromPageState();
    if (payload && payload.actualSessionId) rememberActualSessionId(payload.actualSessionId);
    if (payload && payload.captureSessionId) rememberCaptureSessionId(payload.captureSessionId);
    const event = {
      schema: "trae-browser-recorder.v1",
      kind,
      capturedAt: new Date().toISOString(),
      page: { href: sanitizeUrl(location.href), title: document.title },
      pageSession: recorder.pageSession,
      sequence: ++recorder.sequence,
      ...payload,
      actualSessionId: recorder.actualSessionSource === "page-state" ? "" : recorder.actualSessionId || "",
      actualSessionIdSource: recorder.actualSessionSource || "",
      pageStateSessionId: recorder.pageStateSessionId || "",
      captureSessionId: currentCaptureSessionId(),
      domThreadId: recorder.domThreadId || "",
    };
    const body = JSON.stringify(event);
    if (sendViaWebSocket(body)) {
      return;
    }
    try {
      await nativeFetchBound(ENDPOINT, {
        method: "POST",
        mode: "cors",
        keepalive: body.length < 60000,
        headers: { "content-type": "application/json" },
        body,
      });
    } catch (error) {
      console.debug("[codex-snapshot] recorder post failed", error);
    }
  }

  function sendViaWebSocket(body) {
    if (transport.failed || !nativeWebSocket || !WS_ENDPOINT) return false;
    if (transport.socket && transport.socket.readyState === nativeWebSocket.OPEN) {
      transport.socket.send(body);
      return true;
    }
    transport.queue.push(body);
    if (!transport.opening) {
      transport.opening = true;
      try {
        transport.socket = new nativeWebSocket(WS_ENDPOINT);
        transport.socket.addEventListener("open", () => {
          transport.opening = false;
          const pending = transport.queue.splice(0);
          for (const item of pending) transport.socket.send(item);
        });
        transport.socket.addEventListener("close", () => {
          transport.opening = false;
          transport.socket = null;
        });
        transport.socket.addEventListener("error", () => {
          transport.opening = false;
          transport.failed = true;
          transport.socket = null;
        });
      } catch {
        transport.opening = false;
        transport.failed = true;
        return false;
      }
    }
    return true;
  }

  async function captureResponseStream(response, meta) {
    try {
      if (response.body && response.body.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          const chunk = decoder.decode(result.value, { stream: true });
          if (chunk) {
            rememberSessionIdsFromText(chunk);
            await post("fetch-response-chunk", { ...meta, chunk });
          }
        }
        const tail = decoder.decode();
        if (tail) {
          rememberSessionIdsFromText(tail);
          await post("fetch-response-chunk", { ...meta, chunk: tail });
        }
        await post("fetch-response-end", meta);
        return;
      }
      const body = await response.text();
      rememberSessionIdsFromText(body);
      await post("fetch-response", { ...meta, body });
    } catch (error) {
      await post("capture-error", { ...meta, message: String(error && error.message || error) });
    }
  }

  window.fetch = async function recordedFetch(input, init) {
    const method = String((init && init.method) || (typeof Request !== "undefined" && input instanceof Request && input.method) || "GET").toUpperCase();
    const rawRequestUrl = typeof input === "string" || input instanceof URL ? input : input && input.url;
    const requestUrl = sanitizeUrl(rawRequestUrl);
    const requestId = nextId("fetch");
    rememberSessionIdsFromUrl(rawRequestUrl);
    readFetchRequestBody(input, init).then((body) => {
      rememberSessionIdsFromCapture(rawRequestUrl, body);
      return post("fetch-request", {
        requestId,
        source: "fetch",
        url: requestUrl,
        method,
        headers: requestHeaders(input, init),
        body,
      });
    }).then(() => {}, () => {});
    const response = await nativeFetch.apply(this, arguments);
    rememberSessionIdsFromUrl(response.url);
    const meta = {
      requestId,
      source: "fetch",
      url: requestUrl,
      responseUrl: sanitizeUrl(response.url),
      method,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") || "",
      headers: headersToObject(response.headers),
    };
    if (meta.contentType && !/json|text|event-stream|javascript|xml|x-www-form-urlencoded/i.test(meta.contentType)) {
      post("fetch-response-skip", meta);
      return response;
    }
    captureResponseStream(response.clone(), meta);
    return response;
  };

  if (nativeWebSocket) {
    const NativeWebSocket = nativeWebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = new target(...args);
        const wsId = nextId("ws");
        const rawUrl = args[0];
        const url = sanitizeUrl(rawUrl);
        rememberSessionIdsFromUrl(rawUrl);
        post("ws-open", { wsId, source: "websocket", url });
        const nativeSend = socket.send;
        socket.send = function recordedSend(data) {
          readBody(data).then((body) => {
            rememberSessionIdsFromCapture(rawUrl, body);
            return post("ws-send", { wsId, source: "websocket", url, body });
          }).then(() => {}, () => {});
          return nativeSend.apply(this, arguments);
        };
        socket.addEventListener("message", (event) => {
          readBody(event.data).then((body) => {
            rememberSessionIdsFromCapture(rawUrl, body);
            return post("ws-message", { wsId, source: "websocket", url, body });
          }).then(() => {}, () => {});
        });
        socket.addEventListener("close", (event) => post("ws-close", { wsId, source: "websocket", url, code: event.code, reason: event.reason }));
        socket.addEventListener("error", () => post("ws-error", { wsId, source: "websocket", url }));
        return socket;
      },
    });
  }

  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    window.EventSource = new Proxy(NativeEventSource, {
      construct(target, args) {
        const eventSource = new target(...args);
        const eventSourceId = nextId("sse");
        const rawUrl = args[0];
        const url = sanitizeUrl(rawUrl);
        rememberSessionIdsFromUrl(rawUrl);
        post("eventsource-open", { eventSourceId, source: "eventsource", url });
        eventSource.addEventListener("message", (event) => {
          rememberSessionIdsFromCapture(rawUrl, event.data);
          post("eventsource-message", {
            eventSourceId,
            source: "eventsource",
            url,
            body: event.data,
          });
        });
        eventSource.addEventListener("error", () => post("eventsource-error", { eventSourceId, source: "eventsource", url }));
        return eventSource;
      },
    });
  }

  const domRecorder = {
    ids: new WeakMap(),
    sent: new Map(),
    nextId: 0,
    observer: null,
    timer: null,
  };

  function queryFirst(root, selectors) {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function normalizeDomMessageText(value) {
    return String(value || "")
      .replace(/\\u0000/g, "")
      .replace(/\\u00a0/g, " ")
      .replace(/\\r\\n/g, "\\n")
      .split("\\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\\n")
      .trim();
  }

  function normalizeDomCodeLanguage(value) {
    const lower = String(value || "").trim().toLowerCase();
    if (lower === "typescript" || lower === "ts") return "ts";
    if (lower === "javascript" || lower === "js") return "js";
    if (lower === "plaintext" || lower === "plain text" || lower === "text") return "text";
    if (/^(tsx|jsx|json|html|css|bash|yaml|yml|xml)$/.test(lower)) return lower === "yml" ? "yaml" : lower;
    return "";
  }

  function inferDomCodeLanguage(element) {
    const values = [];
    let current = element;
    while (current && current.nodeType === 1 && values.length < 4) {
      values.push(current.getAttribute("data-language") || "");
      values.push(current.getAttribute("lang") || "");
      values.push(String(current.className || ""));
      current = current.parentElement;
    }
    const joined = values.join(" ");
    const classMatch = joined.match(/language-([a-z0-9+#.-]+)/i) || joined.match(/\\b(tsx|ts|typescript|jsx|js|javascript|json|html|css|bash|plaintext|text|yaml|yml|xml)\\b/i);
    return normalizeDomCodeLanguage(classMatch && classMatch[1]);
  }

  function isDomCodeLineNumber(line) {
    return /^\\d{1,4}$/.test(String(line || "").trim());
  }

  function normalizeDomCodeBlockText(value, language) {
    const lines = String(value || "")
      .replace(/\\u0000/g, "")
      .replace(/\\u00a0/g, " ")
      .replace(/\\r\\n/g, "\\n")
      .split("\\n")
      .map((line) => line.replace(/\\s+$/g, ""));
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const leadingLanguage = normalizeDomCodeLanguage(lines[0]);
    if (leadingLanguage) {
      language = language || leadingLanguage;
      lines.shift();
    }
    while (lines.length && isDomCodeLineNumber(lines[0])) {
      lines.shift();
    }
    return {
      language: language || "text",
      code: lines.join("\\n").trimEnd(),
    };
  }

  function extractDomMessageText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    const codeBlocks = Array.from(clone.querySelectorAll("pre, .shiki, .code-block, .codeBlock, [class*='code-block'], [class*='codeBlock'], code[class*='language-']"));
    for (const block of codeBlocks) {
      if (!block.isConnected) continue;
      const raw = block.textContent || block.innerText || "";
      if (!raw.trim()) continue;
      if (block.tagName && block.tagName.toLowerCase() === "code" && !raw.includes("\\n")) continue;
      const normalized = normalizeDomCodeBlockText(raw, inferDomCodeLanguage(block));
      if (!normalized.code) continue;
      block.replaceWith(document.createTextNode("\\n\\n\`\`\`" + normalized.language + "\\n" + normalized.code + "\\n\`\`\`\\n\\n"));
    }
    return clone.innerText || clone.textContent || "";
  }

  function isVisibleElement(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) !== 0;
  }

  function getDomMessageId(section, role) {
    const existing = domRecorder.ids.get(section);
    if (existing) return existing;
    const id = "dom-" + role + "-" + Date.now().toString(36) + "-" + (++domRecorder.nextId).toString(36);
    domRecorder.ids.set(section, id);
    return id;
  }

  function extractDomTurn(section, order) {
    if (!section || !isVisibleElement(section)) return null;
    const role = section.classList.contains("user")
      ? "user"
      : section.classList.contains("assistant")
        ? "assistant"
        : "";
    if (!role) return null;
    const content = role === "user"
      ? queryFirst(section, [
        ".user-chat-bubble-request__content-wrapper",
        ".user-chat-bubble-request",
        ".user-chat-line",
        ".user-chat-bubble",
        ".icube-value",
        ".value",
      ])
      : queryFirst(section, [
        ".assistant-chat-turn-content .chat-markdown",
        ".assistant-chat-turn-content",
        ".assistant-chat-turn-content-inner-agent-wrapper",
        ".chat-markdown",
      ]);
    const text = normalizeDomMessageText(content ? extractDomMessageText(content) : section.innerText || section.textContent);
    if (!text) return null;
    if (role === "assistant" && /^(Builder|思考过程|任务完成)$/i.test(text)) return null;
    return {
      role,
      text,
      messageId: getDomMessageId(section, role),
      order,
      className: String(section.className || ""),
    };
  }

  function updateDomThreadId(turns) {
    const firstUser = turns.find((turn) => turn.role === "user");
    if (!firstUser) return;
    const signature = firstUser.text.slice(0, 240);
    if (!signature || signature === recorder.domThreadSignature) return;
    recorder.domThreadSignature = signature;
    recorder.domThreadId = "dom-thread-" + firstUser.messageId;
    const hasFreshNetworkSession = recorder.actualSessionId && Date.now() - recorder.actualSessionUpdatedAt < 5000;
    if (!hasFreshNetworkSession) {
      recorder.actualSessionId = "";
      recorder.actualSessionUpdatedAt = 0;
      recorder.actualSessionSource = "";
      recorder.captureSessionId = recorder.domThreadId;
    } else {
      recorder.captureSessionId = recorder.actualSessionId;
    }
  }

  function findDomCaptureRoot() {
    return document.querySelector("#agent-chat-view")
      || document.querySelector(".icube-chat-view-container")
      || document.querySelector(".chat-list-wrapper")
      || document.body;
  }

  function captureDomTurns(reason) {
    if (!document.body) return;
    const root = findDomCaptureRoot();
    if (!root) return;
    const sections = Array.from(root.querySelectorAll("section.chat-turn.user, section.chat-turn.assistant"));
    const turns = sections.map((section, index) => extractDomTurn(section, index + 1)).filter(Boolean);
    updateDomThreadId(turns);
    turns.forEach((turn) => {
      const sentKey = turn.messageId;
      const signature = turn.role + "\\u0000" + turn.text;
      if (domRecorder.sent.get(sentKey) === signature) return;
      domRecorder.sent.set(sentKey, signature);
      post("dom-message", {
        source: "dom",
        body: {
          role: turn.role,
          text: turn.text,
          messageId: turn.messageId,
          order: turn.order,
          reason,
          className: turn.className,
          timestamp: new Date().toISOString(),
        },
      });
    });
  }

  function scheduleDomCapture(reason) {
    clearTimeout(domRecorder.captureTimer);
    domRecorder.captureTimer = setTimeout(() => captureDomTurns(reason), 300);
  }

  function installDomCapture() {
    if (!document.body || !window.MutationObserver) {
      return;
    }
    captureDomTurns("install");
    domRecorder.observer = new MutationObserver(() => scheduleDomCapture("mutation"));
    domRecorder.observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    domRecorder.timer = setInterval(() => captureDomTurns("poll"), 2000);
  }

  installDomCapture();

  console.info("[codex-snapshot] Trae recorder installed. Capturing to", ENDPOINT, "pageSession=", recorder.pageSession);
})();`;
}

function sendJson(response, data, status = 200) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(data, null, 2));
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

function applySafetyChecksOption(snapshot, enabled) {
  snapshot.safetyChecks = Boolean(enabled);
  if (!enabled) {
    snapshot.risks = [];
    snapshot.notices = [];
  }
  return snapshot;
}

function safeFileName(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "codex-snapshot";
}

function renderServerApp() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Snapshots</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>${serverCss()}</style>
</head>
<body>
  <main class="app">
    <aside class="sidebar">
      <div class="sidebar-top">
        <header>
          <p class="eyebrow">Codex Snapshots</p>
          <h1>会话</h1>
        </header>
        <div class="toolbar">
          <input id="filter" type="search" placeholder="搜索来源、项目或对话">
          <button id="reload" type="button" title="刷新会话列表">刷新</button>
        </div>
      </div>
      <div id="sessions" class="sessions"></div>
    </aside>
    <div id="splitter" class="splitter" role="separator" aria-label="调整项目列表宽度" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="680" aria-valuenow="0" tabindex="0"></div>
    <section class="viewer">
      <div class="viewer-top">
        <div>
          <p class="eyebrow">Read-only review</p>
          <h2 id="title">选择一个会话</h2>
        </div>
        <div class="switches">
          <label title="显示工具调用"><input id="includeTools" type="checkbox"> 工具</label>
          <label title="显示工具输出"><input id="includeToolOutput" type="checkbox"> 输出</label>
          <label title="自动脱敏常见敏感内容"><input id="redact" type="checkbox" checked> 脱敏</label>
        </div>
      </div>
      <div id="meta" class="meta empty">还没有选择会话。</div>
      <div id="risks" class="risks"></div>
      <div id="exports" class="exports"></div>
      <div id="turns" class="turns"></div>
    </section>
  </main>
  <script>window.CODEX_SNAPSHOT_SHARE_CONFIG=${inlineJson(browserShareConfig())};</script>
  <script>${serverJs()}</script>
</body>
</html>`;
}

function inlineJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    if (char === "<") return "\\u003c";
    if (char === ">") return "\\u003e";
    if (char === "&") return "\\u0026";
    if (char === "\u2028") return "\\u2028";
    return "\\u2029";
  });
}

function serverCss() {
  return `
:root {
  --ink: #17202a;
  --muted: #617181;
  --soft: #8492a3;
  --line: #d9e2e8;
  --paper: #f6f8f5;
  --panel: #ffffff;
  --panel-soft: #f8fbf9;
  --panel-wash: rgba(255, 255, 255, 0.82);
  --sidebar-width: clamp(340px, 28vw, 470px);
  --splitter-width: 14px;
  --blue: #2f6fbb;
  --teal: #0f766e;
  --green: #15803d;
  --red: #b43b45;
  --amber: #b7791f;
  --focus: #2f6fbb;
  --shadow-soft: 0 24px 70px -54px rgba(23, 32, 42, 0.42);
  --shadow-panel: 0 26px 80px -62px rgba(23, 32, 42, 0.55);
  --grid-strong: rgba(23, 32, 42, 0.058);
  --grid-soft: rgba(23, 32, 42, 0.034);
}
* { box-sizing: border-box; }
html {
  height: 100%;
  overflow: hidden;
}
body {
  height: 100%;
  margin: 0;
  overflow: hidden;
  color: var(--ink);
  background: var(--paper);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.app {
  display: grid;
  grid-template-columns: var(--sidebar-width) var(--splitter-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}
.app.resizing,
.app.resizing * {
  cursor: col-resize;
  user-select: none;
}
.sidebar {
  min-height: 0;
  background: var(--panel-soft);
  padding: 12px 14px 24px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  border-right: 1px solid rgba(23, 32, 42, 0.1);
  box-shadow: inset -16px 0 36px -34px rgba(23, 32, 42, 0.46);
}
.splitter {
  position: relative;
  min-width: var(--splitter-width);
  min-height: 0;
  border: 0;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
  z-index: 8;
}
.splitter::before {
  position: absolute;
  inset: 0 auto 0 50%;
  width: 2px;
  background: rgba(23, 32, 42, 0.16);
  content: "";
  transform: translateX(-50%);
}
.splitter::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 7px;
  height: 76px;
  border: 1px solid rgba(23, 32, 42, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  content: "";
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity 120ms ease, background 120ms ease, border-color 120ms ease;
}
.splitter:hover::after,
.splitter:focus-visible::after,
.app.resizing .splitter::after {
  border-color: rgba(23, 32, 42, 0.42);
  background: rgba(255, 255, 255, 0.96);
  opacity: 1;
}
.splitter:focus-visible {
  outline: 3px solid rgba(47, 111, 187, 0.22);
  outline-offset: -3px;
}
.viewer {
  min-width: 0;
  min-height: 0;
  padding: 14px clamp(18px, 2vw, 34px) 34px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.sidebar-top {
  position: sticky;
  top: -1px;
  z-index: 6;
  margin: -12px -14px 0;
  padding: 14px 14px 12px;
  background: var(--panel-soft);
  box-shadow: 0 16px 30px -30px rgba(23, 32, 42, 0.78);
}
.eyebrow {
  margin: 0 0 4px;
  color: var(--blue);
  font: 800 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 36px; line-height: 1; }
.sidebar h1 {
  color: var(--ink);
  font: 900 26px/1.02 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
h2 { font-size: 28px; line-height: 1.12; overflow-wrap: anywhere; }
.toolbar { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 12px; }
input[type="search"] {
  min-width: 0;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  padding: 0 14px;
  color: var(--ink);
  font: 700 14px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  outline: 0;
}
input[type="search"]:focus {
  border-color: var(--focus);
  box-shadow: 0 0 0 3px rgba(47, 111, 187, 0.13);
}
button, .exports a {
  min-height: 40px;
  border: 1px solid var(--ink);
  border-radius: 8px;
  background: var(--ink);
  color: white;
  padding: 0 14px;
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-decoration: none;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
}
button:hover, .exports a:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px -20px rgba(23, 32, 42, 0.82);
}
button:focus-visible,
.exports a:focus-visible,
.source-tab:focus-visible,
.session:focus-visible,
.project-more:focus-visible,
.sessions-load-more:focus-visible {
  outline: 3px solid rgba(47, 111, 187, 0.22);
  outline-offset: 2px;
}
button:disabled {
  cursor: wait;
  opacity: 0.62;
  transform: none;
  box-shadow: none;
}
.loading-state {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  color: var(--muted);
  padding: 12px;
  font: 800 12px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: var(--shadow-soft);
}
.turns > .loading-state {
  justify-self: center;
  justify-content: center;
  width: min(460px, 100%);
  min-height: 86px;
}
.loading-spinner {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border: 2px solid rgba(23, 32, 42, 0.16);
  border-top-color: var(--ink);
  border-radius: 999px;
  animation: snapshot-spin 0.8s linear infinite;
}
@keyframes snapshot-spin {
  to { transform: rotate(360deg); }
}
.sessions {
  display: grid;
  gap: 14px;
  margin-top: 16px;
}
.source-switcher {
  position: sticky;
  top: 108px;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  border: 1px solid rgba(23, 32, 42, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  padding: 5px;
  box-shadow: 0 14px 28px -30px rgba(23, 32, 42, 0.72);
}
.source-tab {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
  min-height: 36px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: rgba(23, 32, 42, 0.64);
  padding: 0 9px;
  text-align: left;
  font: 900 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.source-tab:hover {
  border-color: rgba(23, 32, 42, 0.16);
  background: rgba(23, 32, 42, 0.06);
  color: var(--ink);
}
.source-tab.active {
  border-color: var(--teal);
  background: var(--teal);
  color: #fff;
  box-shadow: none;
}
.source-tab span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-tab b {
  color: inherit;
  font: inherit;
}
.source-total {
  color: var(--muted);
  font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.source-empty {
  margin-left: 34px;
  color: rgba(23, 32, 42, 0.48);
  font: 700 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.project-group {
  display: grid;
  gap: 8px;
  border-top: 1px solid rgba(23, 32, 42, 0.08);
  padding-top: 12px;
}
.project-header {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 11px;
  align-items: center;
  width: 100%;
  min-height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(23, 32, 42, 0.78);
  padding: 0;
  text-align: left;
  font: 900 19px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: none;
  cursor: pointer;
}
.project-header:hover {
  background: rgba(23, 32, 42, 0.06);
  color: var(--ink);
  transform: none;
  box-shadow: none;
}
.project-header:focus-visible {
  outline: 3px solid rgba(15, 118, 110, 0.28);
  outline-offset: 2px;
}
.project-group.collapsed .project-header {
  color: rgba(23, 32, 42, 0.62);
}
.project-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-count {
  color: var(--muted);
  font: 900 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.project-icon {
  position: relative;
  display: inline-block;
  width: 21px;
  height: 15px;
  border: 2px solid currentColor;
  border-radius: 3px;
}
.project-icon::before {
  position: absolute;
  top: -7px;
  left: 1px;
  width: 10px;
  height: 6px;
  border: 2px solid currentColor;
  border-bottom: 0;
  border-radius: 3px 3px 0 0;
  content: "";
}
.session-list {
  display: grid;
  gap: 4px;
  margin-left: 34px;
}
.session {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  width: 100%;
  min-height: 38px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  padding: 8px 11px;
  text-align: left;
  box-shadow: none;
}
.session::before {
  position: absolute;
  inset: 9px auto 9px 0;
  width: 3px;
  border-radius: 99px;
  background: transparent;
  content: "";
}
.session:hover, .session.active {
  background: rgba(15, 118, 110, 0.1);
  transform: none;
  box-shadow: none;
}
.session.active::before { background: var(--teal); }
.session strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  line-height: 1.25;
}
.session-time {
  color: var(--muted);
  font: 900 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
}
.session-badge {
  border: 1px solid rgba(183, 121, 31, 0.32);
  background: rgba(255, 248, 232, 0.86);
  color: var(--amber);
  padding: 3px 5px;
  font: 800 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  white-space: nowrap;
}
.project-more {
  justify-self: start;
  min-height: 30px;
  margin-left: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(23, 32, 42, 0.5);
  padding: 4px 10px;
  font: 800 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: none;
}
.project-more:hover {
  color: var(--ink);
  background: rgba(23, 32, 42, 0.06);
  transform: none;
  box-shadow: none;
}
.project-note {
  margin-left: 44px;
  color: rgba(23, 32, 42, 0.52);
  font: 700 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.load-more-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin-left: 34px;
}
.sessions-load-more {
  width: 100%;
  min-height: 42px;
  border: 1px solid rgba(23, 32, 42, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
  color: var(--ink);
  box-shadow: none;
}
.sessions-load-more:hover {
  background: rgba(23, 32, 42, 0.07);
  transform: none;
  box-shadow: none;
}
.sessions-load-more:disabled {
  background: rgba(23, 32, 42, 0.05);
}
.load-more-meta {
  color: rgba(23, 32, 42, 0.48);
  font: 700 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.load-more-error {
  color: var(--red);
}
.project-group.no-project .project-header {
  grid-template-columns: minmax(0, 1fr) auto;
  margin-left: 34px;
  color: rgba(23, 32, 42, 0.58);
  font-size: 13px;
  letter-spacing: 0;
  width: calc(100% - 34px);
}
.project-group.no-project .project-icon {
  display: none;
}
.viewer-top {
  position: sticky;
  top: 0;
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid rgba(23, 32, 42, 0.12);
  margin: -14px clamp(-34px, -2vw, -18px) 14px;
  padding: 12px clamp(18px, 2vw, 34px);
  background: var(--paper);
  box-shadow: 0 18px 42px -38px rgba(23, 32, 42, 0.72);
  isolation: isolate;
}
.viewer-top::before {
  position: absolute;
  right: 0;
  bottom: 100%;
  left: 0;
  height: 36px;
  background: var(--paper);
  content: "";
  pointer-events: none;
}
.switches { display: flex; flex-wrap: wrap; gap: 8px; justify-content: end; }
.switches label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.88);
  padding: 0 10px;
  font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  user-select: none;
}
.switches input {
  accent-color: var(--teal);
}
.meta, .risks, .exports { margin-top: 10px; }
.risks:empty { display: none; }
.meta {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-wash);
  padding: 10px;
  color: var(--muted);
  font: 800 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
  box-shadow: var(--shadow-soft);
}
.meta.loading {
  border: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}
.meta.loading .loading-state {
  width: 100%;
}
.meta-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.meta-pill {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(23, 32, 42, 0.09);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.7);
  padding: 8px 10px;
  color: var(--ink);
}
.meta-pill b {
  color: var(--soft);
  font: 900 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  white-space: nowrap;
}
.meta-pill span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.risks { display: grid; gap: 8px; }
.notice {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  border-left: 5px solid var(--amber);
  border-radius: 8px;
  background: rgba(255, 248, 232, 0.9);
  padding: 10px 12px;
}
.notice b {
  color: var(--amber);
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.notice span {
  overflow-wrap: anywhere;
}
.risk {
  display: grid;
  grid-template-columns: 76px minmax(160px, 0.65fr) minmax(0, 1.35fr);
  gap: 10px;
  align-items: start;
  border-left: 5px solid var(--green);
  border-radius: 8px;
  background: rgba(245, 251, 247, 0.9);
  padding: 11px 12px;
}
.risk.high { border-color: var(--red); background: rgba(255, 241, 238, 0.92); }
.risk.medium { border-color: var(--amber); background: rgba(255, 248, 232, 0.9); }
.risk b, .risk span, .risk em { min-width: 0; }
.risk b { font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
.risk span { line-height: 1.35; overflow-wrap: normal; }
.risk em { color: var(--muted); font-style: normal; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.exports { display: flex; flex-wrap: wrap; gap: 8px; }
.exports a,
.exports button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  border-radius: 7px;
  padding: 0 11px;
  font-size: 11px;
}
.exports button[data-publish-cloud] {
  border-color: var(--teal);
  background: var(--teal);
}
.publish-status {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  max-width: min(680px, 100%);
  overflow-wrap: anywhere;
  color: var(--muted);
  font: 800 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.publish-status a {
  color: var(--blue);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.publish-status.error {
  color: var(--red);
}
.turns {
  display: grid;
  gap: 32px;
  width: min(1600px, 100%);
  margin: 24px auto 0;
}
.turn {
  display: flex;
  min-width: 0;
}
.user { justify-content: flex-end; }
.assistant, .tool { justify-content: flex-start; }
.process { justify-content: flex-start; }
.message-card {
  min-width: 0;
  max-width: min(1160px, 74%);
  border: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}
.user .message-card {
  max-width: min(1220px, 76%);
  border: 1px solid rgba(15, 118, 110, 0.18);
  border-radius: 8px;
  background: #eef9f6;
  padding: 12px 18px;
  box-shadow: 0 26px 64px -56px rgba(23, 32, 42, 0.48);
}
.assistant .message-card {
  max-width: min(1120px, 74%);
}
.tool .message-card {
  max-width: min(1160px, 80%);
  border: 1px solid rgba(183, 121, 31, 0.26);
  border-radius: 8px;
  background: #fff8df;
  padding: 16px 18px;
}
.turn-meta {
  margin-bottom: 10px;
  color: var(--muted);
  font: 900 11px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.turn-meta span { font-weight: 700; }
.process-details {
  width: min(1120px, 74%);
  border-top: 1px solid rgba(23, 32, 42, 0.1);
  color: rgba(23, 32, 42, 0.62);
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
.process-summary::-webkit-details-marker {
  display: none;
}
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
  gap: 24px;
  padding: 6px 0 8px;
}
.process-entry {
  min-width: 0;
}
.process-entry .body {
  color: var(--ink);
  font-size: 17px;
}
.process-tool {
  max-width: min(980px, 100%);
  border-left: 3px solid rgba(183, 121, 31, 0.32);
  padding-left: 12px;
}
.body {
  min-width: 0;
  max-width: 78ch;
  font-size: 18px;
  line-height: 1.7;
}
.body > * { margin: 0; }
.body > * + * { margin-top: 18px; }
.body p, .body li { overflow-wrap: anywhere; }
.body strong { font-weight: 800; }
.body em { font-style: italic; }
.body a { color: var(--blue); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.body code {
  border: 1px solid rgba(23, 32, 42, 0.12);
  border-radius: 6px;
  background: rgba(23, 32, 42, 0.06);
  padding: 0.08rem 0.34rem;
  font-size: 0.9em;
}
.body pre {
  position: relative;
  max-width: 100%;
  overflow: auto;
  border: 1px solid #253043;
  border-radius: 8px;
  background: #111722;
  color: #edf4ff;
  padding: 38px 16px 16px;
  font: 13px/1.58 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre;
  box-shadow: 0 26px 64px -52px rgba(23, 32, 42, 0.8);
}
.body pre[data-language]::before {
  position: absolute;
  top: 10px;
  right: 12px;
  max-width: calc(100% - 24px);
  overflow: hidden;
  color: #aeb8c8;
  content: attr(data-language);
  font: 900 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}
.body pre code {
  display: block;
  min-width: max-content;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
}
.body .hljs-keyword,
.body .hljs-selector-tag,
.body .hljs-built_in { color: #8ab4f8; }
.body .hljs-title,
.body .hljs-title.class_,
.body .hljs-title.function_ { color: #f2cc60; }
.body .hljs-string,
.body .hljs-attr,
.body .hljs-symbol { color: #9ccc65; }
.body .hljs-number,
.body .hljs-literal { color: #f8a978; }
.body .hljs-comment { color: #7d8796; font-style: italic; }
.body .hljs-type,
.body .hljs-params,
.body .hljs-variable,
.body .hljs-property { color: #c4b5fd; }
.body ul, .body ol { padding-left: 1.35rem; }
.body li + li { margin-top: 0.25rem; }
.body blockquote {
  border-left: 3px solid #ccd5df;
  margin-left: 0;
  padding-left: 14px;
  color: #4b5563;
}
.body h1, .body h2, .body h3 {
  line-height: 1.25;
  font-size: 1.08em;
}
.attachment-grid {
  display: grid;
  gap: 18px;
  margin-top: 24px;
}
.body > .attachment-grid { margin-top: 24px; }
.image-attachment {
  margin: 0;
  min-width: 0;
}
.image-attachment img {
  display: block;
  max-width: 100%;
  max-height: 520px;
  border: 1px solid rgba(23, 32, 42, 0.18);
  border-radius: 8px;
  background: #fff;
  object-fit: contain;
  box-shadow: 0 24px 54px -50px rgba(23, 32, 42, 0.6);
}
.image-attachment figcaption {
  margin-top: 10px;
  color: var(--muted);
  font: 800 14px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.image-unavailable {
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 16px;
  color: var(--muted);
}
pre {
  overflow: auto;
  max-height: 460px;
  margin: 0;
  border: 1px solid #252c39;
  background: #111722;
  color: #edf4ff;
  padding: 12px;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
}
.empty { color: var(--muted); }
@media (max-width: 900px) {
  .app {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 38dvh) minmax(0, 1fr);
  }
  .viewer {
    padding: 22px 18px 34px;
  }
  .viewer-top {
    grid-template-columns: 1fr;
    margin: -22px -18px 22px;
    padding: 12px 18px 14px;
  }
  .sidebar { border-bottom: 2px solid var(--ink); }
  .splitter { display: none; }
  .sidebar-top { position: static; }
  .source-switcher { position: static; }
  .switches { justify-content: start; }
  .risk { grid-template-columns: 1fr; }
  .turns { gap: 36px; }
  .message-card, .user .message-card { max-width: 94%; }
  .assistant .message-card { max-width: 100%; }
  .user .message-card { padding: 12px 16px; }
  .body { font-size: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-spinner { animation: none; }
}
`;
}

function serverJs() {
  return `
const state = { sessions: [], selected: "", activeSource: "codex", requestToken: 0, expandedProjects: new Set(), collapsedProjects: new Set(), hasMoreSessions: false, loadingMoreSessions: false, sessionListError: "" };
const SOURCE_MODULES = [
  { key: "codex", label: "Codex" },
  { key: "claude", label: "Claude Code" },
  { key: "trae", label: "Trae" },
];
const SESSION_BATCH_LIMIT = 200;
const SAFETY_CHECKS_ENABLED = false;
const SIDEBAR_WIDTH_KEY = "codex-snapshot.sidebar-width";
const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 680;
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const shareConfig = window.CODEX_SNAPSHOT_SHARE_CONFIG || {};

function renderLoading(message) {
  return "<div class='loading-state' role='status' aria-live='polite' aria-busy='true'>" +
    "<span class='loading-spinner' aria-hidden='true'></span>" +
    "<span>" + esc(message) + "</span>" +
  "</div>";
}

function activeOptions() {
  if ($("includeToolOutput").checked) {
    $("includeTools").checked = true;
  }
  return new URLSearchParams({
    id: state.selected,
    includeTools: $("includeTools").checked ? "1" : "0",
    includeToolOutput: $("includeToolOutput").checked ? "1" : "0",
    redact: $("redact").checked ? "1" : "0",
    safety: SAFETY_CHECKS_ENABLED ? "1" : "0",
  });
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sidebarMaxWidth() {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - 520));
}

function currentSidebarWidth() {
  const sidebar = document.querySelector(".sidebar");
  return sidebar ? sidebar.getBoundingClientRect().width : 360;
}

function setSidebarWidth(value, persist) {
  if (window.matchMedia("(max-width: 900px)").matches) {
    return;
  }
  const width = Math.round(clampNumber(Number(value) || currentSidebarWidth(), SIDEBAR_MIN, sidebarMaxWidth()));
  document.documentElement.style.setProperty("--sidebar-width", width + "px");
  const splitter = $("splitter");
  if (splitter) {
    splitter.setAttribute("aria-valuenow", String(width));
    splitter.setAttribute("aria-valuetext", width + "px");
  }
  if (persist) {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }
}

function initSplitter() {
  const splitter = $("splitter");
  const app = document.querySelector(".app");
  if (!splitter || !app) {
    return;
  }
  const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  setSidebarWidth(Number.isFinite(saved) ? saved : currentSidebarWidth(), false);

  const widthFromPointer = (event) => event.clientX - app.getBoundingClientRect().left;
  const stopResize = (event) => {
    app.classList.remove("resizing");
    try {
      splitter.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer capture may already be released when the pointer leaves the window.
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  };
  const onPointerMove = (event) => {
    event.preventDefault();
    setSidebarWidth(widthFromPointer(event), true);
  };

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    app.classList.add("resizing");
    splitter.setPointerCapture(event.pointerId);
    setSidebarWidth(widthFromPointer(event), true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  });

  splitter.addEventListener("keydown", (event) => {
    const current = Number(splitter.getAttribute("aria-valuenow")) || currentSidebarWidth();
    const step = event.shiftKey ? 40 : 16;
    let next = current;
    if (event.key === "ArrowLeft") next = current - step;
    else if (event.key === "ArrowRight") next = current + step;
    else if (event.key === "Home") next = SIDEBAR_MIN;
    else if (event.key === "End") next = sidebarMaxWidth();
    else return;
    event.preventDefault();
    setSidebarWidth(next, true);
  });

  window.addEventListener("resize", () => setSidebarWidth(currentSidebarWidth(), true));
}

async function loadSessions() {
  setViewerLoading("正在加载会话...");
  $("sessions").innerHTML = renderLoading("正在加载会话...");
  $("sessions").setAttribute("aria-busy", "true");
  $("reload").disabled = true;
  state.sessions = [];
  state.hasMoreSessions = false;
  state.loadingMoreSessions = false;
  state.sessionListError = "";
  try {
    const sessions = await fetchSessionPage(0);
    state.sessions = sessions;
    state.hasMoreSessions = sessions.length === SESSION_BATCH_LIMIT;
    if (!sourceSessions(state.activeSource).length) {
      const firstSourceWithSessions = SOURCE_MODULES.find((source) => sourceSessions(source.key).length);
      if (firstSourceWithSessions) {
        state.activeSource = firstSourceWithSessions.key;
      }
    }
    await selectFirstSessionForActiveSource();
  } catch (error) {
    state.sessionListError = error instanceof Error ? error.message : String(error);
    renderSessions();
    clearViewer("会话列表加载失败。");
  } finally {
    $("sessions").removeAttribute("aria-busy");
    $("reload").disabled = false;
  }
}

async function fetchSessionPage(offset) {
  const query = new URLSearchParams({
    source: "all",
    limit: String(SESSION_BATCH_LIMIT),
    offset: String(Math.max(0, Number(offset) || 0)),
  });
  const response = await fetch("/api/sessions?" + query.toString());
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Failed to load sessions");
  }
  return Array.isArray(result) ? result : [];
}

function appendSessions(sessions) {
  const seen = new Set(state.sessions.map(sessionRef));
  const nextSessions = [];
  for (const session of sessions) {
    const ref = sessionRef(session);
    if (!seen.has(ref)) {
      seen.add(ref);
      nextSessions.push(session);
    }
  }
  state.sessions = state.sessions.concat(nextSessions);
}

async function loadMoreSessions() {
  if (state.loadingMoreSessions || !state.hasMoreSessions) {
    return;
  }
  state.loadingMoreSessions = true;
  state.sessionListError = "";
  renderSessions();
  try {
    const sessions = await fetchSessionPage(state.sessions.length);
    appendSessions(sessions);
    state.hasMoreSessions = sessions.length === SESSION_BATCH_LIMIT;
    if (!state.selected && sourceSessions(state.activeSource).length) {
      await selectFirstSessionForActiveSource();
      return;
    }
  } catch (error) {
    state.sessionListError = error instanceof Error ? error.message : String(error);
  } finally {
    state.loadingMoreSessions = false;
    renderSessions();
  }
}

function renderSessions() {
  const filter = $("filter").value.trim().toLowerCase();
  const source = sourceByKey(state.activeSource);
  const sessions = sourceSessions(source.key);
  const sourceMatches = (source.label + " " + source.key).toLowerCase().includes(filter);
  const groups = groupSessions(sessions, sourceMatches ? "" : filter);
  const body = groups.length
    ? groups.map(renderProjectGroup).join("")
    : "<div class='source-empty'>" + (filter ? "没有匹配的会话" : "暂无会话") + "</div>";
  $("sessions").innerHTML = renderSourceSwitcher() + body + renderLoadMore();
}

function renderSourceSwitcher() {
  return "<div class='source-switcher' role='tablist' aria-label='Session source'>" +
    SOURCE_MODULES.map((source) => {
      const count = sourceSessions(source.key).length;
      const active = source.key === state.activeSource;
      return "<button class='source-tab" + (active ? " active" : "") + "' type='button' role='tab' aria-selected='" + (active ? "true" : "false") + "' data-source='" + esc(source.key) + "'>" +
        "<span>" + esc(source.label) + "</span>" +
        "<b>" + esc(count) + "</b>" +
      "</button>";
    }).join("") +
  "</div>";
}

function renderLoadMore() {
  if (!state.hasMoreSessions && !state.loadingMoreSessions && !state.sessionListError) {
    return "";
  }
  const button = state.hasMoreSessions || state.loadingMoreSessions
    ? "<button class='sessions-load-more' type='button' data-load-more='1'" + (state.loadingMoreSessions ? " disabled aria-busy='true'" : "") + ">" + (state.loadingMoreSessions ? "正在加载..." : "加载更多") + "</button>"
    : "";
  const status = state.sessionListError
    ? "<span class='load-more-meta load-more-error'>" + esc(state.sessionListError) + "</span>"
    : "<span class='load-more-meta'>已加载 " + esc(state.sessions.length) + " 条</span>";
  return "<div class='load-more-row'>" + button + status + "</div>";
}

function sourceByKey(key) {
  return SOURCE_MODULES.find((source) => source.key === key) || SOURCE_MODULES[0];
}

function sourceSessions(key) {
  return state.sessions.filter((session) => sessionEngine(session) === key);
}

async function selectFirstSessionForActiveSource() {
  const sessions = sourceSessions(state.activeSource);
  if (!sessions.length) {
    state.selected = "";
    renderSessions();
    clearViewer(sourceByKey(state.activeSource).label + " 暂无可审阅会话。");
    return;
  }
  const selected = sessions.find((session) => sessionRef(session) === state.selected);
  await selectSession(sessionRef(selected || sessions[0]));
}

function setViewerLoading(message) {
  state.requestToken += 1;
  $("title").textContent = "正在加载会话";
  $("meta").classList.add("empty", "loading");
  $("meta").innerHTML = renderLoading(message || "正在加载...");
  $("risks").innerHTML = "";
  $("exports").innerHTML = "";
  $("turns").innerHTML = "";
}

function clearViewer(message) {
  state.requestToken += 1;
  $("title").textContent = "选择一个会话";
  $("meta").textContent = message || "还没有选择会话。";
  $("meta").classList.add("empty");
  $("meta").classList.remove("loading");
  $("risks").innerHTML = "";
  $("exports").innerHTML = "";
  $("turns").innerHTML = "";
}

function sessionEngine(session) {
  return session.engine || "codex";
}

function sessionRef(session) {
  return session.ref || (sessionEngine(session) + ":" + session.id);
}

function groupSessions(sessions, filter) {
  const groupMap = new Map();
  for (const session of sessions) {
    const key = projectKey(session);
    const isNoProject = isNoProjectSession(session);
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        label: projectLabel(session),
        displayPath: projectDisplayPath(session),
        isNoProject,
        newestMs: 0,
        sessions: [],
      });
    }
    const group = groupMap.get(key);
    group.sessions.push(session);
    const mtime = new Date(session.mtime).getTime();
    if (Number.isFinite(mtime)) {
      group.newestMs = Math.max(group.newestMs, mtime);
    }
  }
  const groups = sortProjectGroups(Array.from(groupMap.values()));
  if (!filter) {
    return groups;
  }
  return sortProjectGroups(groups.map((group) => {
    const projectHaystack = (group.label + " " + group.displayPath + " " + group.key).toLowerCase();
    const projectMatches = projectHaystack.includes(filter);
    const filteredSessions = projectMatches
      ? group.sessions
      : group.sessions.filter((session) => sessionHaystack(session, group).includes(filter));
    return { ...group, sessions: filteredSessions };
  }).filter((group) => group.sessions.length));
}

function projectKey(session) {
  if (isNoProjectSession(session)) {
    return sessionEngine(session) + "::no-project";
  }
  return sessionEngine(session) + "::" + projectPath(session);
}

function isNoProjectSession(session) {
  if (session.projectKind === "none" || session.projectKind === "conversation") {
    return true;
  }
  const cwd = projectPath(session);
  return !cwd || cwd === "/" || cwd === "No project" || isCodexStandaloneConversationPath(session);
}

function isCodexStandaloneConversationPath(session) {
  if (sessionEngine(session) !== "codex") {
    return false;
  }
  return [session.cwd, session.displayCwd].some(isStandaloneConversationPath);
}

function isStandaloneConversationPath(value) {
  const parts = normalizeProjectPath(value).split("/").filter(Boolean);
  const codexIndex = parts.findIndex((part, index) => part === "Codex" && parts[index - 1] === "Documents");
  if (codexIndex < 0 || codexIndex + 3 !== parts.length) {
    return false;
  }
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(parts[codexIndex + 1]) && Boolean(parts[codexIndex + 2]);
}

function projectDisplayPath(session) {
  return isNoProjectSession(session) ? "普通会话" : projectPath(session);
}

function projectPath(session) {
  return String(session.cwd || session.displayCwd || "").trim();
}

function normalizeProjectPath(value) {
  return String(value || "").trim().replace(/\\\\/g, "/").replace(/\\/+$/, "");
}

function sortProjectGroups(groups) {
  return groups.slice().sort((a, b) => {
    if (a.isNoProject !== b.isNoProject) {
      return a.isNoProject ? 1 : -1;
    }
    return (b.newestMs || 0) - (a.newestMs || 0) || a.label.localeCompare(b.label);
  });
}

function projectLabel(session) {
  if (isNoProjectSession(session)) {
    return "普通会话";
  }
  const value = String(session.displayCwd || session.cwd || "No project").replace(/[\\\\/]+$/, "");
  const parts = value.split(/[\\\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value || "No project";
}

function sessionHaystack(session, group) {
  return [
    session.engineLabel,
    session.engine,
    session.title,
    session.cwd,
    session.displayCwd,
    session.id,
    session.ref,
    group.label,
    group.displayPath,
  ].filter(Boolean).join(" ").toLowerCase();
}

function renderProjectGroup(group) {
  const collapsedLimit = 5;
  const noisyExpandedLimit = 25;
  const expanded = state.expandedProjects.has(group.key);
  const collapsed = state.collapsedProjects.has(group.key);
  const activeIndex = group.sessions.findIndex((session) => sessionRef(session) === state.selected);
  const expandedLimit = group.isNoProject ? Math.min(noisyExpandedLimit, group.sessions.length) : group.sessions.length;
  const visibleLimit = expanded ? expandedLimit : Math.min(collapsedLimit, group.sessions.length);
  let visible = group.sessions.slice(0, visibleLimit);
  if (!collapsed && activeIndex >= visibleLimit) {
    visible = visible.slice(0, Math.max(0, visibleLimit - 1)).concat(group.sessions[activeIndex]);
  }
  const showToggle = !collapsed && group.sessions.length > collapsedLimit;
  const toggleLabel = expanded ? "收起" : group.isNoProject ? "显示最近 " + Math.min(noisyExpandedLimit, group.sessions.length) : "展开显示";
  const toggle = showToggle
    ? "<button class='project-more' type='button' data-project-toggle='" + esc(group.key) + "'>" + toggleLabel + "</button>"
    : "";
  const note = !collapsed && group.isNoProject && expanded && group.sessions.length > noisyExpandedLimit
    ? "<div class='project-note'>仅显示最近 " + noisyExpandedLimit + " / " + esc(group.sessions.length) + "，可搜索标题定位更多</div>"
    : "";
  const sessionList = collapsed ? "" : "<div class='session-list'>" + visible.map(renderSessionRow).join("") + "</div>";
  const sectionClass = "project-group" + (group.isNoProject ? " no-project" : "") + (collapsed ? " collapsed" : "");
  return "<section class='" + sectionClass + "'>" +
    "<button class='project-header' type='button' data-project-collapse='" + esc(group.key) + "' aria-expanded='" + (collapsed ? "false" : "true") + "' title='" + esc(group.displayPath) + "'>" +
      "<span class='project-icon' aria-hidden='true'></span>" +
      "<span class='project-title'>" + esc(group.label) + "</span>" +
      "<span class='project-count'>" + esc(group.sessions.length) + "</span>" +
    "</button>" +
    sessionList +
    note +
    toggle +
  "</section>";
}

function renderSessionRow(session) {
  const ref = sessionRef(session);
  const active = ref === state.selected ? " active" : "";
  const badge = session.historyOnly ? "<span class='session-badge'>history</span>" : "";
  return "<button class='session" + active + "' data-id='" + esc(ref) + "' title='" + esc(session.title) + "'>" +
    "<strong>" + esc(session.title) + "</strong>" +
    badge +
    "<span class='session-time'>" + esc(relativeTime(session.mtime)) + "</span>" +
  "</button>";
}

function relativeTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return "";
  }
  const diff = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return "刚刚";
  }
  if (diff < hour) {
    return Math.max(1, Math.floor(diff / minute)) + " 分钟";
  }
  if (diff < day) {
    return Math.max(1, Math.floor(diff / hour)) + " 小时";
  }
  if (diff < 7 * day) {
    return Math.max(1, Math.floor(diff / day)) + " 天";
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(time));
}

async function selectSession(id) {
  const requestToken = state.requestToken + 1;
  state.requestToken = requestToken;
  state.selected = id;
  renderSessions();
  $("turns").innerHTML = renderLoading("正在加载会话内容...");
  $("turns").setAttribute("aria-busy", "true");
  const response = await fetch("/api/snapshot?" + activeOptions().toString());
  const snapshot = await response.json();
  if (requestToken !== state.requestToken || id !== state.selected) {
    return;
  }
  if (snapshot.error) {
    $("turns").innerHTML = "<div class='meta'>" + esc(snapshot.error) + "</div>";
    $("turns").removeAttribute("aria-busy");
    return;
  }
  renderSnapshot(snapshot);
}

function renderSnapshot(snapshot) {
  $("turns").removeAttribute("aria-busy");
  $("title").textContent = snapshot.title;
  $("meta").classList.remove("empty", "loading");
  $("meta").innerHTML = renderSnapshotMeta(snapshot);
  const notices = (snapshot.notices || []).map((notice) => {
    return "<div class='notice " + esc(notice.severity || "medium") + "'><b>NOTE</b><span><strong>" + esc(notice.label || "Notice") + ".</strong> " + esc(notice.text || "") + "</span></div>";
  }).join("");
  const risks = snapshot.risks.length ? snapshot.risks.map((risk) => {
    return "<div class='risk " + esc(risk.severity) + "'><b>" + esc(risk.severity) + "</b><span>" + esc(risk.label) + "</span><em>" + esc(formatRiskTurns(risk)) + "</em></div>";
  }).join("") : "<div class='risk'><b>OK</b><span>未发现常见高风险模式</span><em>分享前仍建议快速复核。</em></div>";
  $("risks").innerHTML = snapshot.safetyChecks === false ? "" : notices + risks;
  const options = activeOptions();
  $("exports").innerHTML = "<a href='/export?" + options.toString() + "&format=html' target='_blank' rel='noopener noreferrer'>导出 HTML</a><a href='/export?" + options.toString() + "&format=md' target='_blank' rel='noopener noreferrer'>导出 Markdown</a><button type='button' data-publish-cloud='1'>发布分享</button><span id='publishStatus' class='publish-status'></span>";
  $("turns").innerHTML = buildTranscriptItems(snapshot.turns || []).map(renderTranscriptItem).join("") || "<div class='meta'>没有找到可分享的用户或助手消息。</div>";
  openContentLinksInNewTabs($("turns"));
  postSnapshotState(snapshot);
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
  return renderTurnArticle(item.turn);
}

function renderTurnArticle(turn) {
  const role = turn.kind === "tool" ? "tool" : turn.role;
  const meta = role === "tool" ? "<div class='turn-meta'>" + esc(turnLabel(role, turn)) + "</div>" : "";
  return "<article class='turn " + esc(role) + "'><div class='message-card'>" + meta + "<div class='body'>" + renderTurnBody(turn) + "</div></div></article>";
}

function renderProcessGroup(item, index) {
  const turns = item.turns || [];
  if (!turns.length) {
    return "";
  }
  return "<article class='turn process'>" +
    "<details class='process-details' data-process-index='" + esc(index) + "'>" +
      "<summary class='process-summary'><span>" + esc(processLabel(item.durationTurns || turns)) + "</span></summary>" +
      "<div class='process-body'>" + turns.map(renderProcessEntry).join("") + "</div>" +
    "</details>" +
  "</article>";
}

function renderProcessEntry(turn) {
  const role = turn.kind === "tool" ? "tool" : turn.role;
  return "<section class='process-entry process-" + esc(role) + "'>" +
    (role === "tool" ? "" : "<div class='turn-meta'>" + esc(turnLabel(role, turn)) + "</div>") +
    "<div class='body'>" + renderTurnBody(turn) + "</div>" +
  "</section>";
}

function renderTurnBody(turn) {
  if (turn.kind === "tool") {
    const label = "Tool" + (turn.name ? " / " + esc(turn.name) : "");
    return "<details class='tool-details'><summary>" + label + "</summary><pre>" + esc(turn.text) + "</pre></details>";
  }
  return (stripAppDirectiveHtml(turn.html || "") || renderText(turn.text)) + renderImages(turn.images || []);
}

function processLabel(turns) {
  const duration = processDurationLabel(turns);
  return duration ? "已处理 " + duration : "已处理";
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

function renderSnapshotMeta(snapshot) {
  const items = [
    ["来源", (snapshot.engineLabel || "Codex") + (snapshot.sourceDetail ? " / " + snapshot.sourceDetail : "")],
    ["会话", snapshot.id || "unknown"],
    ["项目", projectDisplayPath(snapshot) || "no cwd"],
    ["记录", String((snapshot.turns || []).length) + " 条"],
    ["脱敏", snapshot.redacted ? "已开启" : "未开启"],
  ];
  return "<div class='meta-pills'>" + items.map(([label, value]) => {
    return "<span class='meta-pill'><b>" + esc(label) + "</b><span>" + esc(value) + "</span></span>";
  }).join("") + "</div>";
}

function turnLabel(role, turn) {
  if (role === "tool") {
    return "Tool" + (turn.name ? " / " + turn.name : "");
  }
  if (role === "user") {
    return "User";
  }
  if (role === "assistant") {
    return "Assistant";
  }
  return role || "Message";
}

function postSnapshotState(snapshot) {
  if (!window.parent || window.parent === window) {
    return;
  }
  const options = activeOptions();
  window.parent.postMessage({
    type: "codex-snapshot:state",
    version: 1,
    selected: state.selected,
    title: snapshot.title || state.selected,
    engineLabel: snapshot.engineLabel || "Codex",
    redacted: Boolean(snapshot.redacted),
    options: Object.fromEntries(options.entries()),
  }, "*");
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

async function publishSelectedSession() {
  if (!state.selected) {
    return;
  }
  const status = $("publishStatus");
  const button = document.querySelector("[data-publish-cloud]");
  if (button) button.disabled = true;
  if (status) {
    status.textContent = shareConfig.apiUrl ? "正在发布到 " + shareConfig.apiUrl + "..." : "正在发布...";
    status.classList.remove("error");
  }
  try {
    const options = activeOptions();
    options.set("redact", "1");
    const response = await fetch("/api/publish?" + options.toString(), { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Publish failed");
    }
    if (status) {
      status.innerHTML = "<a href='" + esc(result.url) + "' target='_blank' rel='noopener noreferrer'>" + esc(result.url) + "</a>";
    }
    await navigator.clipboard?.writeText(result.url).catch(() => undefined);
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.classList.add("error");
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function formatRiskTurns(risk) {
  const turns = Array.isArray(risk.turns) ? risk.turns : [];
  const visibleTurns = turns.slice(0, 18).join(", ");
  const hiddenCount = Math.max(0, turns.length - 18);
  const suffix = hiddenCount ? ", +" + hiddenCount + " more" : "";
  return risk.count + " match(es)" + (turns.length ? ", turns " + visibleTurns + suffix : "");
}

function renderText(text) {
  const visibleText = stripAppDirectives(text);
  if (!visibleText) {
    return "";
  }
  return visibleText.split(/\\n{2,}/).map((block) => "<p>" + esc(block).replace(/\\n/g, "<br>") + "</p>").join("");
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

function renderImages(images) {
  if (!images.length) {
    return "";
  }
  return "<div class='attachment-grid'>" + images.map((image, index) => {
    const label = (image.mimeType || "image") + (image.size ? " / " + image.size : "");
    if (!image.src) {
      return "<figure class='image-attachment image-unavailable'><div>" + esc(image.unavailableReason || "Image unavailable") + "</div><figcaption>" + esc(label) + "</figcaption></figure>";
    }
    return "<figure class='image-attachment'><img src='" + esc(image.src) + "' alt='" + esc(image.alt || ("Image attachment " + (index + 1))) + "' decoding='async'><figcaption>" + esc(label) + "</figcaption></figure>";
  }).join("") + "</div>";
}

$("sessions").addEventListener("click", async (event) => {
  const sourceButton = event.target.closest("[data-source]");
  if (sourceButton) {
    const nextSource = sourceButton.dataset.source;
    if (nextSource && nextSource !== state.activeSource) {
      state.activeSource = nextSource;
      await selectFirstSessionForActiveSource();
    }
    return;
  }
  const loadMoreButton = event.target.closest("[data-load-more]");
  if (loadMoreButton) {
    await loadMoreSessions();
    return;
  }
  const toggle = event.target.closest("[data-project-toggle]");
  if (toggle) {
    const key = toggle.dataset.projectToggle;
    if (state.expandedProjects.has(key)) {
      state.expandedProjects.delete(key);
    } else {
      state.expandedProjects.add(key);
    }
    renderSessions();
    return;
  }
  const projectHeader = event.target.closest("[data-project-collapse]");
  if (projectHeader) {
    const key = projectHeader.dataset.projectCollapse;
    if (state.collapsedProjects.has(key)) {
      state.collapsedProjects.delete(key);
    } else {
      state.collapsedProjects.add(key);
    }
    renderSessions();
    return;
  }
  const button = event.target.closest("[data-id]");
  if (button) selectSession(button.dataset.id);
});
$("filter").addEventListener("input", renderSessions);
$("reload").addEventListener("click", loadSessions);
$("exports").addEventListener("click", (event) => {
  if (event.target.closest("[data-publish-cloud]")) {
    publishSelectedSession();
  }
});
$("turns").addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (!link) {
    return;
  }
  event.preventDefault();
  openInNewTab(link.href);
});
for (const id of ["includeTools", "includeToolOutput", "redact"]) {
  $(id).addEventListener("change", () => state.selected && selectSession(state.selected));
}
initSplitter();
loadSessions().catch((error) => {
  $("sessions").innerHTML = "<div class='meta'>" + esc(error.message) + "</div>";
  clearViewer(error.message || "Failed to load sessions.");
});
`;
}

function printHelp() {
  console.log(`codex-snapshot ${VERSION}

Usage:
  codex-snapshot list [--json] [--limit N] [--cwd DIR]
  codex-snapshot preview <session-id|path> [--json] [--include-tools] [--include-tool-output]
  codex-snapshot export <session-id|path> [--html|--md] [--output FILE] [--include-tools] [--include-tool-output]
  codex-snapshot publish <session-id|path> [--api-url URL] [--share-token TOKEN] [--site-url URL]
  codex-snapshot serve [--host 127.0.0.1] [--port 4321]
  codex-snapshot record-trae [--host 127.0.0.1] [--port 4732]

Options:
  --codex-home DIR         Use a custom Codex home. Defaults to $CODEX_HOME or ~/.codex
  --claude-home DIR        Use a custom Claude Code home. Defaults to $CLAUDE_HOME or ~/.claude
  --trae-home DIR          Use a custom Trae home. Defaults to $TRAE_HOME or ~/.trae-cn
  --trae-app-home DIR      Use a custom Trae app data home. Defaults to $TRAE_APP_HOME or ~/Library/Application Support/Trae CN
  --trae-recordings-dir DIR
                           Use a custom Trae recorder output dir. Defaults to $TRAE_RECORDINGS_DIR or ~/.codex-snapshot/trae-recordings
  --source codex|claude|trae|all
                           Choose which local agent history to list. Serve shows all configured sources in the UI.
  --include-tools          Include tool calls in previews and exports
  --include-tool-output    Include tool output as well as tool calls
  --no-redact              Disable automatic redaction
  --allow-unredacted       For publish only: allow publishing a --no-redact snapshot
  --with-safety            For publish only: include local safety review rows in the cloud snapshot
  --api-url URL            For publish only: cloud API base. Defaults to $SNAPSHOT_SHARE_API_URL,
                           ~/.codex-snapshots-agent.json, or http://127.0.0.1:8787
  --site-url URL           For publish only: public site base used to print the share link.
                           Defaults to $SNAPSHOT_SHARE_SITE_URL, ~/.codex-snapshots-agent.json, or local share API
  --share-token TOKEN      For publish only: API token. Defaults to $SNAPSHOT_SHARE_TOKEN or ~/.codex-snapshots-agent.json
  --expires-in-days N      For publish only: ask the server to expire the share after N days
  --live-only              Ignore archived_sessions when listing
  --record-sensitive-context
                           For record-trae only: persist captured request/response headers as local recorder context
  -h, --help               Show this help

Examples:
  codex-snapshot list --limit 20
  codex-snapshot export 019e457b --html -o snapshot.html
  codex-snapshot publish 019e457b --api-url http://127.0.0.1:8787 --site-url http://127.0.0.1:8787
  codex-snapshot serve --port 4321
  codex-snapshot record-trae --port 4732`);
}

export {
  detectRisks,
  redactText,
  renderHtml,
  renderMarkdown,
};
