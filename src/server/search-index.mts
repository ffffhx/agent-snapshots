// @ts-nocheck

// Persistent keyword-search index backed by the built-in node:sqlite database.
//
// The expensive part of local search is reading and parsing every session file
// from disk on each query (~seconds for hundreds of sessions). This module
// caches each session's extracted searchable document (fields + segments +
// summary) in SQLite, keyed by the session mtime, so queries reuse the exact
// same `matchSearchDocument` scoring/snippet logic without touching the disk.
//
// Candidate selection is FTS5 with the `trigram` tokenizer over a folded text
// column: substring MATCH works for any language (including CJK) once a term
// is >= 3 characters, backed by an inverted index instead of a full-table
// scan. Terms shorter than 3 characters (common for Chinese) fall back to the
// indexed-`LIKE` scan over the same column, so short queries keep working.

import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import {
  readSearchDocument,
  matchSearchDocument,
  foldSearchText,
  searchTerms,
  extractSessionTokenUsage,
} from "../sources/local-history.mjs";
import { listSessions } from "../sources/index.mjs";
import { codexHomeKeys, discoverCodexHomes } from "../sources/codex-homes.mjs";

const SEARCH_DOC_LIMIT = 24;

let dbPromise = null;
let syncing = false;
let ftsEnabled = false;

export function defaultSearchIndexPath() {
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "agent-snapshots", "search-index.v2.db");
}

function indexPath() {
  return defaultSearchIndexPath();
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
      cache_key TEXT PRIMARY KEY,
      ref TEXT,
      engine TEXT,
      source TEXT,
      home_key TEXT DEFAULT '',
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
    ftsEnabled = setupFtsIndex(db);
    return db;
  })();
  return dbPromise;
}

// External-content FTS5 table mirroring docs.fold, kept in sync by triggers so
// every code path that writes docs (upsert, delete sweep) is covered. Returns
// false when the bundled SQLite lacks FTS5/trigram, in which case searches use
// the LIKE fallback only.
function setupFtsIndex(db) {
  try {
    const hadFts = Boolean(db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'docs_fts'").get());
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      fold,
      content='docs',
      content_rowid='rowid',
      tokenize='trigram'
    )`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS docs_fts_ai AFTER INSERT ON docs BEGIN
      INSERT INTO docs_fts(rowid, fold) VALUES (new.rowid, new.fold);
    END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS docs_fts_ad AFTER DELETE ON docs BEGIN
      INSERT INTO docs_fts(docs_fts, rowid, fold) VALUES ('delete', old.rowid, old.fold);
    END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS docs_fts_au AFTER UPDATE OF fold ON docs BEGIN
      INSERT INTO docs_fts(docs_fts, rowid, fold) VALUES ('delete', old.rowid, old.fold);
      INSERT INTO docs_fts(rowid, fold) VALUES (new.rowid, new.fold);
    END`);
    // Backfill for databases created before the FTS table. COUNT(*) on an
    // external-content table proxies to `docs` and can't detect an empty
    // index, so a one-time meta flag marks the rebuild instead.
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
    const ready = db.prepare("SELECT value FROM meta WHERE key = 'fts_ready'").get();
    if (!hadFts || !ready || ready.value !== "1") {
      db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
      db.prepare("INSERT INTO meta (key, value) VALUES ('fts_ready', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    }
    return true;
  } catch {
    return false;
  }
}

// FTS5 string syntax: double quotes delimit a phrase; trigram makes a quoted
// phrase of >= 3 characters behave as an indexed substring match.
function ftsPhrase(term) {
  return '"' + String(term).replace(/"/g, '""') + '"';
}

function termLength(term) {
  return Array.from(String(term)).length;
}

function engineKey(engine) {
  return engine === "claude" ? engine : "codex";
}

function refOf(summary) {
  return summary.ref || `${summary.engine || "codex"}:${summary.id}`;
}

function homeKeyOf(summary) {
  return engineKey(summary?.engine) === "codex" ? String(summary?.codexHomeKey || "") : "";
}

function docKeyOf(summary) {
  return [engineKey(summary?.engine), homeKeyOf(summary), refOf(summary)].join("\0");
}

function likeEscape(value) {
  return String(value).replace(/[\\%_]/g, (char) => "\\" + char);
}

export async function indexRowCount() {
  const db = await getDb();
  const row = db.prepare("SELECT COUNT(*) AS c FROM docs").get();
  return Number(row?.c || 0);
}

export async function searchIndexCoversCodexHomes({ codexHome, source = "all" } = {}) {
  if (source && source !== "all" && engineKey(source) !== "codex") {
    return true;
  }
  const db = await getDb();
  const homes = await discoverCodexHomes(codexHome);
  const activeKey = Array.from(codexHomeKeys(homes)).sort().join(",");
  const row = db.prepare("SELECT value FROM meta WHERE key = 'codex_home_keys'").get();
  return String(row?.value || "") === activeKey;
}

// Incrementally bring the index up to date with the on-disk sessions. Reads at
// most `updateLimit` changed/new sessions per call so it can run in the
// background without blocking; the rest are reported as `pending`.
export async function syncSearchIndex({
  codexHome,
  claudeHome,
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
  const homes = { codexHome, claudeHome };
  const sessions = await listSessions({ ...homes, limit: scanLimit, cwd, includeArchived, source, completeOnly });
  const getStmt = db.prepare("SELECT mtime FROM docs WHERE cache_key = ?");
  const upsert = db.prepare(`INSERT INTO docs
    (cache_key, ref, engine, source, home_key, title, cwd, display_cwd, mtime, fold, fields_json, segments_json, summary_json, tokens_total, tokens_input, tokens_output, model, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      ref=excluded.ref, engine=excluded.engine, source=excluded.source, home_key=excluded.home_key, title=excluded.title, cwd=excluded.cwd,
      display_cwd=excluded.display_cwd, mtime=excluded.mtime, fold=excluded.fold,
      fields_json=excluded.fields_json, segments_json=excluded.segments_json, summary_json=excluded.summary_json,
      tokens_total=excluded.tokens_total, tokens_input=excluded.tokens_input, tokens_output=excluded.tokens_output,
      model=excluded.model, updated_at=excluded.updated_at`);

  let indexed = 0;
  let updated = 0;
  let failed = 0;
  let pending = 0;
  // Reads (session files) stay async; writes are buffered and flushed inside
  // short transactions so the initial build doesn't pay per-row commit costs
  // and never holds the write lock across an await.
  const writeBuffer = [];
  const flushWrites = () => {
    if (!writeBuffer.length) {
      return;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of writeBuffer) {
        upsert.run(...row);
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Ignore rollback failures; the transaction is already dead.
      }
      throw error;
    }
    writeBuffer.length = 0;
  };
  for (const summary of sessions) {
    const ref = refOf(summary);
    const cacheKey = docKeyOf(summary);
    const existing = getStmt.get(cacheKey);
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
      writeBuffer.push([
        cacheKey,
        ref,
        summary.engine || "codex",
        engineKey(summary.engine),
        homeKeyOf(summary),
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
      ]);
      if (writeBuffer.length >= 50) {
        flushWrites();
      }
      updated += 1;
      indexed += 1;
    } catch {
      failed += 1;
    }
  }
  flushWrites();
  // When this pass saw the complete, unfiltered session list, evict rows for
  // sessions that no longer exist on disk (the FTS triggers mirror deletes).
  if (source === "all" && !cwd && includeArchived && sessions.length < scanLimit && pending === 0) {
    const liveKeys = new Set(sessions.map((summary) => docKeyOf(summary)));
    const staleKeys = db.prepare("SELECT cache_key FROM docs").all()
      .map((row) => row.cache_key)
      .filter((key) => !liveKeys.has(key));
    if (staleKeys.length) {
      const del = db.prepare("DELETE FROM docs WHERE cache_key = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const key of staleKeys) {
          del.run(key);
        }
        db.exec("COMMIT");
      } catch {
        try {
          db.exec("ROLLBACK");
        } catch {
          // Ignore rollback failures.
        }
      }
    }
  }
  if (source === "all" && !cwd && includeArchived) {
    const codexHomes = await discoverCodexHomes(codexHome);
    db.prepare("INSERT INTO meta (key, value) VALUES ('codex_home_keys', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(Array.from(codexHomeKeys(codexHomes)).sort().join(","));
  }
  return { scanned: sessions.length, indexed, updated, pending, failed, total: await indexRowCount() };
}

// Fire-and-forget incremental sync, guarded so overlapping searches don't stack
// multiple full passes. Errors are swallowed — the live fallback covers gaps.
// A pass re-reads every live session and issues synchronous sqlite writes that
// block the event loop, so rapid search-as-you-type must not restart it each
// keystroke: after a pass completes, further requests are ignored for a cool-off.
const SYNC_COOL_OFF_MS = 30_000;
let lastSyncFinishedAt = 0;

export function syncSearchIndexInBackground(options) {
  if (syncing || Date.now() - lastSyncFinishedAt < SYNC_COOL_OFF_MS) {
    return;
  }
  syncing = true;
  Promise.resolve()
    .then(() => syncSearchIndex(options))
    .catch(() => {})
    .finally(() => {
      syncing = false;
      lastSyncFinishedAt = Date.now();
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

  // Trigram MATCH needs >= 3 characters per phrase; shorter terms (common in
  // Chinese) are constrained with LIKE on top of the FTS candidates, or the
  // whole query falls back to the LIKE scan when no term is long enough.
  const longTerms = ftsEnabled ? terms.filter((term) => termLength(term) >= 3) : [];
  const shortTerms = terms.filter((term) => !longTerms.includes(term));

  const params = [];
  let sql;
  if (longTerms.length) {
    let where = "docs_fts MATCH ?";
    params.push(longTerms.map(ftsPhrase).join(" AND "));
    for (const term of shortTerms) {
      where += " AND d.fold LIKE ? ESCAPE '\\'";
      params.push("%" + likeEscape(term) + "%");
    }
    if (source && source !== "all") {
      where += " AND d.source = ?";
      params.push(engineKey(source));
    }
    if (cwd) {
      where += " AND (d.cwd = ? OR d.display_cwd = ?)";
      params.push(cwd, cwd);
    }
    sql = `SELECT d.fields_json, d.segments_json, d.summary_json FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid WHERE ${where}`;
  } else {
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
    sql = `SELECT fields_json, segments_json, summary_json FROM docs WHERE ${where}`;
  }

  const rows = db.prepare(sql).all(...params);
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
