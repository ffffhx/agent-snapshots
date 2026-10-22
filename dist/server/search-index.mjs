// @ts-nocheck
// Persistent keyword-search index backed by the built-in node:sqlite database.
//
// The expensive part of local search is reading and parsing every session file
// from disk on each query (~seconds for hundreds of sessions). This module
// caches each session's extracted searchable document (fields + segments +
// summary) in SQLite, keyed by the session mtime, so queries reuse the exact
// same `matchSearchDocument` scoring/snippet logic without touching the disk.
//
// Candidate selection uses HanLP terms and code identifiers in FTS5.
// Tokenization runs before short write transactions; no session text leaves the machine.
import path from "node:path";
import os from "node:os";
import { mkdir, stat } from "node:fs/promises";
import { readSearchDocument, matchSearchDocument, foldSearchText, extractSessionTokenUsage, } from "../sources/local-history.mjs";
import { listSessions } from "../sources/index.mjs";
import { codexHomeKeys, discoverCodexHomes } from "../sources/codex-homes.mjs";
import { tokenizeTexts, searchQueryTerms, indexToken, tokenizerVersion } from "./search-tokenizer.mjs";
const SEARCH_DOC_LIMIT = 24;
const dbPromises = new Map();
const ftsEnabledByPath = new Map();
export function defaultSearchIndexPath() {
    const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    return path.join(cacheHome, "agent-snapshots", "search-index.v2.db");
}
function indexPath() {
    return defaultSearchIndexPath();
}
async function getDb() {
    const dbFile = path.resolve(indexPath());
    const existing = dbPromises.get(dbFile);
    if (existing) {
        return existing;
    }
    const dbPromise = (async () => {
        await mkdir(path.dirname(dbFile), { recursive: true });
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(dbFile);
        db.exec("PRAGMA busy_timeout = 5000");
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
        // This table is also used outside the optional FTS setup. Create it first
        // so a transient FTS/locking failure can never leave later syncs querying
        // a table that does not exist.
        db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
        db.exec("BEGIN IMMEDIATE");
        try {
            const columns = new Set(db.prepare("PRAGMA table_info(docs)").all().map((row) => row.name));
            if (!columns.has("lexical"))
                db.exec("ALTER TABLE docs ADD COLUMN lexical TEXT NOT NULL DEFAULT ''");
            if (!columns.has("lexical_version"))
                db.exec("ALTER TABLE docs ADD COLUMN lexical_version TEXT NOT NULL DEFAULT ''");
            db.exec("COMMIT");
        }
        catch (error) {
            db.exec("ROLLBACK");
            db.close();
            throw error;
        }
        ftsEnabledByPath.set(dbFile, setupFtsIndex(db));
        return db;
    })();
    dbPromises.set(dbFile, dbPromise);
    try {
        return await dbPromise;
    }
    catch (error) {
        if (dbPromises.get(dbFile) === dbPromise) {
            dbPromises.delete(dbFile);
            ftsEnabledByPath.delete(dbFile);
        }
        throw error;
    }
}
export async function closeSearchIndexDatabases() {
    const pending = [...dbPromises.values()];
    dbPromises.clear();
    ftsEnabledByPath.clear();
    const settled = await Promise.allSettled(pending);
    for (const result of settled) {
        if (result.status === "fulfilled") {
            try {
                result.value.close();
            }
            catch {
                // Already closed or failed during shutdown.
            }
        }
    }
}
// Triggers cover inserts, updates and deletion. Old substring indexes are
// replaced transactionally; existing documents are retokenized by background sync.
function setupFtsIndex(db) {
    try {
        db.exec("BEGIN IMMEDIATE");
        const old = db.prepare("SELECT sql FROM sqlite_master WHERE name='docs_fts'").get();
        if (old && !old.sql.includes("lexical")) {
            db.exec("DROP TRIGGER IF EXISTS docs_fts_ai; DROP TRIGGER IF EXISTS docs_fts_ad; DROP TRIGGER IF EXISTS docs_fts_au; DROP TABLE docs_fts");
        }
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(lexical, content='docs', content_rowid='rowid', tokenize='ascii');
      CREATE TRIGGER IF NOT EXISTS docs_fts_ai AFTER INSERT ON docs BEGIN
        INSERT INTO docs_fts(rowid,lexical) VALUES(new.rowid,new.lexical);
      END;
      CREATE TRIGGER IF NOT EXISTS docs_fts_ad AFTER DELETE ON docs BEGIN
        INSERT INTO docs_fts(docs_fts,rowid,lexical) VALUES('delete',old.rowid,old.lexical);
      END;
      CREATE TRIGGER IF NOT EXISTS docs_fts_au AFTER UPDATE OF lexical ON docs BEGIN
        INSERT INTO docs_fts(docs_fts,rowid,lexical) VALUES('delete',old.rowid,old.lexical);
        INSERT INTO docs_fts(rowid,lexical) VALUES(new.rowid,new.lexical);
      END;`);
        const ready = db.prepare("SELECT value FROM meta WHERE key='hanlp_fts_ready'").get();
        if (!old || !old.sql.includes("lexical") || !ready || ready.value !== '1') {
            db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
            db.prepare("INSERT OR REPLACE INTO meta VALUES('hanlp_fts_ready','1')").run();
        }
        db.exec("COMMIT");
        return true;
    }
    catch (error) {
        db.exec("ROLLBACK");
        if (!String(error.message).includes("no such module: fts5"))
            throw error;
        db.exec("DROP TRIGGER IF EXISTS docs_fts_ai; DROP TRIGGER IF EXISTS docs_fts_ad; DROP TRIGGER IF EXISTS docs_fts_au");
        db.prepare("DELETE FROM meta WHERE key='hanlp_fts_ready'").run();
        return false;
    }
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
// Persistent fingerprints belong to the file, not the last visible message time.
export async function searchFileState() {
    const db = await getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS search_files_v1 (
    path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, keys_json TEXT NOT NULL
  )`);
    return db;
}
export async function syncSearchFile(candidate, options) {
    const db = await searchFileState();
    const fingerprint = JSON.stringify([candidate.mtimeMs, candidate.size, candidate.codexHomeKey, candidate.codexHomePrimary, tokenizerVersion]);
    const previous = db.prepare("SELECT * FROM search_files_v1 WHERE path = ?").get(candidate.filePath);
    if (previous?.fingerprint === fingerprint && JSON.parse(previous.keys_json).every((key) => db.prepare("SELECT 1 FROM docs WHERE cache_key = ?").get(key)))
        return false;
    const { summarizeSessionCandidate } = await import("../sources/index.mjs");
    const sessions = await summarizeSessionCandidate(candidate, options);
    if (!sessions.length)
        throw new Error("Session is not readable yet");
    const result = await syncSearchIndex({ ...options, sessions, force: true, updateLimit: Infinity });
    if (result.failed || result.pending)
        throw new Error("Session indexing failed");
    const after = await stat(candidate.filePath);
    if (after.mtimeMs !== candidate.mtimeMs || after.size !== candidate.size) {
        throw new Error("Session changed while being read");
    }
    db.prepare(`INSERT INTO search_files_v1 VALUES (?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint, keys_json=excluded.keys_json`)
        .run(candidate.filePath, fingerprint, JSON.stringify(sessions.map(docKeyOf)));
    return true;
}
export async function removeSearchFile(filePath) {
    const db = await searchFileState();
    // Check the stored document path as a session may already have moved to archive.
    const rows = db.prepare("SELECT rowid AS id, summary_json FROM docs").all();
    const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    db.exec("BEGIN IMMEDIATE");
    try {
        for (const row of rows) {
            const storedPath = JSON.parse(row.summary_json).filePath;
            if (storedPath && normalize(storedPath) === normalize(filePath)) {
                db.prepare("DELETE FROM docs WHERE rowid = ?").run(row.id);
            }
        }
        db.prepare("DELETE FROM search_files_v1 WHERE path = ?").run(filePath);
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}
export async function markSearchHomes(options) {
    const db = await getDb();
    const homes = await discoverCodexHomes(options.codexHome);
    db.prepare("INSERT INTO meta (key, value) VALUES ('codex_home_keys', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(Array.from(codexHomeKeys(homes)).sort().join(","));
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
export async function syncSearchIndex({ codexHome, claudeHome, source = "all", cwd = "", includeArchived = true, completeOnly = true, scanLimit = 1200, updateLimit = 60, includeTools = true, includeToolOutput = false, withTokens = true, sessions: suppliedSessions, force = false, }) {
    const db = await getDb();
    const homes = { codexHome, claudeHome };
    const sessions = suppliedSessions ?? await listSessions({ ...homes, limit: scanLimit, cwd, includeArchived, source, completeOnly });
    const getStmt = db.prepare("SELECT mtime, lexical_version FROM docs WHERE cache_key = ?");
    const upsert = db.prepare(`INSERT INTO docs
    (cache_key, ref, engine, source, home_key, title, cwd, display_cwd, mtime, fold, fields_json, segments_json, summary_json, tokens_total, tokens_input, tokens_output, model, updated_at, lexical, lexical_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      ref=excluded.ref, engine=excluded.engine, source=excluded.source, home_key=excluded.home_key, title=excluded.title, cwd=excluded.cwd,
      display_cwd=excluded.display_cwd, mtime=excluded.mtime, fold=excluded.fold,
      fields_json=excluded.fields_json, segments_json=excluded.segments_json, summary_json=excluded.summary_json,
      tokens_total=excluded.tokens_total, tokens_input=excluded.tokens_input, tokens_output=excluded.tokens_output,
      model=excluded.model, updated_at=excluded.updated_at, lexical=excluded.lexical, lexical_version=excluded.lexical_version`);
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
        }
        catch (error) {
            try {
                db.exec("ROLLBACK");
            }
            catch {
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
        if (!force && existing && existing.mtime === mtime && existing.lexical_version === tokenizerVersion) {
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
            const [lexical] = await tokenizeTexts([[doc.fields.join("\n"), ...doc.segments.map((segment) => segment.text)].join("\n")]);
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
                lexical.map(indexToken).join(" "),
                tokenizerVersion,
            ]);
            if (writeBuffer.length >= 50) {
                flushWrites();
            }
            updated += 1;
            indexed += 1;
        }
        catch {
            failed += 1;
        }
    }
    flushWrites();
    // When this pass saw the complete, unfiltered session list, evict rows for
    // sessions that no longer exist on disk (the FTS triggers mirror deletes).
    if (!suppliedSessions && source === "all" && !cwd && includeArchived && sessions.length < scanLimit && pending === 0) {
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
            }
            catch {
                try {
                    db.exec("ROLLBACK");
                }
                catch {
                    // Ignore rollback failures.
                }
            }
        }
    }
    if (!suppliedSessions && source === "all" && !cwd && includeArchived) {
        const codexHomes = await discoverCodexHomes(codexHome);
        db.prepare("INSERT INTO meta (key, value) VALUES ('codex_home_keys', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(Array.from(codexHomeKeys(codexHomes)).sort().join(","));
    }
    return { scanned: sessions.length, indexed, updated, pending, failed, total: await indexRowCount() };
}
export async function searchIndexed({ query, source = "all", cwd = "", limit = SEARCH_DOC_LIMIT }) {
    const db = await getDb();
    const cleanQuery = String(query || "").trim();
    const normalizedQuery = foldSearchText(cleanQuery);
    const terms = (await searchQueryTerms(cleanQuery)).slice(0, 32);
    const total = await indexRowCount();
    const ready = Number(db.prepare("SELECT count(*) AS n FROM docs WHERE lexical_version=?").get(tokenizerVersion).n);
    if (!normalizedQuery || !terms.length) {
        return { query: cleanQuery, terms: [], scanned: ready, matched: 0, failed: 0, results: [], indexed: ready, indexingPending: total - ready, viaIndex: true };
    }
    const params = [tokenizerVersion];
    let where = "d.lexical_version=?";
    if (source && source !== "all") {
        where += " AND d.source=?";
        params.push(engineKey(source));
    }
    if (cwd) {
        where += " AND (d.cwd=? OR d.display_cwd=?)";
        params.push(cwd, cwd);
    }
    let rows;
    if (ftsEnabledByPath.get(path.resolve(indexPath()))) {
        where += " AND docs_fts MATCH ?";
        params.push(terms.map(indexToken).join(" AND "));
        rows = db.prepare(`SELECT d.fields_json,d.segments_json,d.summary_json FROM docs_fts JOIN docs d ON d.rowid=docs_fts.rowid WHERE ${where}`).all(...params);
    }
    else {
        // SQLite builds without FTS use exactly the same token boundaries.
        rows = db.prepare(`SELECT d.lexical,d.fields_json,d.segments_json,d.summary_json FROM docs d WHERE ${where}`).all(...params)
            .filter((row) => { const tokens = new Set(row.lexical.split(" ")); return terms.every((term) => tokens.has(indexToken(term))); });
    }
    const results = [];
    for (const row of rows) {
        try {
            const document = {
                summary: JSON.parse(row.summary_json),
                fields: JSON.parse(row.fields_json),
                segments: JSON.parse(row.segments_json),
            };
            const match = matchSearchDocument(document, cleanQuery, normalizedQuery, terms, true);
            if (match) {
                results.push(match);
            }
        }
        catch {
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
        scanned: ready,
        matched: results.length,
        failed: 0,
        results: results.slice(0, limit),
        indexed: ready,
        indexingPending: total - ready,
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
