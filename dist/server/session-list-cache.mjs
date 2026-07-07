// @ts-nocheck
import path from "node:path";
import os from "node:os";
import { mkdir, stat } from "node:fs/promises";
import { discoverSessionSummaryCandidates, summarizeSessionCandidate, } from "../sources/index.mjs";
const RECENT_ACTIVE_MS = 10 * 60 * 1000;
let dbPromise = null;
let reconciling = false;
let lastBackgroundReconcileAt = 0;
function indexPath() {
    const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    return path.join(cacheHome, "agent-snapshots", "search-index.v1.db");
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
        db.exec(`CREATE TABLE IF NOT EXISTS session_list_cache (
      ref TEXT PRIMARY KEY,
      id TEXT,
      engine TEXT,
      title TEXT,
      cwd TEXT,
      display_cwd TEXT,
      mtime TEXT,
      mtime_ms REAL DEFAULT 0,
      size INTEGER DEFAULT 0,
      file_path TEXT,
      path_key TEXT,
      candidate_mtime_ms REAL DEFAULT 0,
      candidate_size INTEGER DEFAULT 0,
      list_complete INTEGER DEFAULT 0,
      complete INTEGER DEFAULT 0,
      live INTEGER DEFAULT 0,
      summary_json TEXT,
      candidate_json TEXT,
      updated_at INTEGER DEFAULT 0
    )`);
        db.exec("CREATE INDEX IF NOT EXISTS session_list_cache_engine ON session_list_cache(engine)");
        db.exec("CREATE INDEX IF NOT EXISTS session_list_cache_mtime ON session_list_cache(mtime_ms)");
        db.exec("CREATE INDEX IF NOT EXISTS session_list_cache_path_key ON session_list_cache(path_key)");
        db.exec("CREATE TABLE IF NOT EXISTS session_list_meta (key TEXT PRIMARY KEY, value TEXT)");
        return db;
    })();
    return dbPromise;
}
function engineKey(engine) {
    const value = String(engine || "").toLowerCase();
    return value === "claude" || value === "trae" ? value : "codex";
}
function refOf(summary) {
    return summary.ref || `${engineKey(summary.engine)}:${summary.id}`;
}
function numberTime(value) {
    const time = typeof value === "number" ? value : new Date(value || 0).getTime();
    return Number.isFinite(time) && time > 0 ? time : 0;
}
function isoTime(value) {
    const time = numberTime(value);
    return time ? new Date(time).toISOString() : "";
}
function normalizedPath(value) {
    return String(value || "").replace(/\\/g, "/");
}
function isCodexActivePath(summary) {
    const filePath = normalizedPath(summary.filePath || summary.displayFilePath || "");
    return filePath.includes("/sessions/") && !filePath.includes("/archived_sessions/");
}
function deriveRuntimeState(summary) {
    if (summary?.live === true) {
        return { live: true, complete: false };
    }
    if (summary?.complete === false) {
        return { live: true, complete: false };
    }
    const engine = engineKey(summary?.engine);
    if (engine === "trae") {
        const complete = summary?.sourceKind ? summary.sourceKind === "recorded" : true;
        return { live: false, complete };
    }
    if (engine === "codex") {
        const live = isCodexActivePath(summary);
        return { live, complete: !live };
    }
    if (engine === "claude") {
        const complete = summary?.sourceKind ? summary.sourceKind === "transcript" && summary.historyOnly !== true : true;
        return { live: false, complete };
    }
    return { live: false, complete: true };
}
function listCompleteForSource(summary, source = "all") {
    const engine = engineKey(summary?.engine);
    if (source === "trae") {
        return summary?.sourceKind ? summary.sourceKind === "recorded" : Number(summary?.messageCount || 0) > 0;
    }
    if (engine === "trae" && source === "trae") {
        return summary?.sourceKind === "recorded";
    }
    return Number(summary?.messageCount || 0) > 0;
}
function stampSummary(summary) {
    const next = { ...summary };
    const state = deriveRuntimeState(next);
    next.live = state.live;
    next.complete = state.complete;
    return next;
}
function rowSummary(row) {
    try {
        return JSON.parse(row.summary_json || "{}");
    }
    catch {
        return null;
    }
}
function rowCandidate(row) {
    try {
        return JSON.parse(row.candidate_json || "{}");
    }
    catch {
        return null;
    }
}
function cacheCandidate(candidate) {
    const filePaths = Array.isArray(candidate.filePaths)
        ? candidate.filePaths.filter(Boolean)
        : [candidate.filePath || candidate.path].filter(Boolean);
    const out = {
        key: candidate.key || `${candidate.engine || "codex"}:${candidate.filePath || candidate.path || ""}`,
        engine: candidate.engine || "codex",
        kind: candidate.kind || "asc-file",
        filePath: candidate.filePath || candidate.path || filePaths[0] || "",
        filePaths,
        mtimeMs: Number(candidate.mtimeMs || 0),
        mtime: candidate.mtime || isoTime(candidate.mtimeMs),
        size: Number(candidate.size || candidate.sizeBytes || 0),
        sizeBytes: Number(candidate.sizeBytes || candidate.size || 0),
    };
    if (Array.isArray(candidate.fileInfos)) {
        out.fileInfos = candidate.fileInfos;
    }
    if (candidate.workspace) {
        out.workspace = candidate.workspace;
    }
    return out;
}
function fallbackCandidate(summary) {
    const filePaths = Array.isArray(summary.filePaths)
        ? summary.filePaths.filter(Boolean)
        : [summary.filePath].filter(Boolean);
    const mtimeMs = numberTime(summary.mtime);
    return cacheCandidate({
        key: `${engineKey(summary.engine)}:${summary.filePath || refOf(summary)}`,
        engine: engineKey(summary.engine),
        kind: engineKey(summary.engine) === "trae" ? `trae-${summary.sourceKind || "summary"}` : "asc-file",
        filePath: summary.filePath || "",
        filePaths,
        mtimeMs,
        mtime: summary.mtime || isoTime(mtimeMs),
        size: Number(summary.size || 0),
        sizeBytes: Number(summary.size || 0),
    });
}
function upsertRows(db, candidate, summaries) {
    const cachedCandidate = cacheCandidate(candidate);
    const pathKey = cachedCandidate.key;
    const now = Date.now();
    const refs = [];
    const upsert = db.prepare(`INSERT INTO session_list_cache
    (ref, id, engine, title, cwd, display_cwd, mtime, mtime_ms, size, file_path, path_key,
      candidate_mtime_ms, candidate_size, list_complete, complete, live, summary_json, candidate_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ref) DO UPDATE SET
      id=excluded.id, engine=excluded.engine, title=excluded.title, cwd=excluded.cwd,
      display_cwd=excluded.display_cwd, mtime=excluded.mtime, mtime_ms=excluded.mtime_ms,
      size=excluded.size, file_path=excluded.file_path, path_key=excluded.path_key,
      candidate_mtime_ms=excluded.candidate_mtime_ms, candidate_size=excluded.candidate_size,
      list_complete=excluded.list_complete, complete=excluded.complete, live=excluded.live,
      summary_json=excluded.summary_json, candidate_json=excluded.candidate_json, updated_at=excluded.updated_at`);
    const selectPathRefs = db.prepare("SELECT ref FROM session_list_cache WHERE path_key = ?");
    const delRef = db.prepare("DELETE FROM session_list_cache WHERE ref = ?");
    const delAll = db.prepare("DELETE FROM session_list_cache WHERE path_key = ?");
    db.exec("BEGIN IMMEDIATE");
    try {
        for (const original of summaries || []) {
            const summary = stampSummary(original);
            const ref = refOf(summary);
            refs.push(ref);
            const state = deriveRuntimeState(summary);
            const mtimeMs = numberTime(summary.mtime) || Number(cachedCandidate.mtimeMs || 0);
            upsert.run(ref, summary.id || ref.replace(/^(codex|claude|trae):/, ""), engineKey(summary.engine), summary.title || "", summary.cwd || "", summary.displayCwd || summary.cwd || "", summary.mtime || isoTime(mtimeMs), mtimeMs, Number(summary.size || cachedCandidate.size || 0), summary.filePath || cachedCandidate.filePath || "", pathKey, Number(cachedCandidate.mtimeMs || 0), Number(cachedCandidate.size || cachedCandidate.sizeBytes || 0), listCompleteForSource(summary, engineKey(summary.engine)) ? 1 : 0, state.complete ? 1 : 0, state.live ? 1 : 0, JSON.stringify(summary), JSON.stringify(cachedCandidate), now);
        }
        if (refs.length) {
            const keep = new Set(refs);
            for (const row of selectPathRefs.all(pathKey)) {
                if (!keep.has(row.ref)) {
                    delRef.run(row.ref);
                }
            }
        }
        else {
            delAll.run(pathKey);
        }
        db.exec("COMMIT");
    }
    catch (error) {
        try {
            db.exec("ROLLBACK");
        }
        catch {
            // Ignore rollback failures.
        }
        throw error;
    }
}
async function upsertFallbackSummaries(summaries) {
    if (!summaries?.length) {
        return;
    }
    const db = await getDb();
    for (const summary of summaries) {
        upsertRows(db, fallbackCandidate(summary), [summary]);
    }
}
function setMeta(db, key, value) {
    db.prepare(`INSERT INTO session_list_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}
function getMeta(db, key, fallback = "") {
    const row = db.prepare("SELECT value FROM session_list_meta WHERE key = ?").get(key);
    return row?.value ?? fallback;
}
async function refreshCandidateStats(candidate) {
    const paths = Array.isArray(candidate.filePaths) && candidate.filePaths.length
        ? candidate.filePaths
        : [candidate.filePath || candidate.path].filter(Boolean);
    const fileInfos = [];
    for (const filePath of paths) {
        try {
            const info = await stat(filePath);
            fileInfos.push({
                filePath,
                size: info.size,
                mtimeMs: info.mtimeMs,
                mtime: info.mtime.toISOString(),
            });
        }
        catch {
            // The reconcile sweep will discover any replacement path. A candidate
            // with no remaining files is stale and should be removed.
        }
    }
    if (!fileInfos.length) {
        return null;
    }
    const latest = fileInfos.slice().sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    return {
        ...candidate,
        filePath: latest.filePath,
        filePaths: fileInfos.map((file) => file.filePath),
        fileInfos,
        mtimeMs: latest.mtimeMs,
        mtime: latest.mtime,
        size: fileInfos.reduce((total, file) => total + Number(file.size || 0), 0),
        sizeBytes: fileInfos.reduce((total, file) => total + Number(file.size || 0), 0),
    };
}
function updateRowStatOnly(db, row, candidate) {
    const summary = stampSummary({
        ...(rowSummary(row) || {}),
        mtime: candidate.mtime || isoTime(candidate.mtimeMs),
        size: Number(candidate.size || candidate.sizeBytes || row.size || 0),
        filePath: candidate.filePath || row.file_path || "",
    });
    const state = deriveRuntimeState(summary);
    const cachedCandidate = cacheCandidate(candidate);
    db.prepare(`UPDATE session_list_cache SET
    mtime = ?, mtime_ms = ?, size = ?, file_path = ?, candidate_mtime_ms = ?,
    candidate_size = ?, complete = ?, live = ?, summary_json = ?, candidate_json = ?, updated_at = ?
    WHERE ref = ?`).run(summary.mtime || isoTime(cachedCandidate.mtimeMs), numberTime(summary.mtime) || Number(cachedCandidate.mtimeMs || 0), Number(summary.size || cachedCandidate.size || 0), summary.filePath || cachedCandidate.filePath || "", Number(cachedCandidate.mtimeMs || 0), Number(cachedCandidate.size || cachedCandidate.sizeBytes || 0), state.complete ? 1 : 0, state.live ? 1 : 0, JSON.stringify(summary), JSON.stringify(cachedCandidate), Date.now(), row.ref);
    return db.prepare("SELECT * FROM session_list_cache WHERE ref = ?").get(row.ref) || null;
}
async function refreshRowIfNeeded(db, row, homes, { parseChanged = true, parseIfListIncomplete = false } = {}) {
    const candidate = rowCandidate(row) || fallbackCandidate(rowSummary(row) || {});
    const refreshed = await refreshCandidateStats(candidate);
    if (!refreshed) {
        db.prepare("DELETE FROM session_list_cache WHERE path_key = ?").run(row.path_key);
        return null;
    }
    const changed = Number(refreshed.mtimeMs || 0) !== Number(row.candidate_mtime_ms || 0)
        || Number(refreshed.size || 0) !== Number(row.candidate_size || 0);
    if (!changed) {
        return row;
    }
    const summary = rowSummary(row);
    if (!parseChanged && !(parseIfListIncomplete && !listCompleteForSource(summary, "all"))) {
        return updateRowStatOnly(db, row, refreshed);
    }
    const summaries = await summarizeSessionCandidate(refreshed, homes);
    upsertRows(db, refreshed, summaries);
    return db.prepare("SELECT * FROM session_list_cache WHERE ref = ?").get(row.ref) || null;
}
function matchesSource(row, source) {
    return !source || source === "all" || engineKey(row.engine) === engineKey(source);
}
function matchesCwd(summary, cwd) {
    if (!cwd) {
        return true;
    }
    if (!summary?.cwd) {
        return false;
    }
    try {
        return path.resolve(summary.cwd).startsWith(path.resolve(cwd));
    }
    catch {
        return false;
    }
}
async function readCachedSessions({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, source, cwd, completeOnly, liveOnly, limit, offset }) {
    const db = await getDb();
    const rows = db.prepare("SELECT * FROM session_list_cache ORDER BY mtime_ms DESC").all();
    const homes = { codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir };
    const out = [];
    const skip = Math.max(0, Number(offset || 0));
    const take = Number.isFinite(limit) ? Math.max(0, Number(limit || 0)) : Number.POSITIVE_INFINITY;
    const recentCutoff = Date.now() - RECENT_ACTIVE_MS;
    let seen = 0;
    for (const initialRow of rows) {
        let row = initialRow;
        if (!matchesSource(row, source)) {
            continue;
        }
        if (Number(row.candidate_mtime_ms || row.mtime_ms || 0) >= recentCutoff) {
            row = await refreshRowIfNeeded(db, row, homes, { parseChanged: false, parseIfListIncomplete: completeOnly });
            if (!row) {
                continue;
            }
        }
        let summary = rowSummary(row);
        if (!summary) {
            continue;
        }
        if (!matchesCwd(summary, cwd)) {
            continue;
        }
        if (completeOnly && !listCompleteForSource(summary, source)) {
            continue;
        }
        if (liveOnly && Number(row.live || 0) !== 1 && summary.live !== true) {
            continue;
        }
        row = await refreshRowIfNeeded(db, row, homes, { parseChanged: false, parseIfListIncomplete: completeOnly });
        if (!row) {
            continue;
        }
        summary = rowSummary(row);
        if (!summary) {
            continue;
        }
        if (completeOnly && !listCompleteForSource(summary, source)) {
            continue;
        }
        if (liveOnly && Number(row.live || 0) !== 1 && summary.live !== true) {
            continue;
        }
        if (seen < skip) {
            seen += 1;
            continue;
        }
        out.push(summary);
        if (out.length >= take) {
            break;
        }
    }
    return out;
}
export async function sessionListCacheRowCount() {
    const db = await getDb();
    const row = db.prepare("SELECT COUNT(*) AS c FROM session_list_cache").get();
    return Number(row?.c || 0);
}
export async function listSessionsWithCache(options) {
    const { listSessions, limit, offset = 0, source = "codex", cwd = "", includeArchived = true, completeOnly = false, liveOnly = false, } = options;
    const rows = await sessionListCacheRowCount();
    const homes = {
        codexHome: options.codexHome,
        claudeHome: options.claudeHome,
        traeHome: options.traeHome,
        traeAppHome: options.traeAppHome,
        traeRecordingsDir: options.traeRecordingsDir,
    };
    if (rows > 0) {
        const sessions = await readCachedSessions({ ...homes, source, cwd, completeOnly, liveOnly, limit, offset });
        reconcileSessionListCacheInBackground({ ...homes });
        return sessions;
    }
    const scanLimit = Number.isFinite(limit) ? limit + offset : Number.POSITIVE_INFINITY;
    const sessions = await listSessions({
        ...homes,
        limit: scanLimit,
        cwd,
        includeArchived,
        source,
        completeOnly,
    });
    await upsertFallbackSummaries(sessions);
    reconcileSessionListCacheInBackground({ ...homes });
    return Number.isFinite(limit) ? sessions.slice(offset, offset + limit) : sessions.slice(offset);
}
export async function reconcileSessionListCache(options) {
    const db = await getDb();
    const homes = {
        codexHome: options.codexHome,
        claudeHome: options.claudeHome,
        traeHome: options.traeHome,
        traeAppHome: options.traeAppHome,
        traeRecordingsDir: options.traeRecordingsDir,
    };
    const started = Date.now();
    const previousWatermark = Number(getMeta(db, "watermark_mtime_ms", "0")) || 0;
    let scanned = 0;
    let updated = 0;
    let failed = 0;
    let deleted = 0;
    try {
        const candidates = await discoverSessionSummaryCandidates({ ...homes, source: "all", includeArchived: true });
        scanned = candidates.length;
        const candidateKeys = new Set(candidates.map((candidate) => cacheCandidate(candidate).key));
        const existingRows = db.prepare(`SELECT path_key, MAX(candidate_mtime_ms) AS mtime_ms, MAX(candidate_size) AS size
      FROM session_list_cache GROUP BY path_key`).all();
        const existing = new Map(existingRows.map((row) => [row.path_key, row]));
        const recentCutoff = Date.now() - RECENT_ACTIVE_MS;
        for (const candidate of candidates) {
            const cachedCandidate = cacheCandidate(candidate);
            const row = existing.get(cachedCandidate.key);
            const changed = !row
                || Number(cachedCandidate.mtimeMs || 0) > previousWatermark
                || Number(cachedCandidate.mtimeMs || 0) !== Number(row.mtime_ms || 0)
                || Number(cachedCandidate.size || 0) !== Number(row.size || 0)
                || Number(cachedCandidate.mtimeMs || 0) >= recentCutoff;
            if (!changed) {
                continue;
            }
            try {
                const summaries = await summarizeSessionCandidate(cachedCandidate, homes);
                upsertRows(db, cachedCandidate, summaries);
                updated += summaries.length;
            }
            catch {
                failed += 1;
            }
        }
        const stale = db.prepare("SELECT DISTINCT path_key FROM session_list_cache").all()
            .map((row) => row.path_key)
            .filter((key) => key && !candidateKeys.has(key));
        if (stale.length) {
            const del = db.prepare("DELETE FROM session_list_cache WHERE path_key = ?");
            db.exec("BEGIN IMMEDIATE");
            try {
                for (const key of stale) {
                    const result = del.run(key);
                    deleted += Number(result?.changes || 0);
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
        const watermark = candidates.reduce((max, candidate) => Math.max(max, Number(candidate.mtimeMs || 0)), previousWatermark);
        setMeta(db, "watermark_mtime_ms", String(watermark));
        setMeta(db, "last_reconcile_ms", String(Date.now() - started));
        setMeta(db, "last_reconcile_at", new Date().toISOString());
        setMeta(db, "last_reconcile_scanned", String(scanned));
        setMeta(db, "last_reconcile_updated", String(updated));
        setMeta(db, "last_reconcile_failed", String(failed));
        setMeta(db, "last_reconcile_deleted", String(deleted));
        setMeta(db, "last_reconcile_error", "");
        return { scanned, updated, failed, deleted, rows: await sessionListCacheRowCount(), watermark, lastReconcileMs: Date.now() - started };
    }
    catch (error) {
        setMeta(db, "last_reconcile_ms", String(Date.now() - started));
        setMeta(db, "last_reconcile_at", new Date().toISOString());
        setMeta(db, "last_reconcile_error", error instanceof Error ? error.message : String(error));
        throw error;
    }
}
export function reconcileSessionListCacheInBackground(options) {
    if (reconciling) {
        return;
    }
    const now = Date.now();
    if (lastBackgroundReconcileAt && now - lastBackgroundReconcileAt < 10_000) {
        return;
    }
    lastBackgroundReconcileAt = now;
    reconciling = true;
    setTimeout(() => {
        Promise.resolve()
            .then(() => reconcileSessionListCache(options))
            .catch(() => { })
            .finally(() => {
            reconciling = false;
        });
    }, 0);
}
export async function sessionListCacheStatus() {
    const db = await getDb();
    const rows = await sessionListCacheRowCount();
    const watermarkMs = Number(getMeta(db, "watermark_mtime_ms", "0")) || 0;
    return {
        rows,
        watermark: watermarkMs ? new Date(watermarkMs).toISOString() : "",
        watermarkMs,
        lastReconcileMs: Number(getMeta(db, "last_reconcile_ms", "0")) || 0,
        lastReconcileAt: getMeta(db, "last_reconcile_at", ""),
        lastReconcileScanned: Number(getMeta(db, "last_reconcile_scanned", "0")) || 0,
        lastReconcileUpdated: Number(getMeta(db, "last_reconcile_updated", "0")) || 0,
        lastReconcileFailed: Number(getMeta(db, "last_reconcile_failed", "0")) || 0,
        lastReconcileDeleted: Number(getMeta(db, "last_reconcile_deleted", "0")) || 0,
        lastReconcileError: getMeta(db, "last_reconcile_error", ""),
        running: reconciling,
    };
}
