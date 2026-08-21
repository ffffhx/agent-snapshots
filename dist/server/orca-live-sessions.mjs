// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const PROCESS_START_MATCH_WINDOW_MS = 15 * 60 * 1000;
const PROCESS_CACHE_TTL_MS = 5_000;
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
let processCache = null;
function processEngine(command) {
    const text = String(command || "");
    if (/(?:^|\s)node\s+\S*[/\\]codex(?:\s|$)/.test(text)
        || /(?:^|\s)\S*[/\\]codex\s+(?!app-server\b)/.test(text)) {
        return "codex";
    }
    if (/(?:^|\s)node\s+\S*[/\\]claude(?:\s|$)/.test(text)
        || /(?:^|\s)\S*[/\\]claude(?:\s|$)/.test(text)) {
        return "claude";
    }
    return "";
}
function parseProcessRows(output) {
    const rows = [];
    for (const line of String(output || "").split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(line);
        if (!match) {
            continue;
        }
        const engine = processEngine(match[4]);
        const startedAtMs = new Date(match[3]).getTime();
        if (!engine || !Number.isFinite(startedAtMs)) {
            continue;
        }
        rows.push({
            pid: Number(match[1]),
            ppid: Number(match[2]),
            engine,
            startedAtMs,
            command: match[4],
        });
    }
    const candidatePids = new Set(rows.map((row) => row.pid));
    return rows.filter((row) => !candidatePids.has(row.ppid));
}
function parseCwd(output) {
    const match = /^n(.+)$/m.exec(String(output || ""));
    return match ? match[1].trim() : "";
}
function sessionBareId(session) {
    const id = String(session?.id || "").trim();
    if (UUID_RE.test(id)) {
        return id.match(UUID_RE)?.[0]?.toLowerCase() || "";
    }
    const ref = String(session?.ref || "");
    return ref.match(UUID_RE)?.[0]?.toLowerCase() || "";
}
function sessionEngine(session) {
    const engine = String(session?.engine || "").toLowerCase();
    if (engine === "codex" || engine === "claude") {
        return engine;
    }
    return String(session?.ref || "").toLowerCase().startsWith("claude:") ? "claude" : "codex";
}
function sessionTimeMs(session, key) {
    const value = new Date(session?.[key] || 0).getTime();
    return Number.isFinite(value) ? value : 0;
}
function normalizePath(value) {
    return String(value || "").replace(/[\\/]+$/, "");
}
function uniqueSessionCandidates(sessions) {
    const byId = new Map();
    for (const session of Array.isArray(sessions) ? sessions : []) {
        const id = sessionBareId(session);
        if (!id) {
            continue;
        }
        const previous = byId.get(id);
        if (!previous || String(session?.ref || "").length < String(previous?.ref || "").length) {
            byId.set(id, session);
        }
    }
    return [...byId.values()];
}
export function matchOrcaProcessesToSessions(processes, sessions) {
    const candidates = uniqueSessionCandidates(sessions);
    const usedIds = new Set();
    const matched = [];
    for (const processInfo of [...processes].sort((a, b) => a.startedAtMs - b.startedAtMs)) {
        const resumeId = String(processInfo.resumeId || "").toLowerCase();
        let session = resumeId
            ? candidates.find((candidate) => sessionBareId(candidate) === resumeId)
            : null;
        if (!session) {
            const cwd = normalizePath(processInfo.cwd);
            session = candidates
                .filter((candidate) => (!usedIds.has(sessionBareId(candidate))
                && sessionEngine(candidate) === processInfo.engine
                && normalizePath(candidate?.cwd || candidate?.displayCwd) === cwd))
                .map((candidate) => ({
                candidate,
                distance: Math.abs(sessionTimeMs(candidate, "createdAt") - processInfo.startedAtMs),
                mtime: sessionTimeMs(candidate, "mtime"),
            }))
                .filter((entry) => entry.distance <= PROCESS_START_MATCH_WINDOW_MS)
                .sort((a, b) => a.distance - b.distance || b.mtime - a.mtime)[0]?.candidate || null;
        }
        const id = sessionBareId(session);
        if (session && id && !usedIds.has(id)) {
            usedIds.add(id);
            matched.push(session);
        }
    }
    return matched;
}
async function discoverOrcaAgentProcesses() {
    if (!["darwin", "linux"].includes(process.platform)) {
        return [];
    }
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,lstart=,command="], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    const rows = parseProcessRows(stdout);
    const processes = [];
    for (const row of rows) {
        const [environmentResult, cwdResult] = await Promise.allSettled([
            execFileAsync("ps", ["eww", "-p", String(row.pid), "-o", "command="], {
                timeout: 3000,
                maxBuffer: 2 * 1024 * 1024,
            }),
            execFileAsync("lsof", ["-a", "-p", String(row.pid), "-d", "cwd", "-Fn"], {
                timeout: 3000,
                maxBuffer: 256 * 1024,
            }),
        ]);
        if (environmentResult.status !== "fulfilled" || cwdResult.status !== "fulfilled") {
            continue;
        }
        const terminalHandle = String(environmentResult.value.stdout).match(/(?:^|\s)ORCA_TERMINAL_HANDLE=([^\s]+)/)?.[1] || "";
        const cwd = parseCwd(cwdResult.value.stdout);
        if (!terminalHandle || !cwd) {
            continue;
        }
        const commandId = String(row.command).match(UUID_RE)?.[0]?.toLowerCase() || "";
        processes.push({
            engine: row.engine,
            pid: row.pid,
            cwd,
            startedAtMs: row.startedAtMs,
            terminalHandle,
            resumeId: /\b(?:resume|--resume)\b/.test(row.command) ? commandId : "",
        });
    }
    return processes;
}
export async function listOrcaAgentProcesses() {
    const now = Date.now();
    if (processCache && processCache.expiresAt > now) {
        return processCache.promise;
    }
    const promise = discoverOrcaAgentProcesses();
    processCache = {
        expiresAt: now + PROCESS_CACHE_TTL_MS,
        promise,
    };
    try {
        return await promise;
    }
    catch (error) {
        if (processCache?.promise === promise) {
            processCache = null;
        }
        throw error;
    }
}
export async function listActiveOrcaSessionSummaries(sessions) {
    return matchOrcaProcessesToSessions(await listOrcaAgentProcesses(), sessions);
}
