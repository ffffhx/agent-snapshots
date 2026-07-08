// @ts-nocheck
import { createReadStream } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { addImageRisk, addRisks, detectRisks, redactText, severityRank } from "../core/privacy.js";
import { renderMarkdownHtml } from "../renderers/markdown.mjs";
import { stripAppDirectives as stripCodexAppDirectives } from "../shared/sanitize.js";
import { extractClaudeToolFileChanges, extractCodexToolFileChanges, rawFileChangeText, redactFileChanges, } from "./file-changes.mjs";
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
export async function listSessions({ codexHome, claudeHome, limit, cwd, includeArchived, source = "codex", completeOnly = false }) {
    if (source === "all") {
        // allSettled so a failure in one engine's discovery never blanks the
        // sessions from the others.
        const [codexSessions, claudeSessions] = (await Promise.allSettled([
            listCodexSessions({ codexHome, limit, cwd, includeArchived }),
            listClaudeSessions({ claudeHome, limit, cwd }),
        ])).map((result) => (result.status === "fulfilled" ? result.value : []));
        const sessions = [...codexSessions, ...claudeSessions]
            .filter((summary) => !completeOnly || isCompleteSessionSummary(summary))
            .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
        return Number.isFinite(limit) ? sessions.slice(0, limit) : sessions;
    }
    if (source === "claude") {
        return filterSessionCompleteness(await listClaudeSessions({ claudeHome, limit, cwd }), completeOnly);
    }
    return filterSessionCompleteness(await listCodexSessions({ codexHome, limit, cwd, includeArchived }), completeOnly);
}
export async function searchSessions({ codexHome, claudeHome, query, limit = DEFAULT_SEARCH_LIMIT, scanLimit = DEFAULT_SEARCH_SCAN_LIMIT, cwd = "", includeArchived = true, source = "all", completeOnly = true, includeTools = false, includeToolOutput = false, }) {
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
export async function readSearchDocument(summary, options) {
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
            summary.codexHomeLabel,
        ].filter(Boolean).map(String),
        segments,
    };
}
async function readSearchSegments(summary, options) {
    if (summary.engine === "claude") {
        return readClaudeSearchSegments(summary, options);
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
export function matchSearchDocument(document, rawQuery, normalizedQuery, terms) {
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
        codexHomeKey: summary.codexHomeKey || "",
        codexHomeLabel: summary.codexHomeLabel || "",
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
export function foldSearchText(value) {
    return String(value || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}
export function searchTerms(query) {
    const normalized = foldSearchText(query);
    if (!normalized) {
        return [];
    }
    const terms = normalized.split(/\s+/).filter(Boolean);
    return uniqueStrings(terms.length ? terms : [normalized]).slice(0, 12);
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
function positiveIntegerOrDefault(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
function isCompleteSessionSummary(summary) {
    if (summary.engine === "claude") {
        return summary.sourceKind === "transcript";
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
export async function loadSnapshot(ref, { codexHome, claudeHome, includeTools, includeToolOutput, redact }) {
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
            const fileChanges = extractCodexToolFileChanges(toolName(item), item.arguments || "");
            addRisks(risks, rawText, turnNumber || 1);
            const toolTurn = {
                kind: "tool",
                role: "tool",
                turn: turnNumber || 1,
                name: toolName(item),
                text: redact ? redactText(rawText) : rawText,
                timestamp: row.timestamp || "",
            };
            if (fileChanges.length) {
                toolTurn.fileChanges = redact ? redactFileChanges(fileChanges, redactText) : fileChanges;
            }
            turns.push(toolTurn);
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
// Best-effort per-session token totals for the aggregate stats dashboard.
// Codex logs a cumulative token_count event; Claude logs per-message usage.
export async function extractSessionTokenUsage(summary) {
    const engine = summary.engine || "codex";
    try {
        if (engine === "codex" && summary.filePath) {
            let usage = null;
            for await (const row of readJsonl(summary.filePath)) {
                usage = extractCodexTokenUsage(row) || usage;
            }
            if (!usage) {
                return null;
            }
            const input = usage.inputTokens || 0;
            const output = usage.outputTokens || 0;
            return { engine, input, output, total: usage.totalTokens || input + output, model: "" };
        }
        if (engine === "claude" && summary.filePath) {
            let input = 0;
            let output = 0;
            let model = "";
            for await (const row of readJsonl(summary.filePath)) {
                const message = row.message || row;
                const usage = message?.usage;
                if (usage) {
                    input += tokenNumber(usage.input_tokens);
                    output += tokenNumber(usage.output_tokens);
                }
                if (message?.model && typeof message.model === "string") {
                    model = message.model;
                }
            }
            const total = input + output;
            if (!total) {
                return null;
            }
            return { engine, input, output, total, model };
        }
    }
    catch {
        return null;
    }
    return null;
}
function splitSnapshotRef(ref) {
    if (ref.startsWith("claude:")) {
        return { engine: "claude", ref: ref.slice("claude:".length) };
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
    const toolTurnsById = new Map();
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
            applyClaudeStructuredPatchResult(row, message, toolTurnsById, risks, turnNumber || 1, redact);
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
                    toolTurnsById.set(tool.id, toolTurn);
                }
                if (tool.fileChanges?.length) {
                    toolTurn.fileChanges = redact ? redactFileChanges(tool.fileChanges, redactText) : tool.fileChanges;
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
function applyClaudeStructuredPatchResult(row, message, toolTurnsById, risks, turnNumber, redact) {
    const result = row?.toolUseResult;
    if (!result || typeof result !== "object") {
        return;
    }
    const structuredPatch = result.structuredPatch;
    if (!structuredPatch) {
        return;
    }
    const toolUseId = (message.toolResults || []).map((tool) => tool.name).find(Boolean) || row.sourceToolUseID || row.sourceToolUseId || "";
    const toolTurn = toolUseId ? toolTurnsById.get(toolUseId) : null;
    if (!toolTurn) {
        return;
    }
    const filePath = result.filePath || result.file_path || result.file?.filePath || "";
    if (!filePath) {
        return;
    }
    const changes = extractClaudeToolFileChanges("Edit", { file_path: filePath }, structuredPatch);
    if (!changes.length) {
        return;
    }
    addRisks(risks, rawFileChangeText(changes), turnNumber);
    toolTurn.fileChanges = redact ? redactFileChanges(changes, redactText) : changes;
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
                    input: item.input || {},
                    fileChanges: extractClaudeToolFileChanges(item.name || "tool_use", item.input || {}),
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
