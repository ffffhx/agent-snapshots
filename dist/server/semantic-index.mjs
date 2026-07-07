import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSearchChunks, clampInteger, cosineSimilarity, defaultEmbeddingModel, defaultOllamaBaseUrl, embedTexts, normalizeOllamaBaseUrl, } from "./semantic-search.mjs";
const INDEX_VERSION = 2;
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 48;
const DEFAULT_SCAN_LIMIT = 600;
const MAX_SCAN_LIMIT = 1200;
const DEFAULT_UPDATE_LIMIT = 24;
const MAX_UPDATE_LIMIT = 120;
const MAX_CHUNKS_PER_SESSION = 8;
const EMBED_BATCH_SIZE = 32;
const DEFAULT_MAX_INDEX_SESSIONS = 1200;
let loadedIndex = null;
export async function semanticSearchSessions({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, query, limit = DEFAULT_RESULT_LIMIT, scanLimit = DEFAULT_SCAN_LIMIT, updateLimit = DEFAULT_UPDATE_LIMIT, cwd = "", includeArchived = true, source = "all", completeOnly = true, includeTools = false, includeToolOutput = false, model = defaultEmbeddingModel(), baseUrl = defaultOllamaBaseUrl(), indexPath = defaultSemanticIndexPath(), listSessions, loadSnapshot, embedder = embedTexts, }) {
    const cleanQuery = String(query || "").trim();
    const resultLimit = clampInteger(limit, 1, MAX_RESULT_LIMIT, DEFAULT_RESULT_LIMIT);
    if (!cleanQuery) {
        const embeddingModel = String(model || defaultEmbeddingModel()).trim() || defaultEmbeddingModel();
        const ollamaBaseUrl = normalizeOllamaBaseUrl(baseUrl);
        const resolvedIndexPath = path.resolve(indexPath);
        const sessionScanLimit = clampInteger(scanLimit, 1, MAX_SCAN_LIMIT, DEFAULT_SCAN_LIMIT);
        return emptySemanticSessionSearchResult(cleanQuery, embeddingModel, ollamaBaseUrl, resolvedIndexPath, sessionScanLimit);
    }
    const prepared = await ensureSemanticSessionIndex({
        codexHome,
        claudeHome,
        traeHome,
        traeAppHome,
        traeRecordingsDir,
        scanLimit,
        updateLimit,
        cwd,
        includeArchived,
        source,
        completeOnly,
        includeTools,
        includeToolOutput,
        model,
        baseUrl,
        indexPath,
        listSessions,
        loadSnapshot,
        embedder,
    });
    if (!prepared.searchableEntries.length) {
        return {
            ...emptySemanticSessionSearchResult(cleanQuery, prepared.model, prepared.baseUrl, prepared.indexPath, prepared.scanLimit),
            scanned: prepared.scanned,
            failed: prepared.failed,
            updated: prepared.updated,
            stale: prepared.stale,
            pending: prepared.pending,
        };
    }
    const [queryEmbedding] = await embedder([cleanQuery], { model: prepared.model, baseUrl: prepared.baseUrl });
    const scored = [];
    for (const entry of prepared.searchableEntries) {
        let bestChunk = null;
        let bestScore = -Infinity;
        for (const chunk of entry.chunks) {
            const score = cosineSimilarity(queryEmbedding, chunk.embedding);
            if (score > bestScore) {
                bestScore = score;
                bestChunk = chunk;
            }
        }
        if (bestChunk) {
            scored.push(semanticSessionSearchResult(entry, bestChunk, bestScore));
        }
    }
    scored.sort((a, b) => {
        const score = b.score - a.score;
        if (score) {
            return score;
        }
        return new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime();
    });
    return {
        query: cleanQuery,
        model: prepared.model,
        provider: prepared.provider,
        baseUrl: prepared.baseUrl,
        indexPath: prepared.indexPath,
        scanLimit: prepared.scanLimit,
        scanned: prepared.scanned,
        indexed: prepared.indexed,
        indexedChunks: prepared.indexedChunks,
        matched: scored.length,
        updated: prepared.updated,
        failed: prepared.failed,
        stale: prepared.stale,
        pending: prepared.pending,
        results: scored.slice(0, resultLimit),
    };
}
export async function prewarmSemanticIndex(options) {
    const prepared = await ensureSemanticSessionIndex({
        ...options,
        updateLimit: options.updateLimit ?? MAX_UPDATE_LIMIT,
    });
    return {
        model: prepared.model,
        provider: prepared.provider,
        baseUrl: prepared.baseUrl,
        indexPath: prepared.indexPath,
        scanLimit: prepared.scanLimit,
        scanned: prepared.scanned,
        indexed: prepared.indexed,
        indexedChunks: prepared.indexedChunks,
        updated: prepared.updated,
        failed: prepared.failed,
        stale: prepared.stale,
        pending: prepared.pending,
        complete: prepared.pending === 0,
    };
}
export function defaultSemanticIndexPath() {
    const override = process.env.AGENT_SNAPSHOTS_SEMANTIC_INDEX || process.env.CODEX_SNAPSHOTS_SEMANTIC_INDEX || process.env.SNAPSHOT_SEMANTIC_INDEX;
    if (override) {
        return override;
    }
    const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    return path.join(cacheHome, "agent-snapshots", "semantic-index.v2.json");
}
export async function semanticIndexStatus(indexPath = defaultSemanticIndexPath(), model = defaultEmbeddingModel()) {
    const resolvedIndexPath = path.resolve(indexPath);
    try {
        const raw = await readFile(resolvedIndexPath, "utf8");
        const data = JSON.parse(raw);
        const entries = data && typeof data.entries === "object" && data.entries
            ? Object.keys(data.entries).length
            : 0;
        return {
            path: resolvedIndexPath,
            exists: true,
            available: data.version === INDEX_VERSION && data.provider === "ollama" && data.model === model,
            version: data.version || 0,
            provider: data.provider || "",
            model: data.model || "",
            entries,
            updatedAt: data.updatedAt || "",
            error: "",
        };
    }
    catch (error) {
        const code = error?.code || "";
        return {
            path: resolvedIndexPath,
            exists: false,
            available: false,
            version: 0,
            provider: "",
            model,
            entries: 0,
            updatedAt: "",
            error: code === "ENOENT" ? "" : error instanceof Error ? error.message : String(error),
        };
    }
}
async function ensureSemanticSessionIndex({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, scanLimit = DEFAULT_SCAN_LIMIT, updateLimit = DEFAULT_UPDATE_LIMIT, cwd = "", includeArchived = true, source = "all", completeOnly = true, includeTools = false, includeToolOutput = false, model = defaultEmbeddingModel(), baseUrl = defaultOllamaBaseUrl(), indexPath = defaultSemanticIndexPath(), listSessions, loadSnapshot, embedder = embedTexts, }) {
    const sessionScanLimit = clampInteger(scanLimit, 1, MAX_SCAN_LIMIT, DEFAULT_SCAN_LIMIT);
    const sessionUpdateLimit = clampInteger(updateLimit, 0, MAX_UPDATE_LIMIT, DEFAULT_UPDATE_LIMIT);
    const embeddingModel = String(model || defaultEmbeddingModel()).trim() || defaultEmbeddingModel();
    const ollamaBaseUrl = normalizeOllamaBaseUrl(baseUrl);
    const resolvedIndexPath = path.resolve(indexPath);
    const optionsKey = semanticIndexOptionsKey({ includeTools, includeToolOutput });
    const sessions = await listSessions({
        codexHome,
        claudeHome,
        traeHome,
        traeAppHome,
        traeRecordingsDir,
        limit: sessionScanLimit,
        cwd,
        includeArchived,
        source,
        completeOnly,
    });
    const index = await readSemanticIndex(resolvedIndexPath, embeddingModel);
    let updated = 0;
    let failed = 0;
    let stale = 0;
    for (const session of sessions) {
        const ref = sessionRef(session);
        if (!ref) {
            failed += 1;
            continue;
        }
        const key = semanticIndexEntryKey(session, ref, optionsKey);
        const fingerprint = semanticSessionFingerprint(session, optionsKey);
        const existing = index.entries[key];
        if (existing?.fingerprint === fingerprint) {
            continue;
        }
        stale += 1;
        if (updated >= sessionUpdateLimit) {
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
            const chunks = buildSearchChunks(snapshot, { maxChunks: MAX_CHUNKS_PER_SESSION });
            const vectors = await embedChunkTexts(chunks, { model: embeddingModel, baseUrl: ollamaBaseUrl }, embedder);
            index.entries[key] = {
                ref,
                fingerprint,
                optionsKey,
                indexedAt: new Date().toISOString(),
                summary: semanticSummary(session, ref),
                chunks: chunks.map((chunk, index) => ({
                    ...chunk,
                    textHash: hashText(chunk.text),
                    embedding: compactVector(vectors[index] || []),
                })),
            };
            updated += 1;
        }
        catch {
            failed += 1;
        }
    }
    if (updated) {
        pruneSemanticIndex(index);
        await writeSemanticIndex(resolvedIndexPath, index);
    }
    const searchableEntries = sessions
        .map((session) => {
        const ref = sessionRef(session);
        return ref ? index.entries[semanticIndexEntryKey(session, ref, optionsKey)] : null;
    })
        .filter((entry) => Boolean(entry));
    const indexedChunks = searchableEntries.reduce((total, entry) => total + entry.chunks.length, 0);
    return {
        model: embeddingModel,
        provider: "ollama",
        baseUrl: ollamaBaseUrl,
        indexPath: resolvedIndexPath,
        scanLimit: sessionScanLimit,
        scanned: sessions.length,
        indexed: searchableEntries.length,
        indexedChunks,
        updated,
        failed,
        stale,
        pending: Math.max(0, stale - updated),
        searchableEntries,
    };
}
async function embedChunkTexts(chunks, options, embedder) {
    const vectors = [];
    for (let index = 0; index < chunks.length; index += EMBED_BATCH_SIZE) {
        vectors.push(...await embedder(chunks.slice(index, index + EMBED_BATCH_SIZE).map((chunk) => chunk.text), options));
    }
    return vectors;
}
async function readSemanticIndex(indexPath, model) {
    if (loadedIndex?.path === indexPath && loadedIndex.data.model === model) {
        return loadedIndex.data;
    }
    let data = null;
    try {
        const raw = await readFile(indexPath, "utf8");
        data = JSON.parse(raw);
    }
    catch {
        data = null;
    }
    if (!data || data.version !== INDEX_VERSION || data.model !== model || data.provider !== "ollama" || !data.entries) {
        data = {
            version: INDEX_VERSION,
            model,
            provider: "ollama",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            entries: {},
        };
    }
    loadedIndex = { path: indexPath, data };
    return data;
}
async function writeSemanticIndex(indexPath, data) {
    data.updatedAt = new Date().toISOString();
    loadedIndex = { path: indexPath, data };
    await mkdir(path.dirname(indexPath), { recursive: true });
    const tempPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(data), "utf8");
    await rename(tempPath, indexPath);
}
function semanticSessionSearchResult(entry, chunk, score) {
    const summary = entry.summary;
    return {
        id: summary.id || entry.ref,
        ref: entry.ref,
        title: summary.title || entry.ref,
        engine: summary.engine || "codex",
        engineLabel: summary.engineLabel || "Codex",
        sourceDetail: summary.sourceDetail || "",
        cwd: summary.cwd || "",
        displayCwd: summary.displayCwd || summary.cwd || "",
        mtime: summary.mtime || "",
        createdAt: summary.createdAt || "",
        projectKind: summary.projectKind || "",
        codexHomeKey: summary.codexHomeKey || "",
        codexHomeLabel: summary.codexHomeLabel || "",
        score: Math.round(score * 1000) / 1000,
        role: chunk.role,
        label: chunk.label,
        turn: chunk.turn,
        timestamp: chunk.timestamp,
        snippet: chunk.snippet,
        sourceLabel: chunk.sourceLabel,
        indexedAt: entry.indexedAt,
        session: summary,
    };
}
function semanticSummary(session, ref) {
    return {
        id: session.id || ref,
        ref,
        title: session.title || ref,
        engine: session.engine || "codex",
        engineLabel: session.engineLabel || "Codex",
        sourceDetail: session.sourceDetail || "",
        cwd: session.cwd || "",
        displayCwd: session.displayCwd || session.cwd || "",
        mtime: session.mtime || "",
        createdAt: session.createdAt || "",
        projectKind: session.projectKind || "",
        codexHomeKey: session.codexHomeKey || "",
        codexHomeLabel: session.codexHomeLabel || "",
    };
}
function sessionRef(session) {
    if (session.ref) {
        return session.ref;
    }
    if (session.id) {
        return `${session.engine || "codex"}:${session.id}`;
    }
    return "";
}
function semanticIndexOptionsKey({ includeTools, includeToolOutput }) {
    return [
        "redacted",
        includeTools || includeToolOutput ? "tools" : "messages",
        includeToolOutput ? "tool-output" : "tool-meta",
    ].join(":");
}
function semanticIndexEntryKey(session, ref, optionsKey) {
    return hashText(`${optionsKey}\0${sessionHomeKey(session)}\0${ref}`);
}
function semanticSessionFingerprint(session, optionsKey) {
    return hashText(JSON.stringify({
        ref: sessionRef(session),
        homeKey: sessionHomeKey(session),
        title: session.title || "",
        mtime: session.mtime || "",
        cwd: session.cwd || "",
        sourceDetail: session.sourceDetail || "",
        optionsKey,
    }));
}
function sessionHomeKey(session) {
    return String(session.codexHomeKey || "");
}
function hashText(value) {
    return createHash("sha256").update(value).digest("hex");
}
function compactVector(vector) {
    return vector.map((value) => Number(Number(value || 0).toFixed(6)));
}
function pruneSemanticIndex(index) {
    const limit = clampInteger(process.env.AGENT_SNAPSHOTS_SEMANTIC_INDEX_LIMIT || process.env.CODEX_SNAPSHOTS_SEMANTIC_INDEX_LIMIT || DEFAULT_MAX_INDEX_SESSIONS, 100, 5000, DEFAULT_MAX_INDEX_SESSIONS);
    const groups = new Map();
    for (const entry of Object.entries(index.entries)) {
        const optionsKey = entry[1].optionsKey || "unknown";
        const group = groups.get(optionsKey);
        if (group) {
            group.push(entry);
        }
        else {
            groups.set(optionsKey, [entry]);
        }
    }
    for (const entries of groups.values()) {
        if (entries.length <= limit) {
            continue;
        }
        entries
            .sort(([, left], [, right]) => new Date(right.summary.mtime || right.indexedAt || 0).getTime() - new Date(left.summary.mtime || left.indexedAt || 0).getTime())
            .slice(limit)
            .forEach(([key]) => delete index.entries[key]);
    }
}
function emptySemanticSessionSearchResult(query, model, baseUrl, indexPath, scanLimit) {
    return {
        query,
        model,
        provider: "ollama",
        baseUrl,
        indexPath,
        scanLimit,
        scanned: 0,
        indexed: 0,
        indexedChunks: 0,
        matched: 0,
        updated: 0,
        failed: 0,
        stale: 0,
        pending: 0,
        results: [],
    };
}
