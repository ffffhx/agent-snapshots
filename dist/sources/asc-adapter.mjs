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
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { discoverSessionFiles, parseSessionFile, toSnapshot } from "agent-session-core";
import { addRisks, detectRisks, redactText, severityRank } from "../core/privacy.js";
import { renderMarkdownHtml } from "../renderers/markdown.mjs";
import { stripAppDirectives as stripCodexAppDirectives } from "../shared/sanitize.js";
import { extractClaudeToolFileChanges, extractCodexToolFileChanges, rawFileChangeText, redactFileChanges, } from "./file-changes.mjs";
import { listSessions as legacyListSessions, loadSnapshot as legacyLoadSnapshot, readSearchDocument, matchSearchDocument, foldSearchText, searchTerms, discoverTraeSessionSummaryCandidates, summarizeTraeSessionCandidate, } from "./local-history.mjs";
import { codexHomeCacheKey, codexSessionRef, discoverCodexHomes, resolveCodexHomeForRef, } from "./codex-homes.mjs";
const ASC_ENGINES = new Set(["codex", "claude"]);
const ENGINE_LABELS = { codex: "Codex", claude: "Claude Code" };
// Head-only line budget for list summaries: enough to capture the session
// header + first user message (the title) without full-parsing a huge session.
// ~200 covers the title even after a preamble of injected/system messages;
// beyond that gives no better title coverage (measured) and only costs time.
const SUMMARY_MAX_LINES = 200;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_SEARCH_SCAN_LIMIT = 600;
// ---------------------------------------------------------------------------
// Discovery / roots
// ---------------------------------------------------------------------------
// Mirror the legacy scan scope: codex sessions + archived_sessions, and both of
// Claude's roots (projects + sessions). ASC's defaultRoots() omits codex archive
// and ~/.claude/sessions, so we pass explicit roots derived from the caller's
// (possibly custom) home dirs.
function ascRoots(engine, codexHome, claudeHome, { includeArchived = true } = {}) {
    if (engine === "codex") {
        const roots = [path.join(codexHome, "sessions")];
        if (includeArchived) {
            roots.push(path.join(codexHome, "archived_sessions"));
        }
        return { codex: roots };
    }
    return { claude: [path.join(claudeHome, "projects"), path.join(claudeHome, "sessions")] };
}
function discoverFor(engine, codexHome, claudeHome, { includeArchived = true } = {}) {
    return discoverSessionFiles({ roots: ascRoots(engine, codexHome, claudeHome, { includeArchived }) });
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
    if (ref.startsWith("claude:"))
        return "claude";
    if (ref.startsWith("trae:"))
        return "trae";
    if (ref.startsWith("codex:"))
        return "codex";
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
    let selectedCodexHome = codexHome;
    let selectedCodexHomeInfo = null;
    let bareRef = ref.replace(/^(codex|claude):/, "");
    if (engine === "codex") {
        const resolved = await resolveCodexHomeForRef(ref, codexHome);
        selectedCodexHomeInfo = resolved.home;
        selectedCodexHome = resolved.home.home;
        bareRef = resolved.bareRef;
    }
    const file = await resolveAscFile(engine, bareRef, selectedCodexHome, claudeHome);
    if (!file) {
        // Codex: not found. Claude: most commonly a history-only session that lives
        // in ~/.claude/history.jsonl with no transcript file. Either way the legacy
        // resolver owns these (history-only snapshot, descriptive errors).
        const legacyRef = engine === "codex" ? `codex:${bareRef}` : ref;
        const snapshot = await legacyLoadSnapshot(legacyRef, { ...opts, codexHome: selectedCodexHome });
        if (engine === "codex") {
            attachCodexHomeFields(snapshot, selectedCodexHomeInfo);
        }
        return snapshot;
    }
    const session = parseSessionFile(file);
    if (!session) {
        const legacyRef = engine === "codex" ? `codex:${bareRef}` : ref;
        const snapshot = await legacyLoadSnapshot(legacyRef, { ...opts, codexHome: selectedCodexHome });
        if (engine === "codex") {
            attachCodexHomeFields(snapshot, selectedCodexHomeInfo);
        }
        return snapshot;
    }
    const snapshot = ascSnapshot(session, { includeTools, includeToolOutput, redact });
    if (engine === "codex") {
        attachCodexHomeFields(snapshot, selectedCodexHomeInfo);
    }
    return snapshot;
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
    }
    catch {
        return null;
    }
    let realHome;
    try {
        realHome = await realpath(path.resolve(home));
    }
    catch {
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
    attachAscFileChanges(session, snapshot, { includeTools, redact });
    attachAscTurnTokenUsage(session, snapshot);
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
        // Reconstruct the Task/Agent subagent transcripts nested under the parent
        // session (parsed + projected through ASC, same as the parent).
        snapshot.subagents = loadAscClaudeSubagents(session.filePath, session.id, { includeTools, includeToolOutput, redact });
    }
    else {
        // GAP: NormalizedSession has no model_provider/originator; the legacy summary
        snapshot.modelProvider = session.modelProvider || "";
        snapshot.source = session.source || "";
        snapshot.projectKind = projectKindForCodexCwd(session.cwd || "");
    }
    return snapshot;
}
// Claude Code writes Task/Agent subagent transcripts under
// `<dir>/<parentSessionId>/subagents/**/agent-*.jsonl`, each with a sibling
// `.meta.json` (toolUseId / agentType / description). We reconstruct them so
// they render nested under the parent, parsing each through ASC like the parent.
function collectAgentFiles(dir, out) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectAgentFiles(full, out);
        }
        else if (/^agent-[0-9a-f]+\.jsonl$/i.test(entry.name)) {
            try {
                const info = statSync(full);
                out.push({ path: full, engine: "claude", mtimeMs: info.mtimeMs, sizeBytes: info.size });
            }
            catch {
                // Skip a file that vanished between readdir and stat.
            }
        }
    }
}
function loadAscClaudeSubagents(parentFilePath, parentSessionId, { includeTools, includeToolOutput, redact }) {
    if (!parentSessionId || !parentFilePath) {
        return [];
    }
    const root = path.join(path.dirname(parentFilePath), parentSessionId, "subagents");
    const files = [];
    collectAgentFiles(root, files);
    if (!files.length) {
        return [];
    }
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const subagents = [];
    let order = 0;
    for (const file of files) {
        const session = parseSessionFile(file);
        if (!session) {
            continue;
        }
        stripSessionDirectives(session);
        const snap = toSnapshot(session, {
            includeTools,
            includeToolOutput,
            redact,
            generatedAt: new Date().toISOString(),
            renderHtml: renderMarkdownHtml,
            redactText,
            detectRisks,
            imageRiskFinding: { id: "image-attachment", label: "Image attachment", severity: "medium" },
        });
        attachAscFileChanges(session, snap, { includeTools, redact });
        attachAscTurnTokenUsage(session, snap);
        const turns = Array.isArray(snap.turns) ? snap.turns : [];
        if (!turns.length) {
            continue;
        }
        let meta = {};
        try {
            meta = JSON.parse(readFileSync(file.path.replace(/\.jsonl$/, ".meta.json"), "utf8"));
        }
        catch {
            meta = {};
        }
        order += 1;
        const firstUser = turns.find((turn) => turn.kind === "message" && turn.role === "user");
        const rawDescription = String(meta.description || "").trim() || (firstUser ? String(firstUser.text || "").replace(/\s+/g, " ").trim().slice(0, 80) : "");
        const description = redact ? redactText(rawDescription) : rawDescription;
        subagents.push({
            order,
            agentId: path.basename(file.path, ".jsonl").replace(/^agent-/, ""),
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
function attachAscTurnTokenUsage(session, snapshot) {
    if (!session || !snapshot || !Array.isArray(session.events) || !Array.isArray(snapshot.turns)) {
        return;
    }
    const assistantTurns = new Map();
    for (const turn of snapshot.turns) {
        if (turn?.kind !== "tool" && turn?.role === "assistant" && Number(turn.turn || 0) > 0 && !assistantTurns.has(turn.turn)) {
            assistantTurns.set(turn.turn, turn);
        }
    }
    if (!assistantTurns.size) {
        return;
    }
    let turnNumber = 0;
    let activeAssistantTurn = 0;
    const pendingUsage = [];
    for (const ev of session.events) {
        if (ev.kind === "message") {
            if (ev.internal || (ev.role !== "user" && ev.role !== "assistant")) {
                continue;
            }
            const rawText = ev.text || "";
            const images = ev.images || [];
            if (!String(rawText).trim() && !images.length) {
                continue;
            }
            turnNumber += 1;
            if (ev.role === "assistant") {
                activeAssistantTurn = turnNumber;
                if (pendingUsage.length) {
                    for (const usageEvent of pendingUsage.splice(0)) {
                        addTurnTokenUsage(assistantTurns.get(activeAssistantTurn), usageEvent);
                    }
                }
            }
            else {
                activeAssistantTurn = 0;
            }
            continue;
        }
        if (ev.kind !== "token_usage") {
            continue;
        }
        if (activeAssistantTurn) {
            addTurnTokenUsage(assistantTurns.get(activeAssistantTurn), ev);
        }
        else {
            pendingUsage.push(ev);
        }
    }
}
function addTurnTokenUsage(turn, event) {
    if (!turn || !event?.usage) {
        return;
    }
    const current = turn.tokenUsage || {};
    const usage = event.usage;
    const input = tokenNumber(usage.input);
    const cached = tokenNumber(usage.cached);
    const cacheCreation = tokenNumber(usage.cacheCreation);
    const output = tokenNumber(usage.output);
    const reasoning = tokenNumber(usage.reasoning);
    turn.tokenUsage = {
        inputTokens: tokenNumber(current.inputTokens) + input,
        cachedInputTokens: tokenNumber(current.cachedInputTokens) + cached,
        cacheCreationInputTokens: tokenNumber(current.cacheCreationInputTokens) + cacheCreation,
        outputTokens: tokenNumber(current.outputTokens) + output,
        reasoningOutputTokens: tokenNumber(current.reasoningOutputTokens) + reasoning,
        totalTokens: tokenNumber(current.totalTokens) + input + output,
        updatedAt: event.ts || current.updatedAt || "",
    };
}
function tokenNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}
function attachAscFileChanges(session, snapshot, { includeTools, redact }) {
    if (!includeTools || !snapshot || !Array.isArray(snapshot.turns)) {
        return;
    }
    const structuredPatches = session.engine === "claude" ? readClaudeStructuredPatches(session.filePath) : new Map();
    let cursor = 0;
    for (const ev of session.events || []) {
        if (ev.kind !== "tool_call") {
            continue;
        }
        const found = findNextToolTurn(snapshot.turns, cursor, ev);
        if (!found) {
            continue;
        }
        cursor = found.index + 1;
        const patchInfo = ev.callId ? structuredPatches.get(ev.callId) : null;
        let fileChanges = session.engine === "codex"
            ? extractCodexToolFileChanges(ev.name, ev.args)
            : extractClaudeToolFileChanges(ev.name, ev.args, patchInfo?.structuredPatch);
        if (!fileChanges.length && patchInfo?.filePath && patchInfo?.structuredPatch) {
            fileChanges = extractClaudeToolFileChanges(ev.name, { file_path: patchInfo.filePath }, patchInfo.structuredPatch);
        }
        if (!fileChanges.length) {
            continue;
        }
        if (patchInfo?.structuredPatch) {
            addFileChangeRisks(snapshot, fileChanges, found.turn.turn || 1);
        }
        found.turn.fileChanges = redact ? redactFileChanges(fileChanges, redactText) : fileChanges;
    }
}
function findNextToolTurn(turns, startIndex, ev) {
    for (let index = Math.max(0, startIndex); index < turns.length; index += 1) {
        const turn = turns[index];
        if (turn.kind !== "tool") {
            continue;
        }
        if (ev.name && turn.name && turn.name !== ev.name) {
            continue;
        }
        if (ev.ts && turn.timestamp && turn.timestamp !== ev.ts) {
            continue;
        }
        return { turn, index };
    }
    return null;
}
function readClaudeStructuredPatches(filePath) {
    const patches = new Map();
    if (!filePath) {
        return patches;
    }
    let text = "";
    try {
        text = readFileSync(filePath, "utf8");
    }
    catch {
        return patches;
    }
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) {
            continue;
        }
        let row;
        try {
            row = JSON.parse(line);
        }
        catch {
            continue;
        }
        const result = row?.toolUseResult;
        if (!result || typeof result !== "object" || !result.structuredPatch) {
            continue;
        }
        const toolUseId = claudeToolResultId(row);
        if (!toolUseId) {
            continue;
        }
        patches.set(toolUseId, {
            filePath: result.filePath || result.file_path || result.file?.filePath || "",
            structuredPatch: result.structuredPatch,
        });
    }
    return patches;
}
function claudeToolResultId(row) {
    const content = row?.message?.content;
    if (!Array.isArray(content)) {
        return "";
    }
    for (const item of content) {
        if (item?.type === "tool_result" && item.tool_use_id) {
            return String(item.tool_use_id);
        }
    }
    return "";
}
function addFileChangeRisks(snapshot, fileChanges, turnNumber) {
    const risks = new Map();
    for (const risk of snapshot.risks || []) {
        risks.set(risk.id, { ...risk, turns: Array.isArray(risk.turns) ? risk.turns.slice() : [] });
    }
    addRisks(risks, rawFileChangeText(fileChanges), turnNumber || 1);
    snapshot.risks = [...risks.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}
// ---------------------------------------------------------------------------
// searchSessions
// ---------------------------------------------------------------------------
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
    const homes = { codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir };
    const sessions = await listSessions({
        ...homes,
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
                ...homes,
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
function positiveIntegerOrDefault(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------
export async function listSessions(opts) {
    const { codexHome, claudeHome, limit, cwd, includeArchived, source = "codex", completeOnly = false, } = opts;
    if (source === "trae") {
        return legacyListSessions(opts);
    }
    const codexHomes = await discoverCodexHomes(codexHome);
    if (source === "codex" || source === "claude") {
        const summaries = source === "codex"
            ? listCodexHomes(codexHomes, { claudeHome, cwd, includeArchived }, { limit, completeOnly })
            : ascListEngine(source, { codexHome, claudeHome, cwd, includeArchived }, { limit, completeOnly });
        const history = source === "claude" ? await listClaudeHistoryOnly(opts) : [];
        const filtered = applyListFilters([...summaries, ...history], { completeOnly, limit });
        return filtered;
    }
    if (source === "all") {
        // codex + claude via ASC; trae still via legacy. Merge by mtime desc and
        // dedupe by ref (engine-prefixed id), mirroring the legacy "all" semantics.
        const codex = listCodexHomes(codexHomes, { claudeHome, cwd, includeArchived }, { limit, completeOnly });
        const claude = ascListEngine("claude", { codexHome, claudeHome, cwd, includeArchived }, { limit, completeOnly });
        const claudeHistory = await listClaudeHistoryOnly(opts);
        let trae = [];
        try {
            trae = await legacyListSessions({ ...opts, source: "trae", completeOnly: false, limit: Infinity });
        }
        catch {
            trae = [];
        }
        const seen = new Set();
        const merged = [];
        for (const s of [...codex, ...claude, ...claudeHistory, ...trae]) {
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
function listCodexHomes(codexHomes, { claudeHome, cwd, includeArchived }, { limit, completeOnly } = {}) {
    const summaries = [];
    for (const homeInfo of codexHomes) {
        summaries.push(...ascListEngine("codex", {
            codexHome: homeInfo.home,
            claudeHome,
            cwd,
            includeArchived,
            codexHomeInfo: homeInfo,
        }, { limit, completeOnly }));
    }
    return summaries;
}
async function listClaudeHistoryOnly(opts) {
    if (opts.completeOnly) {
        return [];
    }
    try {
        const sessions = await legacyListSessions({ ...opts, source: "claude", completeOnly: false, limit: Infinity });
        return sessions.filter((summary) => summary?.historyOnly === true || summary?.sourceKind === "history");
    }
    catch {
        return [];
    }
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
function ascListEngine(engine, { codexHome, claudeHome, cwd, includeArchived = true, codexHomeInfo = null }, { limit, completeOnly } = {}) {
    const cwdFilter = cwd ? path.resolve(cwd) : "";
    // Newest-first so we can stop once we have enough: the legacy lister reads
    // only headers, so full-parsing the whole corpus per list call is a big
    // regression. Discovery already carries mtimeMs (a cheap stat).
    const files = discoverFor(engine, codexHome, claudeHome, { includeArchived })
        .slice()
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    // Only safe to early-stop when the caller wants a bounded, unfiltered-by-cwd
    // page (the common sidebar load). cwd scope / "all history" parse everything.
    const canEarlyStop = Number.isFinite(limit) && !cwdFilter;
    const summaries = [];
    for (const file of files) {
        // Head-only parse: listing only needs the header + title + a has-messages
        // signal, so we cap lines instead of full-parsing every session file.
        const session = parseSessionFile(file, { maxLines: SUMMARY_MAX_LINES });
        if (!session) {
            continue;
        }
        const summary = projectSummary(session, file, codexHomeInfo);
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
export async function discoverSessionSummaryCandidates({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, source = "all", includeArchived = true, }) {
    const candidates = [];
    if (source === "all" || source === "codex") {
        const codexHomes = await discoverCodexHomes(codexHome);
        for (const homeInfo of codexHomes) {
            for (const file of discoverFor("codex", homeInfo.home, claudeHome, { includeArchived })) {
                candidates.push(ascSummaryCandidate({ ...file, codexHomeInfo: homeInfo }));
            }
        }
    }
    if (source === "all" || source === "claude") {
        for (const file of discoverFor("claude", codexHome, claudeHome, { includeArchived: true })) {
            candidates.push(ascSummaryCandidate(file));
        }
    }
    if (source === "all" || source === "trae") {
        candidates.push(...await discoverTraeSessionSummaryCandidates({ traeHome, traeAppHome, traeRecordingsDir }));
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates;
}
function ascSummaryCandidate(file) {
    const filePath = file.path || file.filePath || "";
    const homeInfo = file.codexHomeInfo || null;
    return {
        key: `${file.engine || "codex"}:${filePath}`,
        engine: file.engine || "codex",
        kind: "asc-file",
        filePath,
        filePaths: [filePath],
        mtimeMs: Number(file.mtimeMs || 0),
        mtime: new Date(Number(file.mtimeMs || 0)).toISOString(),
        size: Number(file.sizeBytes || file.size || 0),
        sizeBytes: Number(file.sizeBytes || file.size || 0),
        codexHomeKey: homeInfo ? codexHomeCacheKey(homeInfo) : "",
        codexHomeLabel: homeInfo?.label || "",
        codexHomePrimary: homeInfo ? homeInfo.primary === true : true,
    };
}
export async function summarizeSessionCandidate(candidate, { codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir } = {}) {
    if (candidate?.engine === "trae") {
        return summarizeTraeSessionCandidate(candidate, { traeHome, traeAppHome, traeRecordingsDir });
    }
    const file = {
        path: candidate.path || candidate.filePath,
        engine: candidate.engine || "codex",
        mtimeMs: Number(candidate.mtimeMs || 0),
        sizeBytes: Number(candidate.sizeBytes || candidate.size || 0),
        codexHomeKey: candidate.codexHomeKey || "",
        codexHomeLabel: candidate.codexHomeLabel || "",
        codexHomePrimary: candidate.codexHomePrimary !== false,
    };
    const session = parseSessionFile(file, { maxLines: SUMMARY_MAX_LINES });
    if (!session) {
        return [];
    }
    return [projectSummary(session, file)];
}
// Project an ASC NormalizedSession into the legacy list-summary shape that the
// CLI/server/site consume.
function projectSummary(session, file, codexHomeInfo = null) {
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
        }
        else if (ev.kind === "tool_call" || ev.kind === "tool_result") {
            toolCallCount += 1;
        }
    }
    const cwd = session.cwd || "";
    const filePath = session.filePath || file.path;
    const homeInfo = engine === "codex" ? codexHomeInfoFromFile(file, codexHomeInfo) : null;
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
        ref: engine === "codex" ? codexSessionRef(session.id, homeInfo) : `${engine}:${session.id}`,
        displayCwd: redactText(cwd),
        displayFilePath: redactText(filePath),
    };
    if (engine === "claude") {
        summary.modelProvider = "anthropic";
        summary.source = "claude-code";
        summary.sourceKind = "transcript";
        summary.sourceDetail = "full transcript";
        summary.historyOnly = false;
    }
    else {
        summary.modelProvider = session.modelProvider || "";
        summary.source = session.source || "";
        summary.projectKind = projectKindForCodexCwd(cwd);
        attachCodexHomeFields(summary, homeInfo);
    }
    return summary;
}
function codexHomeInfoFromFile(file, fallback = null) {
    if (fallback) {
        return fallback;
    }
    if (file?.codexHomeInfo) {
        return file.codexHomeInfo;
    }
    if (file?.codexHomeKey) {
        return {
            home: "",
            key: file.codexHomeKey,
            label: file.codexHomeLabel || "",
            primary: file.codexHomePrimary !== false,
        };
    }
    return { home: "", key: "", label: "", primary: true };
}
function attachCodexHomeFields(target, homeInfo) {
    if (!target || !homeInfo) {
        return target;
    }
    const key = codexHomeCacheKey(homeInfo);
    target.codexHomeKey = key;
    target.ref = codexSessionRef(target.id || target.ref || "", homeInfo);
    if (homeInfo.label) {
        target.codexHomeLabel = homeInfo.label;
    }
    else {
        delete target.codexHomeLabel;
    }
    return target;
}
