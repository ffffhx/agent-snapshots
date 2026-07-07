// @ts-nocheck
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { discoverSessionFiles, parseSessionFile } from "agent-session-core";
const CACHE_TTL_MS = 60_000;
const TAIL_BYTES = 256 * 1024;
const CLAUDE_BLOCK_MS = 5 * 60 * 60 * 1000;
const CLAUDE_RECENT_SCAN_MS = 6 * 60 * 60 * 1000;
const CLAUDE_EVENT_LOOKBACK_MS = CLAUDE_RECENT_SCAN_MS + CLAUDE_BLOCK_MS;
const cache = new Map();
export async function readCodexQuotaSnapshot({ codexHome }) {
    const root = path.join(codexHome, "sessions");
    const cacheKey = path.resolve(root);
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached.value;
    }
    let value = { available: false };
    try {
        const files = await collectJsonlFiles(root);
        files.sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const file of files) {
            const snapshot = await readQuotaFromTail(file);
            if (snapshot) {
                value = { available: true, ...snapshot };
                break;
            }
        }
    }
    catch {
        value = { available: false };
    }
    cache.set(cacheKey, { cachedAt: Date.now(), value });
    return value;
}
export async function readClaudeBlockUsageEstimate({ claudeHome }) {
    const root = path.resolve(claudeHome);
    const cacheKey = `claude:${root}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached.value;
    }
    let value = { active: false };
    try {
        const now = Date.now();
        const files = discoverSessionFiles({
            roots: {
                claude: [path.join(claudeHome, "projects"), path.join(claudeHome, "sessions")],
            },
            sinceMs: CLAUDE_RECENT_SCAN_MS,
            includeSubagentTranscripts: true,
            now,
        });
        const events = [];
        const minEventTime = now - CLAUDE_EVENT_LOOKBACK_MS;
        const maxEventTime = now + 60_000;
        for (const file of files) {
            const session = parseSessionFile(file);
            if (!session || session.engine !== "claude" || !Array.isArray(session.events)) {
                continue;
            }
            for (const event of session.events) {
                if (event?.kind !== "token_usage") {
                    continue;
                }
                const time = new Date(event.ts || "").getTime();
                if (!Number.isFinite(time) || time < minEventTime || time > maxEventTime) {
                    continue;
                }
                const tokens = claudeTokenBuckets(event.usage);
                if (!tokens.input && !tokens.output && !tokens.cacheCreation && !tokens.cacheRead) {
                    continue;
                }
                events.push({ time, tokens });
            }
        }
        if (events.length) {
            events.sort((a, b) => a.time - b.time);
            let blockStart = events[0].time;
            // Approximation used by ccusage-style block views: a new 5h block starts at
            // the first usage event whose timestamp is more than 5h after the previous
            // block start. Claude does not write explicit local block-boundary records.
            for (const event of events) {
                if (event.time > blockStart + CLAUDE_BLOCK_MS) {
                    blockStart = event.time;
                }
            }
            const blockEnd = blockStart + CLAUDE_BLOCK_MS;
            if (now < blockEnd) {
                const totals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
                let messages = 0;
                for (const event of events) {
                    if (event.time < blockStart || event.time >= blockEnd) {
                        continue;
                    }
                    messages += 1;
                    totals.input += event.tokens.input;
                    totals.output += event.tokens.output;
                    totals.cacheCreation += event.tokens.cacheCreation;
                    totals.cacheRead += event.tokens.cacheRead;
                }
                value = {
                    active: true,
                    blockStart: new Date(blockStart).toISOString(),
                    blockEnd: new Date(blockEnd).toISOString(),
                    tokens: totals,
                    messages,
                };
            }
        }
    }
    catch {
        value = { active: false };
    }
    cache.set(cacheKey, { cachedAt: Date.now(), value });
    return value;
}
async function collectJsonlFiles(root) {
    const files = [];
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
                continue;
            }
            try {
                const info = await stat(fullPath);
                files.push({ path: fullPath, mtimeMs: info.mtimeMs, size: info.size });
            }
            catch {
                // File disappeared between readdir and stat.
            }
        }
    }
    return files;
}
async function readQuotaFromTail(file) {
    if (!file.size) {
        return null;
    }
    const start = Math.max(0, file.size - TAIL_BYTES);
    const length = file.size - start;
    const handle = await open(file.path, "r");
    try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        let lines = buffer.toString("utf8").split(/\r?\n/);
        if (start > 0) {
            lines = lines.slice(1);
        }
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            const line = String(lines[index] || "").trim();
            if (!line || !line.includes("rate_limits")) {
                continue;
            }
            let row;
            try {
                row = JSON.parse(line);
            }
            catch {
                continue;
            }
            const hit = findRateLimits(row);
            if (!hit) {
                continue;
            }
            const snapshot = normalizeQuotaSnapshot(hit.limits, hit.parent, row, file.mtimeMs);
            if (snapshot) {
                return snapshot;
            }
        }
    }
    finally {
        await handle.close().catch(() => { });
    }
    return null;
}
function findRateLimits(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 6) {
        return null;
    }
    if (value.rate_limits && typeof value.rate_limits === "object") {
        return { limits: value.rate_limits, parent: value };
    }
    for (const child of Object.values(value)) {
        if (!child || typeof child !== "object") {
            continue;
        }
        const hit = findRateLimits(child, depth + 1);
        if (hit) {
            return hit;
        }
    }
    return null;
}
function normalizeQuotaSnapshot(limits, parent, row, mtimeMs) {
    const primary = normalizeWindow(limits.primary);
    const secondary = normalizeWindow(limits.secondary);
    if (!primary && !secondary) {
        return null;
    }
    const updatedAt = toIso(limits.updated_at ||
        limits.updatedAt ||
        parent?.timestamp ||
        parent?.ts ||
        row?.timestamp ||
        row?.ts) || new Date(mtimeMs || Date.now()).toISOString();
    return {
        updatedAt,
        primary,
        secondary,
        planType: String(limits.plan_type || limits.planType || parent?.plan_type || parent?.planType || "").trim(),
    };
}
function normalizeWindow(value) {
    if (!value || typeof value !== "object") {
        return null;
    }
    return {
        usedPercent: clampPercent(value.used_percent ?? value.usedPercent),
        resetsAt: toIso(value.resets_at ?? value.resetsAt) || "",
        windowMinutes: positiveInteger(value.window_minutes ?? value.windowMinutes),
    };
}
function clampPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 0;
    }
    return Math.max(0, Math.min(100, number));
}
function positiveInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}
function tokenNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}
function claudeTokenBuckets(usage) {
    const fullInput = tokenNumber(usage?.input);
    const cacheRead = tokenNumber(usage?.cached);
    const cacheCreation = tokenNumber(usage?.cacheCreation);
    return {
        input: Math.max(0, fullInput - cacheRead - cacheCreation),
        output: tokenNumber(usage?.output),
        cacheCreation,
        cacheRead,
    };
}
function toIso(value) {
    if (value === null || value === undefined || value === "") {
        return "";
    }
    if (typeof value === "number") {
        const ms = value > 1_000_000_000_000 ? value : value * 1000;
        const date = new Date(ms);
        return Number.isFinite(date.getTime()) ? date.toISOString() : "";
    }
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
