// @ts-nocheck
//
// Thin adapter over agent-session-core (ASC).
//
// This is the PRODUCTION parser: `src/sources/index.mts` re-exports these three
// functions. codex/claude sessions are parsed + projected by ASC (which we feed
// our own privacy redaction, markdown renderer, and risk detector), and ASC's
// snapshot semantics are the source of truth. The legacy `local-history` parser
// still owns what ASC has no equivalent for: trae, Claude history-only sessions
// (no transcript file), and searchSessions (document indexing/scoring).
//
// Contract: the three exported functions keep the exact same signatures and
// output shapes as `local-history.mjs`, so the CLI/server/site are unchanged.

import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { discoverSessionFiles, parseSessionFile, toSnapshot } from "agent-session-core";
import { detectRisks, redactText } from "../core/privacy.js";
import { renderMarkdownHtml } from "../renderers/markdown.mjs";
import { stripAppDirectives as stripCodexAppDirectives } from "../shared/sanitize.js";
import {
  listSessions as legacyListSessions,
  loadSnapshot as legacyLoadSnapshot,
  searchSessions as legacySearchSessions,
} from "./local-history.mjs";

const ASC_ENGINES = new Set(["codex", "claude"]);
const ENGINE_LABELS = { codex: "Codex", claude: "Claude Code" };

// searchSessions has no ASC equivalent (ASC does not index/score documents); it
// scans files independently and is shape-decoupled from snapshots, so it is the
// lowest-risk thing to keep verbatim on the legacy path.
export const searchSessions = legacySearchSessions;

// ---------------------------------------------------------------------------
// Discovery / roots
// ---------------------------------------------------------------------------

// Mirror the legacy scan scope: codex sessions + archived_sessions, and both of
// Claude's roots (projects + sessions). ASC's defaultRoots() omits codex archive
// and ~/.claude/sessions, so we pass explicit roots derived from the caller's
// (possibly custom) home dirs.
function ascRoots(engine, codexHome, claudeHome) {
  if (engine === "codex") {
    return { codex: [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")] };
  }
  return { claude: [path.join(claudeHome, "projects"), path.join(claudeHome, "sessions")] };
}

function discoverFor(engine, codexHome, claudeHome) {
  return discoverSessionFiles({ roots: ascRoots(engine, codexHome, claudeHome) });
}

// Replicates local-history.mts sessionIdFromPath so we can match a ref to a
// discovered file by filename before paying for a full parse.
function sessionIdFromPath(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? match[1] : base.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "");
}

function projectKindForCodexCwd(cwd) {
  if (!cwd) {
    return "none";
  }
  const parts = String(cwd).trim().replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  const codexIndex = parts.findIndex((part, index) => part === "Codex" && parts[index - 1] === "Documents");
  if (codexIndex < 0 || codexIndex + 3 !== parts.length) {
    return "project";
  }
  const isConversation = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(parts[codexIndex + 1]) && Boolean(parts[codexIndex + 2]);
  return isConversation ? "conversation" : "project";
}

function refEngine(ref) {
  if (ref.startsWith("claude:")) return "claude";
  if (ref.startsWith("trae:")) return "trae";
  if (ref.startsWith("codex:")) return "codex";
  return "codex";
}

// ---------------------------------------------------------------------------
// Directive stripping
// ---------------------------------------------------------------------------

// ASC keeps the raw message text (it does not know about Codex/Claude app
// directives). The legacy parser strips them *before* deciding whether a message
// is an empty/internal turn and before risk-detecting / rendering. We replicate
// that by stripping each message event's text in place, so ASC's toSnapshot then
// (a) drops messages that become empty, matching the legacy turn set, and
// (b) runs detectRisks/redact/renderHtml on the same stripped text the legacy
// path used.
function stripSessionDirectives(session) {
  for (const ev of session.events) {
    if (ev.kind === "message" && typeof ev.text === "string") {
      ev.text = stripCodexAppDirectives(ev.text);
    }
  }
  return session;
}

// ---------------------------------------------------------------------------
// loadSnapshot
// ---------------------------------------------------------------------------

export async function loadSnapshot(ref, opts) {
  const engine = refEngine(ref);
  if (!ASC_ENGINES.has(engine)) {
    return legacyLoadSnapshot(ref, opts); // trae stays on legacy
  }
  const { codexHome, claudeHome, includeTools, includeToolOutput, redact } = opts;
  const bareRef = ref.replace(/^(codex|claude):/, "");
  const file = await resolveAscFile(engine, bareRef, codexHome, claudeHome);
  if (!file) {
    // Codex: not found. Claude: most commonly a history-only session that lives
    // in ~/.claude/history.jsonl with no transcript file. Either way the legacy
    // resolver owns these (history-only snapshot, descriptive errors).
    return legacyLoadSnapshot(ref, opts);
  }
  const session = parseSessionFile(file);
  if (!session) {
    return legacyLoadSnapshot(ref, opts);
  }
  return ascSnapshot(session, { includeTools, includeToolOutput, redact });
}

async function resolveAscFile(engine, bareRef, codexHome, claudeHome) {
  const home = engine === "codex" ? codexHome : claudeHome;

  // Direct .jsonl path: enforce the same realpath-inside-home guard the legacy
  // resolver does, so a planted symlink cannot escape the home dir.
  if (bareRef.endsWith(".jsonl")) {
    const resolved = path.resolve(bareRef);
    const real = await assertRealPathInsideHome(resolved, home);
    if (!real) {
      return null;
    }
    const info = await stat(real).catch(() => null);
    if (!info) {
      return null;
    }
    return { path: real, engine, mtimeMs: info.mtimeMs, sizeBytes: info.size };
  }

  const files = discoverFor(engine, codexHome, claudeHome);

  // Fast path: filename-derived id matches.
  const byName = files.find((f) => sessionIdFromPath(f.path) === bareRef);
  if (byName) {
    return byName;
  }

  // Slow path: parse and match on the real session id (handles ids that only
  // live inside the file, and prefix matches), mirroring the legacy resolver.
  for (const f of files) {
    const session = parseSessionFile(f);
    if (session && (session.id === bareRef || session.id.startsWith(bareRef))) {
      return f;
    }
  }
  return null;
}

// A discovered file is already under a root by construction, but a direct
// path ref could point at a symlink that escapes the home dir; resolve both
// real paths and re-check containment.
async function assertRealPathInsideHome(filePath, home) {
  let realFile;
  try {
    realFile = await realpath(filePath);
  } catch {
    return null;
  }
  let realHome;
  try {
    realHome = await realpath(path.resolve(home));
  } catch {
    realHome = path.resolve(home);
  }
  const rel = path.relative(realHome, realFile);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return realFile;
}

function ascSnapshot(session, { includeTools, includeToolOutput, redact }) {
  stripSessionDirectives(session);
  const snapshot = toSnapshot(session, {
    includeTools,
    includeToolOutput,
    redact,
    generatedAt: new Date().toISOString(),
    renderHtml: renderMarkdownHtml,
    redactText,
    detectRisks,
    // Match local-history's addImageRisk: one "image-attachment" risk per image.
    imageRiskFinding: { id: "image-attachment", label: "Image attachment", severity: "medium" },
  });

  // Strip any directive prefix that survived into the title/goal (ASC derives
  // them from raw first-message text; toSnapshot already redacted them).
  if (typeof snapshot.title === "string") {
    snapshot.title = stripCodexAppDirectives(snapshot.title);
  }
  if (typeof snapshot.goalObjective === "string" && snapshot.goalObjective) {
    snapshot.goalObjective = stripCodexAppDirectives(snapshot.goalObjective);
  }

  // Re-attach the downstream-shape fields the legacy snapshot carried via its
  // `...summary` spread but that ASC's Snapshot omits. Most are optional in the
  // consumers; we populate them so the adapter is a drop-in.
  snapshot.includeTools = includeTools;
  snapshot.includeToolOutput = includeToolOutput;
  snapshot.createdAt = session.startedAt || "";
  snapshot.mtime = session.mtimeMs ? new Date(session.mtimeMs).toISOString() : "";

  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
  snapshot.messageCount = turns.filter((t) => t.kind === "message").length;
  snapshot.toolCallCount = turns.filter((t) => t.kind === "tool").length;
  snapshot.riskCount = (snapshot.risks || []).reduce((sum, r) => sum + (r.count || 0), 0);

  if (session.engine === "claude") {
    snapshot.modelProvider = "anthropic";
    snapshot.source = "claude-code";
    snapshot.sourceKind = "transcript";
    snapshot.historyOnly = false;
    // GAP: ASC's NormalizedSession has no subagents. Claude subagent transcripts
    // (loadClaudeSubagents) are not reconstructed here yet — kept empty for now;
    // a later step re-attaches them. Downstream treats this as optional.
    snapshot.subagents = [];
  } else {
    // GAP: NormalizedSession has no model_provider/originator; the legacy summary
    // read these from session_meta. Left empty pending a derivation step.
    snapshot.modelProvider = "";
    snapshot.source = "";
    snapshot.projectKind = projectKindForCodexCwd(session.cwd || "");
  }

  return snapshot;
}

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

export async function listSessions(opts) {
  const {
    codexHome,
    claudeHome,
    limit,
    cwd,
    includeArchived,
    source = "codex",
    completeOnly = false,
  } = opts;

  if (source === "trae") {
    return legacyListSessions(opts);
  }

  if (source === "codex" || source === "claude") {
    const summaries = ascListEngine(source, { codexHome, claudeHome, cwd }, { limit, completeOnly });
    const filtered = applyListFilters(summaries, { completeOnly, limit });
    return filtered;
  }

  if (source === "all") {
    // codex + claude via ASC; trae still via legacy. Merge by mtime desc and
    // dedupe by ref (engine-prefixed id), mirroring the legacy "all" semantics.
    const codex = ascListEngine("codex", { codexHome, claudeHome, cwd }, { limit, completeOnly });
    const claude = ascListEngine("claude", { codexHome, claudeHome, cwd }, { limit, completeOnly });
    let trae = [];
    try {
      trae = await legacyListSessions({ ...opts, source: "trae", completeOnly: false, limit: Infinity });
    } catch {
      trae = [];
    }
    const seen = new Set();
    const merged = [];
    for (const s of [...codex, ...claude, ...trae]) {
      if (s.ref && seen.has(s.ref)) {
        continue;
      }
      if (s.ref) {
        seen.add(s.ref);
      }
      merged.push(s);
    }
    return applyListFilters(merged, { completeOnly, limit });
  }

  // Unknown source: defer to legacy for safety.
  return legacyListSessions(opts);
}

function applyListFilters(summaries, { completeOnly, limit }) {
  let out = summaries
    .slice()
    .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
  if (completeOnly) {
    out = out.filter((s) => isCompleteSessionSummary(s));
  }
  return Number.isFinite(limit) ? out.slice(0, limit) : out;
}

// Same completeness heuristic the legacy parser uses (a session is "complete"
// when it has at least one message). Kept local so the adapter is standalone.
function isCompleteSessionSummary(summary) {
  return Number(summary?.messageCount) > 0;
}

function ascListEngine(engine, { codexHome, claudeHome, cwd }, { limit, completeOnly } = {}) {
  const cwdFilter = cwd ? path.resolve(cwd) : "";
  // Newest-first so we can stop once we have enough: the legacy lister reads
  // only headers, so full-parsing the whole corpus per list call is a big
  // regression. Discovery already carries mtimeMs (a cheap stat).
  const files = discoverFor(engine, codexHome, claudeHome)
    .slice()
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  // Only safe to early-stop when the caller wants a bounded, unfiltered-by-cwd
  // page (the common sidebar load). cwd scope / "all history" parse everything.
  const canEarlyStop = Number.isFinite(limit) && !cwdFilter;
  const summaries = [];
  for (const file of files) {
    const session = parseSessionFile(file);
    if (!session) {
      continue;
    }
    const summary = projectSummary(session, file);
    if (cwdFilter && summary.cwd && !path.resolve(summary.cwd).startsWith(cwdFilter)) {
      continue;
    }
    if (completeOnly && !isCompleteSessionSummary(summary)) {
      continue;
    }
    summaries.push(summary);
    if (canEarlyStop && summaries.length >= limit) {
      break;
    }
  }
  return summaries;
}

// Project an ASC NormalizedSession into the legacy list-summary shape that the
// CLI/server/site consume.
function projectSummary(session, file) {
  const engine = session.engine;
  let messageCount = 0;
  let toolCallCount = 0;
  let riskCount = 0;

  for (const ev of session.events) {
    if (ev.kind === "message") {
      if (ev.internal) {
        continue;
      }
      if (ev.role !== "user" && ev.role !== "assistant") {
        continue;
      }
      const text = stripCodexAppDirectives(ev.text || "");
      const hasImages = Array.isArray(ev.images) && ev.images.length > 0;
      if (text.trim() || hasImages) {
        messageCount += 1;
        riskCount += detectRisks(text).length;
        if (hasImages) {
          riskCount += 1; // legacy counts each image-bearing message as one risk
        }
      }
    } else if (ev.kind === "tool_call" || ev.kind === "tool_result") {
      toolCallCount += 1;
    }
  }

  const cwd = session.cwd || "";
  const filePath = session.filePath || file.path;
  // Redact the list title too (the snapshot title is already redacted), so a
  // path/secret in a first message doesn't leak into the sidebar.
  const title = redactText(stripCodexAppDirectives(session.title || "")) || session.id;

  const summary = {
    id: session.id,
    title,
    cwd,
    filePath,
    size: session.sizeBytes ?? file.sizeBytes,
    mtime: session.mtimeMs ? new Date(session.mtimeMs).toISOString() : new Date(file.mtimeMs).toISOString(),
    createdAt: session.startedAt || "",
    messageCount,
    toolCallCount,
    riskCount,
    engine,
    engineLabel: ENGINE_LABELS[engine] || engine,
    ref: `${engine}:${session.id}`,
    displayCwd: redactText(cwd),
    displayFilePath: redactText(filePath),
  };

  if (engine === "claude") {
    summary.modelProvider = "anthropic";
    summary.source = "claude-code";
    summary.sourceKind = "transcript";
    summary.sourceDetail = "full transcript";
    summary.historyOnly = false;
  } else {
    // GAP: model_provider / originator are not on NormalizedSession.
    summary.modelProvider = "";
    summary.source = "";
    summary.projectKind = projectKindForCodexCwd(cwd);
  }

  return summary;
}
