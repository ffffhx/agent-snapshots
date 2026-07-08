// @ts-nocheck
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { discoverSessionSummaryCandidates, summarizeSessionCandidate, } from "../sources/index.mjs";
import { codexHomeKeys, discoverCodexHomes } from "../sources/codex-homes.mjs";
const RECENT_ACTIVE_MS = 10 * 60 * 1000;
const CACHE_TABLE = "session_list_cache_v3";
const META_TABLE = "session_list_meta_v3";
let dbPromise = null;
let reconciling = false;
let lastBackgroundReconcileAt = 0;
export function sessionListCachePath() {
    const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    return path.join(cacheHome, "agent-snapshots", "search-index.v2.db");
}
function indexPath() {
    return sessionListCachePath();
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
        db.exec(`CREATE TABLE IF NOT EXISTS ${CACHE_TABLE} (
      cache_key TEXT PRIMARY KEY,
      ref TEXT,
      id TEXT,
      engine TEXT,
      home_key TEXT DEFAULT '',
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
        db.exec(`CREATE INDEX IF NOT EXISTS session_list_cache_v3_ref ON ${CACHE_TABLE}(ref)`);
        db.exec(`CREATE INDEX IF NOT EXISTS session_list_cache_v3_engine ON ${CACHE_TABLE}(engine)`);
        db.exec(`CREATE INDEX IF NOT EXISTS session_list_cache_v3_home ON ${CACHE_TABLE}(home_key)`);
        db.exec(`CREATE INDEX IF NOT EXISTS session_list_cache_v3_mtime ON ${CACHE_TABLE}(mtime_ms)`);
        db.exec(`CREATE INDEX IF NOT EXISTS session_list_cache_v3_path_key ON ${CACHE_TABLE}(path_key)`);
        db.exec(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT)`);
        return db;
    })();
    return dbPromise;
}
function engineKey(engine) {
    const value = String(engine || "").toLowerCase();
    return value === "claude" ? value : "codex";
}
function expandHome(value) {
    const text = String(value || "").trim();
    if (text === "~") {
        return os.homedir();
    }
    if (text.startsWith("~/")) {
        return path.join(os.homedir(), text.slice(2));
    }
    return text;
}
function normalizeHomePath(value) {
    const text = String(value || "").trim();
    if (!text) {
        return "";
    }
    return path.resolve(expandHome(text)).replace(/[\\/]+$/, "");
}
function pathHomeDigest(home) {
    const normalized = normalizeHomePath(home);
    if (!normalized) {
        return "";
    }
    return `home-${createHash("sha256").update(normalized).digest("hex").slice(0, 12)}`;
}
function scopedHomeKey(scope, home) {
    const digest = pathHomeDigest(home);
    return digest ? `${scope}:${digest}` : "";
}
function claudeHomeKey(home) {
    return scopedHomeKey("claude", home);
}
function activeClaudeHomeKeys(homes = {}) {
    return new Set([claudeHomeKey(homes?.claudeHome || "")].filter(Boolean));
}
function primaryCodexHomeKey(homes = {}) {
    const primary = (homes?.codexHomes || []).find((home) => home?.primary) || (homes?.codexHomes || [])[0];
    return String(primary?.key || pathHomeDigest(homes?.codexHome || "") || "").trim();
}
function refOf(summary) {
    return summary.ref || `${engineKey(summary.engine)}:${summary.id}`;
}
function homeKeyOf(summary, candidate = null, homes = {}) {
    const engine = engineKey(summary?.engine || candidate?.engine);
    if (engine === "codex") {
        return String(summary?.codexHomeKey || candidate?.codexHomeKey || "").trim()
            || primaryCodexHomeKey(homes);
    }
    if (engine === "claude") {
        return String(summary?.homeKey || candidate?.homeKey || candidate?.sourceHomeKey || "").trim()
            || claudeHomeKey(homes?.claudeHome || "");
    }
    return "";
}
function cacheKeyOf(summary, candidate = null, homes = {}) {
    const ref = refOf(summary);
    const engine = engineKey(summary?.engine || candidate?.engine);
    const homeKey = homeKeyOf(summary, candidate, homes);
    return [engine, homeKey, ref].join("\0");
}
function candidateScopeHomeKey(candidate, homes = {}) {
    const cached = cacheCandidate(candidate || {});
    return homeKeyOf({
        engine: cached.engine,
        codexHomeKey: cached.codexHomeKey,
        homeKey: cached.homeKey,
    }, cached, homes);
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
    const engine = engineKey(summary?.engine);
    if (engine === "claude" && (summary?.historyOnly === true || (summary?.sourceKind && summary.sourceKind !== "transcript"))) {
        return { live: false, complete: false };
    }
    if (summary?.live === true) {
        return { live: true, complete: false };
    }
    if (summary?.complete === false) {
        return { live: true, complete: false };
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
function listCompleteForSource(summary) {
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
        homeKey: String(candidate.homeKey || candidate.sourceHomeKey || ""),
        codexHomeKey: String(candidate.codexHomeKey || ""),
        codexHomeLabel: String(candidate.codexHomeLabel || ""),
        codexHomePrimary: candidate.codexHomePrimary !== false,
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
        kind: "asc-file",
        filePath: summary.filePath || "",
        filePaths,
        mtimeMs,
        mtime: summary.mtime || isoTime(mtimeMs),
        size: Number(summary.size || 0),
        sizeBytes: Number(summary.size || 0),
        codexHomeKey: summary.codexHomeKey || "",
        codexHomeLabel: summary.codexHomeLabel || "",
        codexHomePrimary: !summary.codexHomeLabel,
    });
}
function upsertRows(db, candidate, summaries, homes = {}) {
    const cachedCandidate = cacheCandidate(candidate);
    const pathKey = cachedCandidate.key;
    const now = Date.now();
    const keepIdentities = [];
    const upsert = db.prepare(`INSERT INTO ${CACHE_TABLE}
    (cache_key, ref, id, engine, home_key, title, cwd, display_cwd, mtime, mtime_ms, size, file_path, path_key,
      candidate_mtime_ms, candidate_size, list_complete, complete, live, summary_json, candidate_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      id=excluded.id, engine=excluded.engine, title=excluded.title, cwd=excluded.cwd,
      ref=excluded.ref, home_key=excluded.home_key,
      display_cwd=excluded.display_cwd, mtime=excluded.mtime, mtime_ms=excluded.mtime_ms,
      size=excluded.size, file_path=excluded.file_path, path_key=excluded.path_key,
      candidate_mtime_ms=excluded.candidate_mtime_ms, candidate_size=excluded.candidate_size,
      list_complete=excluded.list_complete, complete=excluded.complete, live=excluded.live,
      summary_json=excluded.summary_json, candidate_json=excluded.candidate_json, updated_at=excluded.updated_at`);
    const selectPathRefs = db.prepare(`SELECT rowid AS __rowid, cache_key, ref, engine, home_key, summary_json, candidate_json FROM ${CACHE_TABLE} WHERE path_key = ?`);
    const delRef = db.prepare(`DELETE FROM ${CACHE_TABLE} WHERE rowid = ?`);
    const candidateHomeKey = candidateScopeHomeKey(cachedCandidate, homes);
    db.exec("BEGIN IMMEDIATE");
    try {
        for (const original of summaries || []) {
            const summary = stampSummary(original);
            const ref = refOf(summary);
            const homeKey = homeKeyOf(summary, cachedCandidate, homes);
            const cacheKey = cacheKeyOf(summary, cachedCandidate, homes);
            keepIdentities.push(cacheRowIdentity({ engine: engineKey(summary.engine), home_key: homeKey, ref }));
            const state = deriveRuntimeState(summary);
            const mtimeMs = numberTime(summary.mtime) || Number(cachedCandidate.mtimeMs || 0);
            upsert.run(cacheKey, ref, summary.id || ref.replace(/^(codex|claude):/, ""), engineKey(summary.engine), homeKey, summary.title || "", summary.cwd || "", summary.displayCwd || summary.cwd || "", summary.mtime || isoTime(mtimeMs), mtimeMs, Number(summary.size || cachedCandidate.size || 0), summary.filePath || cachedCandidate.filePath || "", pathKey, Number(cachedCandidate.mtimeMs || 0), Number(cachedCandidate.size || cachedCandidate.sizeBytes || 0), listCompleteForSource(summary, engineKey(summary.engine)) ? 1 : 0, state.complete ? 1 : 0, state.live ? 1 : 0, JSON.stringify(summary), JSON.stringify(cachedCandidate), now);
        }
        if (keepIdentities.length) {
            const keep = new Set(keepIdentities);
            for (const row of selectPathRefs.all(pathKey)) {
                if (!keep.has(cacheRowIdentity(row)) && matchesCandidateScope(row, cachedCandidate, candidateHomeKey, homes)) {
                    delRef.run(row.__rowid);
                }
            }
        }
        else {
            for (const row of selectPathRefs.all(pathKey)) {
                if (matchesCandidateScope(row, cachedCandidate, candidateHomeKey, homes)) {
                    delRef.run(row.__rowid);
                }
            }
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
async function upsertFallbackSummaries(summaries, homes = {}) {
    if (!summaries?.length) {
        return;
    }
    const db = await getDb();
    for (const summary of summaries) {
        upsertRows(db, fallbackCandidate(summary), [summary], homes);
    }
}
function setMeta(db, key, value) {
    db.prepare(`INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}
function getMeta(db, key, fallback = "") {
    const row = db.prepare(`SELECT value FROM ${META_TABLE} WHERE key = ?`).get(key);
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
    const rowId = Number(row.__rowid || 0);
    const where = rowId ? "rowid = ?" : "cache_key = ?";
    const whereValue = rowId || row.cache_key;
    db.prepare(`UPDATE ${CACHE_TABLE} SET
    mtime = ?, mtime_ms = ?, size = ?, file_path = ?, candidate_mtime_ms = ?,
    candidate_size = ?, complete = ?, live = ?, summary_json = ?, candidate_json = ?, updated_at = ?
    WHERE ${where}`).run(summary.mtime || isoTime(cachedCandidate.mtimeMs), numberTime(summary.mtime) || Number(cachedCandidate.mtimeMs || 0), Number(summary.size || cachedCandidate.size || 0), summary.filePath || cachedCandidate.filePath || "", Number(cachedCandidate.mtimeMs || 0), Number(cachedCandidate.size || cachedCandidate.sizeBytes || 0), state.complete ? 1 : 0, state.live ? 1 : 0, JSON.stringify(summary), JSON.stringify(cachedCandidate), Date.now(), whereValue);
    return rowId
        ? db.prepare(`SELECT rowid AS __rowid, * FROM ${CACHE_TABLE} WHERE rowid = ?`).get(rowId) || null
        : db.prepare(`SELECT rowid AS __rowid, * FROM ${CACHE_TABLE} WHERE cache_key = ?`).get(row.cache_key) || null;
}
async function refreshRowIfNeeded(db, row, homes, { parseChanged = true, parseIfListIncomplete = false } = {}) {
    const candidate = rowCandidate(row) || fallbackCandidate(rowSummary(row) || {});
    const refreshed = await refreshCandidateStats(candidate);
    if (!refreshed) {
        if (row.__rowid) {
            db.prepare(`DELETE FROM ${CACHE_TABLE} WHERE rowid = ?`).run(row.__rowid);
        }
        else {
            db.prepare(`DELETE FROM ${CACHE_TABLE} WHERE cache_key = ?`).run(row.cache_key);
        }
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
    upsertRows(db, refreshed, summaries, homes);
    return row.__rowid
        ? db.prepare(`SELECT rowid AS __rowid, * FROM ${CACHE_TABLE} WHERE rowid = ?`).get(row.__rowid) || null
        : db.prepare(`SELECT rowid AS __rowid, * FROM ${CACHE_TABLE} WHERE cache_key = ?`).get(row.cache_key) || null;
}
function matchesSource(row, source) {
    return !source || source === "all" || engineKey(row.engine) === engineKey(source);
}
function storedRowHomeKey(row) {
    const direct = String(row?.home_key || "").trim();
    if (direct) {
        return direct;
    }
    const summary = rowSummary(row) || {};
    const candidate = rowCandidate(row) || {};
    const engine = engineKey(row?.engine || summary?.engine || candidate?.engine);
    if (engine === "codex") {
        return String(summary?.codexHomeKey || candidate?.codexHomeKey || "").trim();
    }
    return String(summary?.homeKey || candidate?.homeKey || candidate?.sourceHomeKey || "").trim();
}
function cacheRowIdentity(row) {
    return JSON.stringify([engineKey(row?.engine), storedRowHomeKey(row), String(row?.ref || "")]);
}
function matchesActiveHome(row, homes) {
    const engine = engineKey(row.engine);
    const rowHomeKey = storedRowHomeKey(row);
    if (engine === "codex") {
        const active = homes?.activeCodexHomeKeys || codexHomeKeys(homes?.codexHomes || []);
        return rowHomeKey ? active.has(rowHomeKey) : Boolean(primaryCodexHomeKey(homes));
    }
    if (engine === "claude") {
        return rowHomeKey ? activeClaudeHomeKeys(homes).has(rowHomeKey) : Boolean(claudeHomeKey(homes?.claudeHome || ""));
    }
    return false;
}
function matchesCandidateScope(row, candidate, candidateHomeKey, homes) {
    if (engineKey(row?.engine) !== engineKey(candidate?.engine)) {
        return false;
    }
    const rowHomeKey = storedRowHomeKey(row);
    if (rowHomeKey && candidateHomeKey) {
        return rowHomeKey === candidateHomeKey;
    }
    if (!rowHomeKey) {
        return matchesActiveHome(row, homes);
    }
    return false;
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
function filterSummariesForRequest(summaries, { source, cwd, completeOnly, liveOnly }) {
    const out = [];
    for (const original of summaries || []) {
        const summary = stampSummary(original);
        if (source && source !== "all" && engineKey(summary.engine) !== engineKey(source)) {
            continue;
        }
        if (!matchesCwd(summary, cwd)) {
            continue;
        }
        if (completeOnly && !listCompleteForSource(summary, source)) {
            continue;
        }
        if (liveOnly && summary.live !== true) {
            continue;
        }
        out.push(summary);
    }
    return out;
}
async function readCachedSessions({ codexHome, claudeHome, source, cwd, completeOnly, liveOnly, limit, offset }) {
    const db = await getDb();
    const codexHomes = await discoverCodexHomes(codexHome);
    const homes = { codexHome, claudeHome, codexHomes, activeCodexHomeKeys: codexHomeKeys(codexHomes) };
    const rows = db.prepare(`SELECT rowid AS __rowid, * FROM ${CACHE_TABLE} ORDER BY mtime_ms DESC`).all();
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
        if (!matchesActiveHome(row, homes)) {
            continue;
        }
        if (Number(row.candidate_mtime_ms || row.mtime_ms || 0) >= recentCutoff) {
            row = await refreshRowIfNeeded(db, row, homes, { parseChanged: false, parseIfListIncomplete: completeOnly });
            if (!row) {
                continue;
            }
        }
        let rawSummary = rowSummary(row);
        if (!rawSummary) {
            continue;
        }
        let summary = stampSummary(rawSummary);
        if (!matchesCwd(summary, cwd)) {
            continue;
        }
        if (completeOnly && !listCompleteForSource(summary, source)) {
            continue;
        }
        if (liveOnly && summary.live !== true) {
            continue;
        }
        row = await refreshRowIfNeeded(db, row, homes, { parseChanged: false, parseIfListIncomplete: completeOnly });
        if (!row) {
            continue;
        }
        rawSummary = rowSummary(row);
        if (!rawSummary) {
            continue;
        }
        summary = stampSummary(rawSummary);
        if (completeOnly && !listCompleteForSource(summary, source)) {
            continue;
        }
        if (liveOnly && summary.live !== true) {
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
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${CACHE_TABLE}`).get();
    return Number(row?.c || 0);
}
async function sessionListCacheUsableInfo({ source, codexHome, claudeHome }) {
    const db = await getDb();
    const codexHomes = await discoverCodexHomes(codexHome);
    const homes = { codexHome, claudeHome, codexHomes, activeCodexHomeKeys: codexHomeKeys(codexHomes) };
    const activeHomeKey = Array.from(homes.activeCodexHomeKeys).sort().join(",");
    const cachedHomeKey = getMeta(db, "codex_home_keys", "");
    const rows = db.prepare(`SELECT rowid AS __rowid, cache_key, ref, engine, home_key, summary_json, candidate_json FROM ${CACHE_TABLE}`).all();
    const count = rows.filter((row) => matchesSource(row, source) && matchesActiveHome(row, homes)).length;
    const includesCodex = !source || source === "all" || engineKey(source) === "codex";
    return {
        count,
        codexHomesChanged: includesCodex && Boolean(cachedHomeKey) && cachedHomeKey !== activeHomeKey,
    };
}
export async function listSessionsWithCache(options) {
    const { listSessions, limit, offset = 0, source = "codex", cwd = "", includeArchived = true, completeOnly = false, liveOnly = false, } = options;
    const codexHomes = await discoverCodexHomes(options.codexHome);
    const cacheInfo = await sessionListCacheUsableInfo({
        source,
        codexHome: options.codexHome,
        claudeHome: options.claudeHome,
    });
    const rows = cacheInfo.codexHomesChanged ? 0 : cacheInfo.count;
    const homes = {
        codexHome: options.codexHome,
        claudeHome: options.claudeHome,
        codexHomes,
        activeCodexHomeKeys: codexHomeKeys(codexHomes),
    };
    if (rows > 0) {
        const sessions = await readCachedSessions({ ...homes, source, cwd, completeOnly, liveOnly, limit, offset });
        reconcileSessionListCacheInBackground({ ...homes });
        return sessions;
    }
    const scanLimit = liveOnly || !Number.isFinite(limit) ? Number.POSITIVE_INFINITY : limit + offset;
    const sessions = await listSessions({
        ...homes,
        limit: scanLimit,
        cwd,
        includeArchived,
        source,
        completeOnly,
    });
    await upsertFallbackSummaries(sessions, homes);
    reconcileSessionListCacheInBackground({ ...homes });
    const filtered = filterSummariesForRequest(sessions, { source, cwd, completeOnly, liveOnly });
    return Number.isFinite(limit) ? filtered.slice(offset, offset + limit) : filtered.slice(offset);
}
export async function reconcileSessionListCache(options) {
    const db = await getDb();
    const codexHomes = await discoverCodexHomes(options.codexHome);
    const homes = {
        codexHome: options.codexHome,
        claudeHome: options.claudeHome,
        codexHomes,
        activeCodexHomeKeys: codexHomeKeys(codexHomes),
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
      FROM ${CACHE_TABLE} GROUP BY path_key`).all();
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
                upsertRows(db, cachedCandidate, summaries, homes);
                updated += summaries.length;
            }
            catch {
                failed += 1;
            }
        }
        const stale = db.prepare(`SELECT rowid AS __rowid, cache_key, path_key, engine, home_key, summary_json, candidate_json FROM ${CACHE_TABLE}`).all()
            .filter((row) => matchesActiveHome(row, homes))
            .filter((row) => row.path_key && !candidateKeys.has(row.path_key));
        if (stale.length) {
            const del = db.prepare(`DELETE FROM ${CACHE_TABLE} WHERE rowid = ?`);
            db.exec("BEGIN IMMEDIATE");
            try {
                for (const row of stale) {
                    const result = del.run(row.__rowid);
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
        const maxCandidateWatermark = candidates.reduce((max, candidate) => Math.max(max, Number(candidate.mtimeMs || 0)), previousWatermark);
        const changed = updated > 0 || deleted > 0;
        const watermark = changed ? Math.max(maxCandidateWatermark, previousWatermark + 1) : maxCandidateWatermark;
        setMeta(db, "watermark_mtime_ms", String(watermark));
        setMeta(db, "last_reconcile_ms", String(Date.now() - started));
        setMeta(db, "last_reconcile_at", new Date().toISOString());
        setMeta(db, "last_reconcile_scanned", String(scanned));
        setMeta(db, "last_reconcile_updated", String(updated));
        setMeta(db, "last_reconcile_failed", String(failed));
        setMeta(db, "last_reconcile_deleted", String(deleted));
        setMeta(db, "last_reconcile_error", "");
        setMeta(db, "codex_home_keys", Array.from(homes.activeCodexHomeKeys).sort().join(","));
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
        path: indexPath(),
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
export async function sessionListCacheWatermark(options = null) {
    const db = await getDb();
    if (options) {
        const codexHomes = await discoverCodexHomes(options.codexHome);
        const homes = {
            codexHome: options.codexHome,
            claudeHome: options.claudeHome,
            codexHomes,
            activeCodexHomeKeys: codexHomeKeys(codexHomes),
        };
        const rows = db.prepare(`SELECT rowid AS __rowid, cache_key, ref, engine, home_key, mtime_ms, candidate_mtime_ms, updated_at, complete, live, summary_json, candidate_json FROM ${CACHE_TABLE}`).all()
            .filter((row) => matchesActiveHome(row, homes));
        if (!rows.length) {
            return 0;
        }
        const signature = rows
            .map((row) => [
            row.__rowid,
            row.cache_key,
            row.ref,
            row.home_key,
            Number(row.candidate_mtime_ms || 0),
            Number(row.mtime_ms || 0),
            Number(row.updated_at || 0),
            Number(row.complete || 0),
            Number(row.live || 0),
        ].join(":"))
            .sort()
            .join("|");
        return Number.parseInt(createHash("sha256").update(signature).digest("hex").slice(0, 12), 16);
    }
    const metaWatermark = Number(getMeta(db, "watermark_mtime_ms", "0")) || 0;
    const row = db.prepare(`SELECT MAX(candidate_mtime_ms) AS candidate_mtime_ms, MAX(mtime_ms) AS mtime_ms FROM ${CACHE_TABLE}`).get();
    return Math.max(metaWatermark, Number(row?.candidate_mtime_ms || 0) || 0, Number(row?.mtime_ms || 0) || 0);
}
