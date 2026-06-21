// @ts-nocheck
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { addImageRisk, addRisks, detectRisks, redactText, severityRank } from "../core/privacy.js";
import { renderMarkdownHtml } from "../renderers/markdown.mjs";
import { stripAppDirectives as stripCodexAppDirectives } from "../shared/sanitize.js";
const MAX_TEXT_CHARS = 20000;
const MAX_TURNS = 5000;
const MAX_SUMMARY_LINES = 140;
const TOOL_OUTPUT_PREVIEW_CHARS = 24000;
const MAX_INLINE_IMAGE_CHARS = 5_000_000;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_SCAN_LIMIT = 600;
const MAX_SEARCH_TEXT_CHARS = 180_000;
const MAX_SEARCH_SEGMENT_CHARS = 60_000;
const SEARCH_SNIPPET_CHARS = 280;
const execFileAsync = promisify(execFile);
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
export async function listSessions({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, limit, cwd, includeArchived, source = "codex", completeOnly = false }) {
    if (source === "all") {
        // allSettled so a failure in one engine's discovery never blanks the
        // sessions from the others.
        const [codexSessions, claudeSessions, traeSessions] = (await Promise.allSettled([
            listCodexSessions({ codexHome, limit, cwd, includeArchived }),
            listClaudeSessions({ claudeHome, limit, cwd }),
            listTraeSessions({ traeHome, traeAppHome, traeRecordingsDir, limit, cwd }),
        ])).map((result) => (result.status === "fulfilled" ? result.value : []));
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
export async function searchSessions({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, query, limit = DEFAULT_SEARCH_LIMIT, scanLimit = DEFAULT_SEARCH_SCAN_LIMIT, cwd = "", includeArchived = true, source = "all", completeOnly = true, includeTools = false, includeToolOutput = false, }) {
    const cleanQuery = String(query || "").trim();
    const normalizedQuery = foldSearchText(cleanQuery);
    const terms = searchTerms(cleanQuery);
    const resultLimit = positiveIntegerOrDefault(limit, DEFAULT_SEARCH_LIMIT);
    const sessionScanLimit = positiveIntegerOrDefault(scanLimit, DEFAULT_SEARCH_SCAN_LIMIT);
    if (!normalizedQuery || !terms.length) {
        return {
            query: cleanQuery,
            terms: [],
            scanned: 0,
            matched: 0,
            failed: 0,
            scanLimit: sessionScanLimit,
            results: [],
        };
    }
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
    const results = [];
    let failed = 0;
    for (const session of sessions) {
        try {
            const document = await readSearchDocument(session, {
                codexHome,
                claudeHome,
                traeHome,
                traeAppHome,
                traeRecordingsDir,
                includeTools,
                includeToolOutput,
            });
            const match = matchSearchDocument(document, cleanQuery, normalizedQuery, terms);
            if (match) {
                results.push(match);
            }
        }
        catch {
            failed += 1;
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
        scanned: sessions.length,
        matched: results.length,
        failed,
        scanLimit: sessionScanLimit,
        results: results.slice(0, resultLimit),
    };
}
function filterSessionCompleteness(sessions, completeOnly) {
    return completeOnly ? sessions.filter((summary) => isCompleteSessionSummary(summary)) : sessions;
}
async function readSearchDocument(summary, options) {
    const segments = await readSearchSegments(summary, options);
    return {
        summary,
        fields: [
            summary.title,
            summary.engineLabel,
            summary.engine,
            summary.sourceDetail,
            summary.cwd,
            summary.displayCwd,
            summary.id,
            summary.ref,
        ].filter(Boolean).map(String),
        segments,
    };
}
async function readSearchSegments(summary, options) {
    if (summary.engine === "claude") {
        return readClaudeSearchSegments(summary, options);
    }
    if (summary.engine === "trae") {
        return readTraeSearchSegments(summary, options);
    }
    return readCodexSearchSegments(summary, options);
}
async function readCodexSearchSegments(summary, { includeTools, includeToolOutput }) {
    const segments = [];
    let turnNumber = 0;
    let totalChars = 0;
    for await (const row of readJsonl(summary.filePath)) {
        if (row.type !== "response_item" || !row.payload) {
            continue;
        }
        const item = row.payload;
        if (item.type === "message") {
            if (item.role !== "user" && item.role !== "assistant") {
                continue;
            }
            const rawText = stripCodexAppDirectives(extractMessageParts(item).text);
            if (isBootstrapUserMessage(item.role, rawText) || !rawText.trim()) {
                continue;
            }
            turnNumber += 1;
            totalChars += pushSearchSegment(segments, {
                role: item.role,
                label: item.role === "user" ? "User" : "Assistant",
                turn: turnNumber,
                text: rawText,
                timestamp: row.timestamp || "",
            });
        }
        else if (includeTools && isToolPayload(item)) {
            const rawText = renderToolText(item, includeToolOutput);
            totalChars += pushSearchSegment(segments, {
                role: "tool",
                label: toolName(item),
                turn: turnNumber || 1,
                text: rawText,
                timestamp: row.timestamp || "",
            });
        }
        if (totalChars >= MAX_SEARCH_TEXT_CHARS) {
            break;
        }
    }
    return segments;
}
async function readClaudeSearchSegments(summary, { claudeHome, includeTools, includeToolOutput }) {
    if (summary.sourceKind === "history") {
        const groups = await readClaudeHistoryGroups(claudeHome);
        const group = groups.find((item) => item.id === summary.id || item.id.startsWith(summary.id));
        return (group?.entries || []).map((row, index) => ({
            role: "user",
            label: "User",
            turn: index + 1,
            text: stripCodexAppDirectives(row.display || ""),
            timestamp: normalizeClaudeTimestamp(row.timestamp),
        })).filter((segment) => segment.text.trim());
    }
    const segments = [];
    let turnNumber = 0;
    let totalChars = 0;
    for await (const row of readJsonl(summary.filePath)) {
        const role = claudeRole(row);
        if (!role) {
            continue;
        }
        const message = extractClaudeMessageParts(row.message || row);
        const rawText = stripCodexAppDirectives(message.text);
        if (rawText.trim()) {
            turnNumber += 1;
            totalChars += pushSearchSegment(segments, {
                role,
                label: role === "user" ? "User" : "Assistant",
                turn: turnNumber,
                text: rawText,
                timestamp: normalizeClaudeTimestamp(row.timestamp),
            });
        }
        if (includeTools) {
            for (const tool of message.toolCalls) {
                totalChars += pushSearchSegment(segments, {
                    role: "tool",
                    label: tool.name,
                    turn: turnNumber || 1,
                    text: tool.text,
                    timestamp: normalizeClaudeTimestamp(row.timestamp),
                });
            }
            for (const tool of message.toolResults) {
                totalChars += pushSearchSegment(segments, {
                    role: "tool",
                    label: tool.name,
                    turn: turnNumber || 1,
                    text: includeToolOutput ? tool.text : "",
                    timestamp: normalizeClaudeTimestamp(row.timestamp),
                });
            }
        }
        if (totalChars >= MAX_SEARCH_TEXT_CHARS) {
            break;
        }
    }
    return segments;
}
async function readTraeSearchSegments(summary, { includeTools, includeToolOutput }) {
    if (summary.sourceKind === "recorded") {
        const allRecords = await readTraeCaptureRecords(summary.filePath);
        const records = summary.recordGroupId
            ? allRecords.filter((record) => {
                const key = safeCaptureId(record.domThreadId || record.captureSessionId || record.actualSessionId || record.pageSession || "");
                return key === summary.recordGroupId;
            })
            : allRecords;
        const { turns } = buildTraeRecordedTurns(records, { redact: false });
        return turns.map((turn) => ({
            role: turn.role,
            label: turn.role === "user" ? "User" : "Assistant",
            turn: turn.turn,
            text: turn.text || "",
            timestamp: turn.timestamp || "",
        })).filter((segment) => segment.text.trim());
    }
    if (summary.sourceKind === "input-history") {
        const entries = await readTraeInputHistoryEntries(summary.filePath);
        return entries.map((entry, index) => ({
            role: "user",
            label: "User",
            turn: index + 1,
            text: stripCodexAppDirectives(traeInputEntryText(entry)),
            timestamp: "",
        })).filter((segment) => segment.text.trim());
    }
    const segments = [];
    let turnNumber = 0;
    let totalChars = 0;
    for (const filePath of summary.filePaths || [summary.filePath]) {
        for await (const row of readJsonl(filePath)) {
            const rawText = stripCodexAppDirectives(renderTraeMemoryText(row));
            if (!rawText.trim()) {
                continue;
            }
            turnNumber += 1;
            totalChars += pushSearchSegment(segments, {
                role: "assistant",
                label: "Memory",
                turn: turnNumber,
                text: rawText,
                timestamp: normalizeTraeTimestamp(row.message_summary_time),
            });
            if (totalChars >= MAX_SEARCH_TEXT_CHARS) {
                return segments;
            }
        }
    }
    return segments;
}
function pushSearchSegment(segments, segment) {
    const text = trimSearchSegment(segment.text);
    if (!text) {
        return 0;
    }
    segments.push({
        role: segment.role || "",
        label: segment.label || "",
        turn: segment.turn || 0,
        text,
        timestamp: segment.timestamp || "",
    });
    return text.length;
}
function trimSearchSegment(text) {
    const clean = String(text || "").replace(/\u0000/g, "").trim();
    if (!clean) {
        return "";
    }
    return clean.length > MAX_SEARCH_SEGMENT_CHARS ? clean.slice(0, MAX_SEARCH_SEGMENT_CHARS) : clean;
}
function matchSearchDocument(document, rawQuery, normalizedQuery, terms) {
    const summary = document.summary;
    const fieldText = document.fields.join("\n");
    const searchableText = foldSearchText([fieldText, ...document.segments.map((segment) => segment.text)].join("\n"));
    if (!searchableText || !searchTextMatches(searchableText, normalizedQuery, terms)) {
        return null;
    }
    const fieldScore = searchScore(fieldText, normalizedQuery, terms) * 2.4;
    let bestSegment = null;
    let bestSegmentScore = 0;
    for (const segment of document.segments) {
        const score = searchScore(segment.text, normalizedQuery, terms);
        if (score > bestSegmentScore) {
            bestSegmentScore = score;
            bestSegment = segment;
        }
    }
    const snippetSource = bestSegment && bestSegmentScore >= fieldScore / 2
        ? bestSegment.text
        : fieldText || bestSegment?.text || summary.title || "";
    const score = fieldScore + bestSegmentScore + recencySearchBoost(summary.mtime);
    return {
        id: summary.id,
        ref: summary.ref || `${summary.engine || "codex"}:${summary.id}`,
        title: summary.title || summary.id,
        engine: summary.engine || "codex",
        engineLabel: summary.engineLabel || "Codex",
        sourceDetail: summary.sourceDetail || "",
        cwd: summary.cwd || "",
        displayCwd: summary.displayCwd || summary.cwd || "",
        mtime: summary.mtime || "",
        createdAt: summary.createdAt || "",
        projectKind: summary.projectKind || "",
        score: Math.round(score * 100) / 100,
        role: bestSegment?.role || "metadata",
        label: bestSegment?.label || "Metadata",
        turn: bestSegment?.turn || 0,
        timestamp: bestSegment?.timestamp || "",
        snippet: redactText(makeSearchSnippet(snippetSource, rawQuery, terms)),
        terms,
        session: summary,
    };
}
function searchTextMatches(foldedText, normalizedQuery, terms) {
    return foldedText.includes(normalizedQuery) || terms.every((term) => foldedText.includes(term));
}
function searchScore(text, normalizedQuery, terms) {
    const folded = foldSearchText(text);
    if (!folded) {
        return 0;
    }
    let score = 0;
    if (normalizedQuery && folded.includes(normalizedQuery)) {
        score += 18 + normalizedQuery.length / 2;
    }
    for (const term of terms) {
        const count = countFoldedOccurrences(folded, term);
        if (count) {
            score += 4 + Math.min(20, count * Math.max(1, term.length / 3));
        }
    }
    return score;
}
function recencySearchBoost(value) {
    const time = new Date(value || 0).getTime();
    if (!Number.isFinite(time)) {
        return 0;
    }
    const ageDays = Math.max(0, (Date.now() - time) / (24 * 60 * 60 * 1000));
    return Math.max(0, 6 - Math.log2(ageDays + 1));
}
function countFoldedOccurrences(text, term) {
    if (!term) {
        return 0;
    }
    let count = 0;
    let index = 0;
    while (index < text.length) {
        const found = text.indexOf(term, index);
        if (found < 0) {
            break;
        }
        count += 1;
        index = found + Math.max(1, term.length);
    }
    return count;
}
function makeSearchSnippet(text, rawQuery, terms) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= SEARCH_SNIPPET_CHARS) {
        return clean;
    }
    const folded = clean.toLocaleLowerCase();
    const needles = uniqueStrings([String(rawQuery || "").trim().toLocaleLowerCase(), ...terms])
        .filter((term) => term.length >= 2 || /[\u4e00-\u9fff]/.test(term));
    const matchIndex = needles
        .map((term) => folded.indexOf(term))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0] ?? 0;
    const half = Math.floor(SEARCH_SNIPPET_CHARS / 2);
    const start = Math.max(0, matchIndex - half);
    const end = Math.min(clean.length, start + SEARCH_SNIPPET_CHARS);
    return `${start > 0 ? "..." : ""}${clean.slice(start, end)}${end < clean.length ? "..." : ""}`;
}
function foldSearchText(value) {
    return String(value || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}
function searchTerms(query) {
    const normalized = foldSearchText(query);
    if (!normalized) {
        return [];
    }
    const terms = normalized.split(/\s+/).filter(Boolean);
    return uniqueStrings(terms.length ? terms : [normalized]).slice(0, 12);
}
function positiveIntegerOrDefault(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
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
        let summary;
        try {
            summary = await scanSessionSummary(fileInfo.filePath, fileInfo, titleIndex);
        }
        catch {
            // A single unreadable/corrupt session must not abort the whole listing;
            // surface it as a placeholder so it stays visible but degraded.
            summary = fallbackCodexSummary(fileInfo);
        }
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
async function collectJsonlFiles(dir, files, options = {}) {
    const { skipDirNames, skipFile } = options;
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (skipDirNames && skipDirNames.has(entry.name)) {
                return;
            }
            await collectJsonlFiles(entryPath, files, options);
            return;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
            return;
        }
        if (skipFile && skipFile(entry.name)) {
            return;
        }
        let info;
        try {
            info = await stat(entryPath);
        }
        catch {
            // File vanished or became unreadable between readdir and stat
            // (TOCTOU); skip it rather than rejecting the whole batch.
            return;
        }
        files.push({
            filePath: entryPath,
            size: info.size,
            mtimeMs: info.mtimeMs,
            mtime: info.mtime.toISOString(),
        });
    }));
}
async function readTitleIndex(codexHome) {
    const indexPath = path.join(codexHome, "session_index.jsonl");
    const map = new Map();
    let raw = "";
    try {
        raw = await readFile(indexPath, "utf8");
    }
    catch {
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
        }
        catch {
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
function fallbackCodexSummary(fileInfo) {
    const id = sessionIdFromPath(fileInfo.filePath);
    return {
        id,
        title: "(unreadable Codex session)",
        cwd: "",
        filePath: fileInfo.filePath,
        size: fileInfo.size,
        mtime: fileInfo.mtime,
        createdAt: "",
        modelProvider: "",
        source: "",
        messageCount: 0,
        toolCallCount: 0,
        riskCount: 0,
        engine: "codex",
        engineLabel: "Codex",
        projectKind: "none",
        ref: `codex:${id}`,
        displayCwd: "",
        displayFilePath: redactText(fileInfo.filePath || ""),
        parseError: true,
    };
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
export async function loadSnapshot(ref, { codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, includeTools, includeToolOutput, redact }) {
    const target = splitSnapshotRef(ref);
    let snapshot;
    if (target.engine === "claude") {
        snapshot = await loadClaudeSnapshot(target.ref, {
            claudeHome,
            includeTools,
            includeToolOutput,
            redact,
        });
    }
    else if (target.engine === "trae") {
        snapshot = await loadTraeSnapshot(target.ref, {
            traeHome,
            traeAppHome,
            traeRecordingsDir,
            includeTools,
            includeToolOutput,
            redact,
        });
    }
    else {
        snapshot = await loadCodexSnapshot(target.ref, {
            codexHome,
            includeTools,
            includeToolOutput,
            redact,
        });
    }
    // The session title is derived from the first user prompt, so a secret pasted
    // into that prompt would otherwise ride through verbatim (the snapshot spreads
    // the raw summary). Redact it — and the goal objective — at the one chokepoint
    // every engine and sub-variant flows through, so exports and publishes are safe.
    if (snapshot && redact) {
        if (typeof snapshot.title === "string") {
            snapshot.title = redactText(snapshot.title);
        }
        if (typeof snapshot.goalObjective === "string") {
            snapshot.goalObjective = redactText(snapshot.goalObjective);
        }
    }
    return snapshot;
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
    let goalObjective = "";
    let tokenUsage = null;
    let truncated = false;
    for await (const row of readJsonl(filePath)) {
        tokenUsage = extractCodexTokenUsage(row) || tokenUsage;
        if (turns.length >= MAX_TURNS) {
            truncated = true;
            break;
        }
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
            const internalGoalObjective = extractInternalGoalObjective(rawMessageText);
            if (internalGoalObjective) {
                goalObjective = internalGoalObjective;
                continue;
            }
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
        goalObjective: redact ? redactText(goalObjective) : goalObjective,
        displayCwd: redact ? redactText(summary.cwd || "") : summary.cwd,
        displayFilePath: redact ? redactText(summary.filePath || "") : summary.filePath,
        generatedAt: new Date().toISOString(),
        redacted: redact,
        includeTools,
        includeToolOutput,
        tokenUsage,
        notices: truncated ? [truncationNotice()] : [],
        risks: [...risks.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
        turns,
    };
}
function truncationNotice() {
    return {
        severity: "medium",
        label: "Truncated",
        text: `This session is very large; only the first ${MAX_TURNS} entries are shown.`,
    };
}
function extractCodexTokenUsage(row) {
    if (row?.type !== "event_msg" || row.payload?.type !== "token_count") {
        return null;
    }
    const total = row.payload.info?.total_token_usage;
    if (!total || typeof total !== "object") {
        return null;
    }
    const inputTokens = tokenNumber(total.input_tokens);
    const cachedInputTokens = tokenNumber(total.cached_input_tokens);
    const outputTokens = tokenNumber(total.output_tokens);
    const reasoningOutputTokens = tokenNumber(total.reasoning_output_tokens);
    const totalTokens = tokenNumber(total.total_tokens) || inputTokens + outputTokens;
    if (!totalTokens && !inputTokens && !outputTokens && !cachedInputTokens && !reasoningOutputTokens) {
        return null;
    }
    return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
        updatedAt: row.timestamp || "",
    };
}
function tokenNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
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
        if (summary.isSubagent) {
            continue;
        }
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
// Claude Code writes subagent transcripts, workflow journals, and tool-result
// dumps into nested folders alongside the real session transcript (for example
// `<project>/<session-id>/subagents/.../agent-*.jsonl` and `journal.jsonl`).
// Those are internal artifacts of a parent session, not standalone sessions, so
// they must not be discovered as their own entries.
const CLAUDE_ARTIFACT_DIR_NAMES = new Set(["subagents", "workflows", "tool-results", "memory"]);
function isClaudeArtifactFileName(name) {
    return /^agent-[0-9a-f]+\.jsonl$/i.test(name) || name === "journal.jsonl";
}
async function discoverClaudeSessionFiles(claudeHome) {
    const roots = [path.join(claudeHome, "projects"), path.join(claudeHome, "sessions")];
    const files = [];
    for (const root of roots) {
        await collectJsonlFiles(root, files, {
            skipDirNames: CLAUDE_ARTIFACT_DIR_NAMES,
            skipFile: isClaudeArtifactFileName,
        });
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
    let firstUserAny = "";
    let aiTitle = "";
    let summaryTitle = "";
    let lineCount = 0;
    for await (const row of readJsonl(filePath)) {
        lineCount += 1;
        if (row.sessionId) {
            summary.id = row.sessionId;
        }
        if (row.cwd) {
            summary.cwd = row.cwd;
        }
        if (row.isSidechain === true) {
            summary.isSubagent = true;
        }
        if (!aiTitle && row.type === "ai-title" && row.aiTitle) {
            aiTitle = truncateForTitle(String(row.aiTitle));
        }
        if (!summaryTitle && row.type === "summary" && row.summary) {
            summaryTitle = truncateForTitle(String(row.summary));
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
            if (role === "user") {
                const candidate = rawText ? truncateForTitle(rawText) : "[image]";
                if (!firstUserAny) {
                    firstUserAny = candidate;
                }
                if (!firstUser && !isClaudeCommand(rawText)) {
                    firstUser = candidate;
                }
            }
            summary.riskCount += detectRisks(rawText).length;
            if (message.images.length) {
                summary.riskCount += 1;
            }
        }
        for (const tool of message.toolCalls) {
            summary.riskCount += detectRisks(tool.text).length;
        }
        if (summary.id && summary.cwd && aiTitle && firstUser && lineCount >= 12) {
            break;
        }
        if (lineCount >= MAX_SUMMARY_LINES) {
            break;
        }
    }
    summary.title = aiTitle || firstUser || summaryTitle || firstUserAny || summary.id;
    return finishClaudeSummary(summary);
}
async function readClaudeHistoryGroups(claudeHome, excludeIds = new Set()) {
    const historyPath = path.join(claudeHome, "history.jsonl");
    let info;
    try {
        info = await stat(historyPath);
    }
    catch {
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
        if (!group.firstDisplay) {
            group.firstDisplay = truncateForTitle(display);
        }
        if (!group.title && !isClaudeCommand(display)) {
            group.title = truncateForTitle(display);
        }
    }
    return [...groups.values()].map((group) => finishClaudeSummary({
        ...group,
        title: group.title || group.firstDisplay || group.id,
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
async function buildClaudeTurns(filePath, { includeTools, includeToolOutput, redact }) {
    const risks = new Map();
    const turns = [];
    let turnNumber = 0;
    let truncated = false;
    for await (const row of readJsonl(filePath)) {
        if (turns.length >= MAX_TURNS) {
            truncated = true;
            break;
        }
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
                const toolTurn = {
                    kind: "tool",
                    role: "tool",
                    turn: turnNumber || 1,
                    name: tool.name,
                    text: redact ? redactText(tool.text) : tool.text,
                    timestamp: normalizeClaudeTimestamp(row.timestamp),
                };
                if (tool.id) {
                    toolTurn.toolUseId = tool.id;
                }
                turns.push(toolTurn);
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
    return { turns, risks, turnNumber, truncated };
}
// Parse the Task/Agent subagent transcripts that live under
// `<dir>/<parentSessionId>/subagents/**/agent-*.jsonl` so they can be shown
// nested under the parent session instead of as standalone sessions. Each one
// is linked back to the parent's tool_use via the sibling .meta.json toolUseId.
async function loadClaudeSubagents(parentFilePath, parentSessionId, { includeTools, includeToolOutput, redact }) {
    if (!parentSessionId) {
        return [];
    }
    const root = path.join(path.dirname(parentFilePath), parentSessionId, "subagents");
    const files = [];
    await collectJsonlFiles(root, files, {
        skipFile: (name) => !/^agent-[0-9a-f]+\.jsonl$/i.test(name),
    });
    if (!files.length) {
        return [];
    }
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const subagents = [];
    let order = 0;
    for (const fileInfo of files) {
        let meta = {};
        try {
            meta = JSON.parse(await readFile(fileInfo.filePath.replace(/\.jsonl$/, ".meta.json"), "utf8"));
        }
        catch {
            meta = {};
        }
        const { turns } = await buildClaudeTurns(fileInfo.filePath, { includeTools, includeToolOutput, redact });
        if (!turns.length) {
            continue;
        }
        order += 1;
        const firstUser = turns.find((turn) => turn.kind === "message" && turn.role === "user");
        const rawDescription = String(meta.description || "").trim() || (firstUser ? truncateForTitle(firstUser.text) : "");
        const description = redact ? redactText(rawDescription) : rawDescription;
        subagents.push({
            order,
            agentId: path.basename(fileInfo.filePath, ".jsonl").replace(/^agent-/, ""),
            toolUseId: String(meta.toolUseId || ""),
            agentType: String(meta.agentType || ""),
            description,
            label: description || ("子代理 " + order),
            messageCount: turns.filter((turn) => turn.kind === "message").length,
            toolCallCount: turns.filter((turn) => turn.kind === "tool").length,
            turns,
        });
    }
    return subagents;
}
async function loadClaudeFileSnapshot(filePath, { claudeHome, includeTools, includeToolOutput, redact }) {
    const fileInfo = await stat(filePath);
    const summary = await scanClaudeFileSessionSummary(filePath, {
        filePath,
        size: fileInfo.size,
        mtimeMs: fileInfo.mtimeMs,
        mtime: fileInfo.mtime.toISOString(),
    }, claudeHome);
    const { turns, risks, truncated } = await buildClaudeTurns(filePath, { includeTools, includeToolOutput, redact });
    const subagents = await loadClaudeSubagents(filePath, summary.id, { includeTools, includeToolOutput, redact });
    return {
        ...summary,
        displayCwd: redact ? redactText(summary.cwd || "") : summary.cwd,
        displayFilePath: redact ? redactText(summary.filePath || "") : summary.filePath,
        generatedAt: new Date().toISOString(),
        redacted: redact,
        includeTools,
        includeToolOutput,
        notices: truncated ? [truncationNotice()] : [],
        risks: [...risks.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
        turns,
        subagents,
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
        await assertRealPathInsideHome(maybePath, claudeHome, "Claude Code");
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
    }
    else if (Array.isArray(content)) {
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
                    id: item.id || "",
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
    let trimmed = String(text || "").trim();
    // stripAppDirectives renders slash commands as a backtick-wrapped `/clear`,
    // so unwrap surrounding backticks before testing.
    const fenced = trimmed.match(/^`+\s*([^`]+?)\s*`+$/);
    if (fenced) {
        trimmed = fenced[1].trim();
    }
    if (!trimmed.startsWith("/")) {
        return false;
    }
    // A real slash command is a single bare token such as /clear or /compact,
    // not a filesystem path like /Users/foo/bar.doc that merely starts with /.
    const firstToken = trimmed.split(/\s+/)[0];
    return /^\/[a-zA-Z][\w-]*$/.test(firstToken);
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
            }
            else {
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
    }
    catch {
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
        }
        else if (child && typeof child === "object") {
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
    }
    catch {
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
        }
        catch {
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
    }
    catch {
        return "";
    }
    try {
        const workspace = JSON.parse(raw);
        return decodeFileUrlPath(workspace.folder || workspace.workspace || "");
    }
    catch {
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
        }
        catch {
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
    }
    catch {
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
    }
    catch {
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
            await assertRealPathInsideHome(maybePath, traeRecordingsDir, "Trae");
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
        await assertRealPathInsideHome(maybePath, traeHome, "Trae");
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
        await assertRealPathInsideHome(maybePath, codexHome, "Codex");
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
// The textual assertInsideHome check can be defeated by a symlink planted inside
// the home dir that points outside it (e.g. ~/.codex/x.jsonl -> ~/.ssh/id_rsa),
// because createReadStream follows symlinks. Resolve the real path of both the
// file and the home root and re-check, so a request can never read a file whose
// canonical location is outside the home directory.
async function assertRealPathInsideHome(filePath, home, label) {
    let realFile;
    try {
        realFile = await realpath(filePath);
    }
    catch {
        throw new Error(`${label} session file not found`);
    }
    let realHome;
    try {
        realHome = await realpath(path.resolve(home));
    }
    catch {
        realHome = path.resolve(home);
    }
    const relative = path.relative(realHome, realFile);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`JSONL paths must live inside the ${label} home directory`);
    }
    return realFile;
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
            }
            catch {
                yield { type: "parse_error", payload: { lineLength: line.length } };
            }
        }
    }
    finally {
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
    // `content` is normally an array, but a malformed row can carry a string,
    // object, number, or null. Coerce defensively so one bad line never throws a
    // TypeError that rejects the whole session listing.
    const rawContent = item?.content;
    const contentList = Array.isArray(rawContent)
        ? rawContent
        : typeof rawContent === "string"
            ? [{ text: rawContent }]
            : [];
    for (const content of contentList) {
        if (!content || typeof content !== "object") {
            continue;
        }
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
    return role === "user" && (text.startsWith("# AGENTS.md instructions for ") ||
        text.includes("<environment_context>") ||
        isInternalCodexContextMessage(text));
}
function isInternalCodexContextMessage(text) {
    const value = String(text || "").trim();
    return /^<goal_context>\s*[\s\S]*<\/goal_context>\s*$/i.test(value);
}
function extractInternalGoalObjective(text) {
    const value = String(text || "").trim();
    if (!isInternalCodexContextMessage(value)) {
        return "";
    }
    const match = value.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/i);
    return match ? trimLongText(match[1].trim(), MAX_TEXT_CHARS) : "";
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
export { detectRisks, redactText } from "../core/privacy.js";
