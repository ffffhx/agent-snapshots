// @ts-nocheck

import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { parseSessionFile } from "agent-session-core";
import { sessionListCacheWatermark } from "./session-list-cache.mjs";
import { stripAppDirectives as stripCodexAppDirectives } from "../shared/sanitize.js";

const DEFAULT_SCAN_LIMIT = 500;
const MAX_SCAN_LIMIT = 500;
const INSIGHTS_TABLE = "insights_cache_v1";
const ENGINE_KEYS = ["codex", "claude", "trae"];
const SHELL_TOOL_NAMES = new Set([
  "bash",
  "shell",
  "sh",
  "run_command",
  "exec_command",
  "functions.exec_command",
  "terminal",
]);
const OUTPUT_TOOL_NAMES = new Set(["function_output", "tool_result", "output"]);
const COMMAND_OPTION_VALUE_FLAGS = new Set(["-c", "-C", "--config", "--cwd", "--directory", "--project", "--filter"]);
const PROMPT_SEGMENTER = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter("zh-CN", { granularity: "word" })
  : null;

let dbPromise = null;

export function insightsCachePath() {
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "agent-snapshots", "search-index.v2.db");
}

async function getDb() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = (async () => {
    const dbFile = insightsCachePath();
    await mkdir(path.dirname(dbFile), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbFile);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(`CREATE TABLE IF NOT EXISTS ${INSIGHTS_TABLE} (
      cache_key TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      watermark REAL NOT NULL,
      scan_limit INTEGER DEFAULT 0,
      result_json TEXT NOT NULL,
      created_at INTEGER DEFAULT 0
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS insights_cache_v1_scope ON ${INSIGHTS_TABLE}(scope_key, watermark)`);
    db.exec(`CREATE INDEX IF NOT EXISTS insights_cache_v1_created ON ${INSIGHTS_TABLE}(created_at)`);
    return db;
  })();
  return dbPromise;
}

export async function buildInsights({
  codexHome,
  claudeHome,
  traeHome,
  traeAppHome,
  traeRecordingsDir,
  listSessions,
  loadSnapshot,
  source = "all",
  limit = DEFAULT_SCAN_LIMIT,
}) {
  const started = Date.now();
  const scanLimit = clampPositive(limit, DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT);
  const insightSource = normalizeSource(source);
  const scopeKey = insightsScopeKey({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, source: insightSource, scanLimit });
  const watermarkBefore = await safeSessionWatermark();
  if (watermarkBefore) {
    const cached = await readPersistedInsights(scopeKey, watermarkBefore);
    if (cached) {
      return {
        ...cached,
        cached: true,
        durationMs: Date.now() - started,
      };
    }
  }

  const sessions = await listSessions({
    codexHome,
    claudeHome,
    traeHome,
    traeAppHome,
    traeRecordingsDir,
    limit: scanLimit,
    cwd: "",
    includeArchived: true,
    source: insightSource,
    completeOnly: false,
  });

  const sessionWatermark = sessions.reduce((max, session) => Math.max(max, sessionMtimeMs(session)), 0);
  const watermark = Math.max(await safeSessionWatermark(), sessionWatermark, watermarkBefore);
  if (watermark) {
    const cached = await readPersistedInsights(scopeKey, watermark);
    if (cached) {
      return {
        ...cached,
        cached: true,
        durationMs: Date.now() - started,
      };
    }
  }

  const result = await mineInsightsFromSessions(sessions.slice(0, scanLimit), {
    codexHome,
    claudeHome,
    traeHome,
    traeAppHome,
    traeRecordingsDir,
    loadSnapshot,
    scanLimit,
    watermark,
  });
  result.durationMs = Date.now() - started;
  result.cached = false;
  await writePersistedInsights(scopeKey, watermark || Date.now(), scanLimit, result);
  return result;
}

async function mineInsightsFromSessions(sessions, options) {
  const commandMap = new Map();
  const toolMap = new Map();
  const promptMap = new Map();
  const chainMap = new Map();
  const engines = { total: 0, codex: 0, claude: 0, trae: 0 };
  let failedSessions = 0;

  for (const session of sessions) {
    const engine = engineKey(session?.engine);
    const sessionTime = sessionIsoTime(session);
    engines.total += 1;
    engines[engine] += 1;

    let insightData;
    try {
      insightData = await readSessionInsightData(session, options);
    } catch {
      failedSessions += 1;
      continue;
    }
    if (!insightData) {
      continue;
    }

    const prompt = insightData.prompt || "";
    if (prompt) {
      addPromptPattern(promptMap, prompt, engine, sessionTime);
    }

    const toolNames = [];
    for (const tool of insightData.tools || []) {
      const name = displayToolName(tool.name);
      addTool(toolMap, engine, name, sessionTime);
      toolNames.push(name);

      const command = shellCommandFromTool(tool);
      if (command) {
        addCommand(commandMap, command, engine, sessionTime);
      }
    }
    addWorkflowChains(chainMap, toolNames, engine, sessionTime);
  }

  return {
    generatedAt: new Date().toISOString(),
    watermark: options.watermark || 0,
    scanLimit: options.scanLimit,
    scannedSessions: sessions.length,
    failedSessions,
    engines,
    topCommands: topList(commandMap, 30),
    topTools: topToolList(toolMap, 60),
    promptPatterns: topPromptPatterns(promptMap, 24),
    workflowChains: topWorkflowChains(chainMap, 32),
  };
}

async function readSessionInsightData(session, options) {
  const engine = engineKey(session?.engine);
  if ((engine === "codex" || engine === "claude") && session?.filePath) {
    return normalizedInsightData(session);
  }
  return snapshotInsightData(session, options);
}

function normalizedInsightData(session) {
  const engine = engineKey(session?.engine);
  const filePath = String(session?.filePath || "");
  if (!filePath) {
    return null;
  }
  const parsed = parseSessionFile({
    path: filePath,
    engine,
    mtimeMs: sessionMtimeMs(session),
    sizeBytes: Number(session?.size || session?.sizeBytes || 0) || 0,
  });
  const events = Array.isArray(parsed?.events) ? parsed.events : [];
  if (!events.length) {
    return null;
  }
  let prompt = "";
  const tools = [];
  for (const event of events) {
    if (event?.kind === "message" && !prompt) {
      const role = String(event.role || "").toLowerCase();
      const text = stripCodexAppDirectives(String(event.text || "")).trim();
      if (!event.internal && role === "user" && text) {
        prompt = text;
      }
      continue;
    }
    if (event?.kind === "tool_call") {
      tools.push({
        name: String(event.name || "tool_call"),
        args: event.args,
        body: stringifyToolArgs(event.args),
      });
      continue;
    }
    if (event?.kind === "web_search") {
      tools.push({
        name: "WebSearch",
        args: { query: event.query || "" },
        body: String(event.query || ""),
      });
    }
  }
  return { prompt, tools };
}

async function snapshotInsightData(session, options) {
  const ref = sessionRef(session);
  if (!ref || !options.loadSnapshot) {
    return null;
  }
  const snapshot = await options.loadSnapshot(ref, {
    codexHome: options.codexHome,
    claudeHome: options.claudeHome,
    traeHome: options.traeHome,
    traeAppHome: options.traeAppHome,
    traeRecordingsDir: options.traeRecordingsDir,
    includeTools: true,
    includeToolOutput: false,
    redact: false,
  });
  const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];
  return {
    prompt: firstUserPrompt(turns),
    tools: turns.map(toolCallFromTurn).filter(Boolean),
  };
}

function addCommand(map, command, engine, lastUsedAt) {
  const key = command;
  const entry = map.get(key) || baseInsightEntry({ command });
  entry.count += 1;
  entry.engineCounts[engine] += 1;
  entry.lastUsedAt = maxIso(entry.lastUsedAt, lastUsedAt);
  map.set(key, entry);
}

function addTool(map, engine, name, lastUsedAt) {
  const key = `${engine}\0${name}`;
  const entry = map.get(key) || {
    engine,
    name,
    count: 0,
    lastUsedAt: "",
  };
  entry.count += 1;
  entry.lastUsedAt = maxIso(entry.lastUsedAt, lastUsedAt);
  map.set(key, entry);
}

function addPromptPattern(map, prompt, engine, lastUsedAt) {
  const prefix = normalizedPromptPrefix(prompt);
  if (!prefix || prefix.length < 4) {
    return;
  }
  const entry = map.get(prefix) || {
    id: stableId(prefix),
    prefix,
    count: 0,
    engineCounts: zeroEngineCounts(),
    lastUsedAt: "",
    example: "",
    examples: [],
    triggerPhrases: [],
  };
  entry.count += 1;
  entry.engineCounts[engine] += 1;
  entry.lastUsedAt = maxIso(entry.lastUsedAt, lastUsedAt);
  const example = compactPromptExample(prompt);
  if (!entry.example) {
    entry.example = example;
  }
  if (example && entry.examples.length < 3 && !entry.examples.includes(example)) {
    entry.examples.push(example);
  }
  entry.triggerPhrases = Array.from(new Set([entry.prefix, ...entry.examples.map((item) => normalizedPromptPrefix(item)).filter(Boolean)])).slice(0, 4);
  map.set(prefix, entry);
}

function addWorkflowChains(map, toolNames, engine, lastUsedAt) {
  const names = (toolNames || []).filter(Boolean);
  for (const length of [2, 3]) {
    if (names.length < length) {
      continue;
    }
    for (let index = 0; index <= names.length - length; index += 1) {
      const chain = names.slice(index, index + length);
      const key = chain.join("\0");
      const entry = map.get(key) || {
        id: stableId(key),
        chain,
        label: chain.join(" → "),
        length,
        count: 0,
        engineCounts: zeroEngineCounts(),
        lastUsedAt: "",
      };
      entry.count += 1;
      entry.engineCounts[engine] += 1;
      entry.lastUsedAt = maxIso(entry.lastUsedAt, lastUsedAt);
      map.set(key, entry);
    }
  }
}

function topList(map, limit) {
  return Array.from(map.values())
    .sort(sortInsightEntries)
    .slice(0, limit)
    .map((entry) => ({
      command: entry.command,
      count: entry.count,
      engineCounts: entry.engineCounts,
      lastUsedAt: entry.lastUsedAt,
    }));
}

function topToolList(map, limit) {
  return Array.from(map.values())
    .sort((a, b) => (b.count - a.count) || compareIsoDesc(a.lastUsedAt, b.lastUsedAt) || a.name.localeCompare(b.name, "zh-CN") || a.engine.localeCompare(b.engine))
    .slice(0, limit)
    .map((entry) => ({
      engine: entry.engine,
      name: entry.name,
      count: entry.count,
      lastUsedAt: entry.lastUsedAt,
    }));
}

function topPromptPatterns(map, limit) {
  return Array.from(map.values())
    .filter((entry) => entry.count >= 3)
    .sort(sortInsightEntries)
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      prefix: entry.prefix,
      count: entry.count,
      engineCounts: entry.engineCounts,
      lastUsedAt: entry.lastUsedAt,
      example: entry.example,
      examples: entry.examples,
      triggerPhrases: entry.triggerPhrases,
    }));
}

function topWorkflowChains(map, limit) {
  return Array.from(map.values())
    .sort((a, b) => (b.count - a.count) || (b.length - a.length) || compareIsoDesc(a.lastUsedAt, b.lastUsedAt) || a.label.localeCompare(b.label, "zh-CN"))
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      chain: entry.chain,
      label: entry.label,
      length: entry.length,
      count: entry.count,
      engineCounts: entry.engineCounts,
      lastUsedAt: entry.lastUsedAt,
    }));
}

function sortInsightEntries(a, b) {
  return (b.count - a.count) || compareIsoDesc(a.lastUsedAt, b.lastUsedAt) || String(a.command || a.prefix || "").localeCompare(String(b.command || b.prefix || ""), "zh-CN");
}

function toolCallFromTurn(turn) {
  if (!turn || turn.kind !== "tool") {
    return null;
  }
  const text = String(turn.text || "").trim();
  if (/^Tool call:/i.test(text)) {
    const newline = text.indexOf("\n");
    const rawName = text.slice("Tool call:".length, newline >= 0 ? newline : undefined).trim();
    return {
      name: rawName || turn.name || "tool",
      body: newline >= 0 ? text.slice(newline + 1).trim() : "",
      text,
    };
  }
  if (/^Web search:/i.test(text)) {
    return {
      name: "WebSearch",
      body: text.replace(/^Web search:\s*/i, "").trim(),
      text,
    };
  }
  const rawName = String(turn.name || "").trim();
  if (!rawName || OUTPUT_TOOL_NAMES.has(rawName.toLowerCase())) {
    return null;
  }
  return { name: rawName, body: text, text };
}

function shellCommandFromTool(tool) {
  if (!isShellToolName(tool.name)) {
    return "";
  }
  const raw = extractCommandText(Object.prototype.hasOwnProperty.call(tool, "args") ? tool.args : tool.body);
  return normalizeShellCommand(raw);
}

function isShellToolName(name) {
  const raw = String(name || "").trim().toLowerCase();
  if (SHELL_TOOL_NAMES.has(raw)) {
    return true;
  }
  return raw.endsWith(".exec_command") || raw.includes("bash") || raw.includes("shell");
}

function extractCommandText(body) {
  if (body && typeof body === "object") {
    return findCommandValue(body);
  }
  const text = String(body || "").trim();
  if (!text) {
    return "";
  }
  const parsed = parseMaybeJson(text);
  const command = findCommandValue(parsed);
  if (command) {
    return command;
  }
  const regexMatch = text.match(/["']?(?:cmd|command|shellCommand|shell_command)["']?\s*[:=]\s*["']([^"'\n]+)["']/i);
  if (regexMatch) {
    return regexMatch[1];
  }
  return text;
}

function stringifyToolArgs(args) {
  if (typeof args === "string") {
    return args;
  }
  try {
    return JSON.stringify(args ?? "");
  } catch {
    return "";
  }
}

function parseMaybeJson(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  for (const candidate of [text, stripCodeFence(text)]) {
    if (!candidate) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") {
        return parseMaybeJson(parsed) || parsed;
      }
      return parsed;
    } catch {
      // Try the next representation.
    }
  }
  return null;
}

function stripCodeFence(value) {
  const text = String(value || "").trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : text;
}

function findCommandValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  for (const key of ["cmd", "command", "shellCommand", "shell_command", "input", "script"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key];
    }
  }
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === "object") {
      const nested = findCommandValue(value[key]);
      if (nested) {
        return nested;
      }
    }
  }
  return "";
}

function normalizeShellCommand(value) {
  let command = String(value || "")
    .replace(/\\\r?\n/g, " ")
    .replace(/\r/g, "\n")
    .trim();
  if (!command) {
    return "";
  }
  const segment = firstUsefulShellSegment(command);
  if (!segment) {
    return "";
  }
  let words = shellWords(segment);
  words = stripShellWrappers(words);
  if (!words.length) {
    return "";
  }
  const executable = safeCommandToken(words[0]);
  if (!executable || executable === "." || executable === "..") {
    return "";
  }
  const sub = firstCommandSubtoken(executable, words.slice(1));
  if (executable === "docker" && sub === "compose") {
    const third = firstCommandSubtoken(executable, words.slice(2));
    return third ? `docker compose ${third}` : "docker compose";
  }
  if ((executable === "npm" || executable === "pnpm" || executable === "yarn" || executable === "bun") && sub === "run") {
    const script = firstCommandSubtoken(executable, words.slice(2));
    return script ? `${executable} ${script}` : `${executable} run`;
  }
  return sub ? `${executable} ${sub}` : executable;
}

function firstUsefulShellSegment(command) {
  const parts = command.split(/(?:&&|\|\||;|\n)/).map((item) => item.trim()).filter(Boolean);
  for (const part of parts.length ? parts : [command]) {
    const words = shellWords(part);
    const stripped = stripShellWrappers(words);
    const first = commandBasename(stripped[0] || "");
    if (!first || first === "cd" || first === "export" || first === "alias") {
      continue;
    }
    return part;
  }
  return parts[0] || command;
}

function stripShellWrappers(words) {
  let out = Array.isArray(words) ? words.slice() : [];
  while (out.length) {
    const first = commandBasename(out[0]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(out[0])) {
      out.shift();
      continue;
    }
    if (first === "sudo" || first === "command" || first === "time") {
      out.shift();
      continue;
    }
    if (first === "env") {
      out.shift();
      while (out.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(out[0])) {
        out.shift();
      }
      continue;
    }
    break;
  }
  return out;
}

function firstCommandSubtoken(executable, words) {
  const keepPathArgs = new Set(["go", "cargo", "make", "just", "git", "docker", "kubectl", "pnpm", "npm", "yarn", "bun"]);
  for (let index = 0; index < words.length; index += 1) {
    const word = String(words[index] || "").trim();
    if (!word) {
      continue;
    }
    if (COMMAND_OPTION_VALUE_FLAGS.has(word)) {
      index += 1;
      continue;
    }
    if (word.startsWith("-")) {
      continue;
    }
    if (!keepPathArgs.has(executable) && looksLikePath(word)) {
      continue;
    }
    const clean = safeCommandToken(word);
    if (!clean || clean === "." || clean === ".." || clean.startsWith("-")) {
      continue;
    }
    return clean;
  }
  return "";
}

function shellWords(value) {
  const text = String(value || "");
  const words = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function commandBasename(value) {
  const clean = String(value || "").replace(/^['"]|['"]$/g, "").trim();
  if (!clean) {
    return "";
  }
  const parts = clean.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || clean;
}

function safeCommandToken(value) {
  const clean = commandBasename(value);
  return /^[A-Za-z0-9][A-Za-z0-9._:+@-]{0,80}$/.test(clean) ? clean : "";
}

function looksLikePath(value) {
  const text = String(value || "");
  return text.includes("/") || text.includes("\\") || text.startsWith(".") || /\.[cm]?[jt]sx?$|\.m?js$|\.sh$|\.py$|\.go$|\.rs$|\.json$/i.test(text);
}

function displayToolName(name) {
  const raw = String(name || "tool").trim();
  const lower = raw.toLowerCase();
  if (lower === "web_search" || lower === "websearch") return "WebSearch";
  if (isShellToolName(raw)) return "Bash";
  if (lower === "multi_edit" || lower === "multiedit") return "MultiEdit";
  if (lower === "read_file") return "Read";
  if (lower === "edit_file") return "Edit";
  if (lower === "apply_patch") return "apply_patch";
  return raw.replace(/^functions\./, "");
}

function firstUserPrompt(turns) {
  const turn = (Array.isArray(turns) ? turns : []).find((item) => {
    const role = String(item?.role || "").toLowerCase();
    return item?.kind !== "tool" && role === "user" && String(item?.text || "").trim();
  });
  return turn ? String(turn.text || "").trim() : "";
}

function normalizedPromptPrefix(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[~.]?\/[\w./-]+/g, " ")
    .replace(/[a-z]:\\[^\s]+/gi, " ")
    .replace(/\b[0-9a-f]{8,}\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[_`"'“”‘’()[\]{}<>:;,.!?，。！？、；：|+=*&^%$#@~\\/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = promptTokens(text).slice(0, 8);
  return tokens.join(" ").trim();
}

function promptTokens(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  if (PROMPT_SEGMENTER) {
    return Array.from(PROMPT_SEGMENTER.segment(text))
      .filter((segment) => segment.isWordLike && String(segment.segment || "").trim())
      .map((segment) => String(segment.segment).trim())
      .filter((word) => word.length > 1 || /[\p{Script=Han}]/u.test(word));
  }
  return text.split(/\s+/).filter(Boolean);
}

function compactPromptExample(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, 160).join("");
}

function baseInsightEntry(fields) {
  return {
    ...fields,
    count: 0,
    engineCounts: zeroEngineCounts(),
    lastUsedAt: "",
  };
}

function zeroEngineCounts() {
  return { codex: 0, claude: 0, trae: 0 };
}

function maxIso(current, next) {
  const currentTime = new Date(current || 0).getTime();
  const nextTime = new Date(next || 0).getTime();
  if (!Number.isFinite(nextTime)) {
    return current || "";
  }
  if (!Number.isFinite(currentTime) || nextTime >= currentTime) {
    return new Date(nextTime).toISOString();
  }
  return current || "";
}

function compareIsoDesc(a, b) {
  return (new Date(b || 0).getTime() || 0) - (new Date(a || 0).getTime() || 0);
}

function sessionRef(session) {
  const engine = engineKey(session?.engine);
  return String(session?.ref || `${engine}:${session?.id || ""}`).trim();
}

function sessionIsoTime(session) {
  const time = sessionMtimeMs(session);
  return time ? new Date(time).toISOString() : "";
}

function sessionMtimeMs(session) {
  for (const value of [session?.mtimeMs, session?.mtime, session?.createdAt, session?.startedAt]) {
    const time = typeof value === "number" ? value : new Date(value || 0).getTime();
    if (Number.isFinite(time) && time > 0) {
      return time;
    }
  }
  return 0;
}

function engineKey(value) {
  const key = String(value || "").toLowerCase();
  return ENGINE_KEYS.includes(key) ? key : "codex";
}

function normalizeSource(value) {
  const source = String(value || "all").toLowerCase();
  return source === "codex" || source === "claude" || source === "trae" ? source : "all";
}

function clampPositive(value, fallback, max) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.round(number)));
}

async function safeSessionWatermark() {
  try {
    return Number(await sessionListCacheWatermark()) || 0;
  } catch {
    return 0;
  }
}

function insightsScopeKey(options) {
  return createHash("sha256").update(JSON.stringify({
    v: 1,
    source: options.source,
    scanLimit: options.scanLimit,
    codexHome: normalizePathForScope(options.codexHome),
    extraCodexHomes: String(process.env.AGENT_SNAPSHOT_EXTRA_CODEX_HOMES || ""),
    claudeHome: normalizePathForScope(options.claudeHome),
    traeHome: normalizePathForScope(options.traeHome),
    traeAppHome: normalizePathForScope(options.traeAppHome),
    traeRecordingsDir: normalizePathForScope(options.traeRecordingsDir),
  })).digest("hex");
}

function normalizePathForScope(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text === "~") {
    return os.homedir();
  }
  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }
  return path.resolve(text).replace(/[\\/]+$/, "");
}

function cacheKey(scopeKey, watermark) {
  return `${scopeKey}:${Math.round(Number(watermark || 0))}`;
}

async function readPersistedInsights(scopeKey, watermark) {
  if (!watermark) {
    return null;
  }
  try {
    const db = await getDb();
    const row = db.prepare(`SELECT result_json FROM ${INSIGHTS_TABLE} WHERE cache_key = ?`).get(cacheKey(scopeKey, watermark));
    if (!row) {
      return null;
    }
    const result = JSON.parse(row.result_json || "{}");
    return materializeInsightsResult(result);
  } catch {
    return null;
  }
}

async function writePersistedInsights(scopeKey, watermark, scanLimit, result) {
  try {
    const db = await getDb();
    const key = cacheKey(scopeKey, watermark);
    db.prepare(`INSERT INTO ${INSIGHTS_TABLE}
      (cache_key, scope_key, watermark, scan_limit, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        scan_limit=excluded.scan_limit,
        result_json=excluded.result_json,
        created_at=excluded.created_at`).run(
      key,
      scopeKey,
      Number(watermark || 0),
      Number(scanLimit || 0),
      JSON.stringify(result),
      Date.now(),
    );
    const stale = db.prepare(`SELECT cache_key FROM ${INSIGHTS_TABLE} WHERE scope_key = ? ORDER BY created_at DESC LIMIT -1 OFFSET 8`).all(scopeKey);
    if (stale.length) {
      const del = db.prepare(`DELETE FROM ${INSIGHTS_TABLE} WHERE cache_key = ?`);
      for (const row of stale) {
        del.run(row.cache_key);
      }
    }
  } catch {
    // Persistence is only an optimization.
  }
}

function materializeInsightsResult(result) {
  return {
    generatedAt: String(result?.generatedAt || new Date().toISOString()),
    watermark: Number(result?.watermark || 0),
    scanLimit: Number(result?.scanLimit || DEFAULT_SCAN_LIMIT),
    scannedSessions: Number(result?.scannedSessions || 0),
    failedSessions: Number(result?.failedSessions || 0),
    engines: {
      total: Number(result?.engines?.total || 0),
      codex: Number(result?.engines?.codex || 0),
      claude: Number(result?.engines?.claude || 0),
      trae: Number(result?.engines?.trae || 0),
    },
    topCommands: Array.isArray(result?.topCommands) ? result.topCommands : [],
    topTools: Array.isArray(result?.topTools) ? result.topTools : [],
    promptPatterns: Array.isArray(result?.promptPatterns) ? result.promptPatterns : [],
    workflowChains: Array.isArray(result?.workflowChains) ? result.workflowChains : [],
  };
}

function stableId(value) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}
