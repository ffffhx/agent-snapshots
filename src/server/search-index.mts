// @ts-nocheck

// Persistent keyword-search index backed by the built-in node:sqlite database.
//
// The expensive part of local search is reading and parsing every session file
// from disk on each query (~seconds for hundreds of sessions). This module
// caches each session's extracted searchable document (fields + segments +
// summary) in SQLite, keyed by the session mtime, so queries reuse the exact
// same `matchSearchDocument` scoring/snippet logic without touching the disk.
//
// CJK-friendly by design: candidates are selected with indexed `LIKE` over a
// folded text column (substring match works for any language), avoiding the
// FTS5 tokenizer pitfalls for Chinese/Japanese/Korean.

import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import {
  listSessions,
  readSearchDocument,
  matchSearchDocument,
  foldSearchText,
  searchTerms,
  extractSessionTokenUsage,
} from "../sources/local-history.mjs";

const SEARCH_DOC_LIMIT = 24;

let dbPromise = null;
let syncing = false;

function indexPath() {
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "codex-snapshots", "search-index.v1.db");
}

async function getDb() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = (async () => {
    const dbFile = indexPath();
    await mkdir(path.dirname(dbFile), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbFile);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(`CREATE TABLE IF NOT EXISTS docs (
      ref TEXT PRIMARY KEY,
      engine TEXT,
      source TEXT,
      title TEXT,
      cwd TEXT,
      display_cwd TEXT,
      mtime TEXT,
      fold TEXT,
      fields_json TEXT,
      segments_json TEXT,
      summary_json TEXT,
      tokens_total INTEGER DEFAULT 0,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      model TEXT DEFAULT '',
      updated_at INTEGER DEFAULT 0
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS docs_source ON docs(source)");
    db.exec("CREATE INDEX IF NOT EXISTS docs_mtime ON docs(mtime)");
    return db;
  })();
  return dbPromise;
}

function engineKey(engine) {
  return engine === "claude" || engine === "trae" ? engine : "codex";
}

function refOf(summary) {
  return summary.ref || `${summary.engine || "codex"}:${summary.id}`;
}

function likeEscape(value) {
  return String(value).replace(/[\\%_]/g, (char) => "\\" + char);
}

export async function indexRowCount() {
  const db = await getDb();
  const row = db.prepare("SELECT COUNT(*) AS c FROM docs").get();
  return Number(row?.c || 0);
}

// Incrementally bring the index up to date with the on-disk sessions. Reads at
// most `updateLimit` changed/new sessions per call so it can run in the
// background without blocking; the rest are reported as `pending`.
export async function syncSearchIndex({
  codexHome,
  claudeHome,
  traeHome,
  traeAppHome,
  traeRecordingsDir,
  source = "all",
  cwd = "",
  includeArchived = true,
  completeOnly = true,
  scanLimit = 1200,
  updateLimit = 60,
  includeTools = true,
  includeToolOutput = false,
  withTokens = true,
}) {
  const db = await getDb();
  const homes = { codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir };
  const sessions = await listSessions({ ...homes, limit: scanLimit, cwd, includeArchived, source, completeOnly });
  const getStmt = db.prepare("SELECT mtime FROM docs WHERE ref = ?");
  const upsert = db.prepare(`INSERT INTO docs
    (ref, engine, source, title, cwd, display_cwd, mtime, fold, fields_json, segments_json, summary_json, tokens_total, tokens_input, tokens_output, model, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ref) DO UPDATE SET
      engine=excluded.engine, source=excluded.source, title=excluded.title, cwd=excluded.cwd,
      display_cwd=excluded.display_cwd, mtime=excluded.mtime, fold=excluded.fold,
      fields_json=excluded.fields_json, segments_json=excluded.segments_json, summary_json=excluded.summary_json,
      tokens_total=excluded.tokens_total, tokens_input=excluded.tokens_input, tokens_output=excluded.tokens_output,
      model=excluded.model, updated_at=excluded.updated_at`);

  let indexed = 0;
  let updated = 0;
  let failed = 0;
  let pending = 0;
  for (const summary of sessions) {
    const ref = refOf(summary);
    const existing = getStmt.get(ref);
    const mtime = summary.mtime || "";
    if (existing && existing.mtime === mtime) {
      indexed += 1;
      continue;
    }
    if (updated >= updateLimit) {
      pending += 1;
      continue;
    }
    try {
      const doc = await readSearchDocument(summary, { ...homes, includeTools, includeToolOutput });
      const fold = foldSearchText([doc.fields.join("\n"), ...doc.segments.map((segment) => segment.text)].join("\n"));
      let tokens = null;
      if (withTokens) {
        tokens = await extractSessionTokenUsage(summary);
      }
      upsert.run(
        ref,
        summary.engine || "codex",
        engineKey(summary.engine),
        summary.title || "",
        summary.cwd || "",
        summary.displayCwd || summary.cwd || "",
        mtime,
        fold,
        JSON.stringify(doc.fields),
        JSON.stringify(doc.segments),
        JSON.stringify(summary),
        tokens?.total || 0,
        tokens?.input || 0,
        tokens?.output || 0,
        tokens?.model || "",
        Date.now(),
      );
      updated += 1;
      indexed += 1;
    } catch {
      failed += 1;
    }
  }
  return { scanned: sessions.length, indexed, updated, pending, failed, total: await indexRowCount() };
}

// Fire-and-forget incremental sync, guarded so overlapping searches don't stack
// multiple full passes. Errors are swallowed — the live fallback covers gaps.
export function syncSearchIndexInBackground(options) {
  if (syncing) {
    return;
  }
  syncing = true;
  Promise.resolve()
    .then(() => syncSearchIndex(options))
    .catch(() => {})
    .finally(() => {
      syncing = false;
    });
}

export async function searchIndexed({ query, source = "all", cwd = "", limit = SEARCH_DOC_LIMIT }) {
  const db = await getDb();
  const cleanQuery = String(query || "").trim();
  const normalizedQuery = foldSearchText(cleanQuery);
  const terms = searchTerms(cleanQuery);
  const total = await indexRowCount();
  if (!normalizedQuery || !terms.length) {
    return { query: cleanQuery, terms: [], scanned: total, matched: 0, failed: 0, results: [], indexed: total, viaIndex: true };
  }

  const params = [];
  let where = "1=1";
  if (source && source !== "all") {
    where += " AND source = ?";
    params.push(engineKey(source));
  }
  if (cwd) {
    where += " AND (cwd = ? OR display_cwd = ?)";
    params.push(cwd, cwd);
  }
  const conditions = [];
  conditions.push("fold LIKE ? ESCAPE '\\'");
  params.push("%" + likeEscape(normalizedQuery) + "%");
  if (terms.length) {
    conditions.push("(" + terms.map(() => "fold LIKE ? ESCAPE '\\'").join(" AND ") + ")");
    for (const term of terms) {
      params.push("%" + likeEscape(term) + "%");
    }
  }
  where += " AND (" + conditions.join(" OR ") + ")";

  const rows = db.prepare(`SELECT fields_json, segments_json, summary_json FROM docs WHERE ${where}`).all(...params);
  const results = [];
  for (const row of rows) {
    try {
      const document = {
        summary: JSON.parse(row.summary_json),
        fields: JSON.parse(row.fields_json),
        segments: JSON.parse(row.segments_json),
      };
      const match = matchSearchDocument(document, cleanQuery, normalizedQuery, terms);
      if (match) {
        results.push(match);
      }
    } catch {
      // Skip corrupt rows; a re-sync will refresh them.
    }
  }
  results.sort((a, b) => {
    const score = b.score - a.score;
    if (score) {
      return score;
    }
    return new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime();
  });
  return {
    query: cleanQuery,
    terms,
    scanned: total,
    matched: results.length,
    failed: 0,
    results: results.slice(0, limit),
    indexed: total,
    viaIndex: true,
  };
}

// Aggregate token/cost stats computed straight from the index (no disk reads).
export async function searchIndexStats({ pricePerMTokIn = 0, pricePerMTokOut = 0 } = {}) {
  const db = await getDb();
  const total = await indexRowCount();
  const rows = db.prepare(`SELECT source, display_cwd, cwd, model, tokens_total, tokens_input, tokens_output FROM docs`).all();
  const byEngine = new Map();
  const byProject = new Map();
  let sumTotal = 0;
  let sumInput = 0;
  let sumOutput = 0;
  let sessionsWithTokens = 0;
  for (const row of rows) {
    const t = Number(row.tokens_total || 0);
    const inTok = Number(row.tokens_input || 0);
    const outTok = Number(row.tokens_output || 0);
    if (t > 0) {
      sessionsWithTokens += 1;
    }
    sumTotal += t;
    sumInput += inTok;
    sumOutput += outTok;
    const engine = row.source || "codex";
    const eng = byEngine.get(engine) || { key: engine, total: 0, input: 0, output: 0, sessions: 0 };
    eng.total += t;
    eng.input += inTok;
    eng.output += outTok;
    eng.sessions += 1;
    byEngine.set(engine, eng);
    const projectPath = String(row.display_cwd || row.cwd || "").trim();
    const name = projectPath ? (projectPath.split("/").filter(Boolean).pop() || projectPath) : "(无项目)";
    const proj = byProject.get(name) || { name, total: 0, sessions: 0 };
    proj.total += t;
    proj.sessions += 1;
    byProject.set(name, proj);
  }
  const estimatedCost = (sumInput / 1_000_000) * pricePerMTokIn + (sumOutput / 1_000_000) * pricePerMTokOut;
  return {
    indexedSessions: total,
    sessionsWithTokens,
    totalTokens: sumTotal,
    inputTokens: sumInput,
    outputTokens: sumOutput,
    estimatedCost,
    byEngine: Array.from(byEngine.values()).sort((a, b) => b.total - a.total),
    byProject: Array.from(byProject.values()).sort((a, b) => b.total - a.total).slice(0, 12),
  };
}
