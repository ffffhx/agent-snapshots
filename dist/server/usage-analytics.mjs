// @ts-nocheck
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const ENGINE_KEYS = ["codex", "claude"];
const DEFAULT_SCAN_LIMIT = 20_000;
const ACTIVITY_WEEKS = 26;
export async function buildUsageAnalytics({ codexHome, claudeHome, listSessions, limit = DEFAULT_SCAN_LIMIT, }) {
    const homes = { codexHome, claudeHome };
    const sessions = await listSessions({
        ...homes,
        source: "all",
        includeArchived: true,
        completeOnly: true,
        limit,
    });
    const range = activityRange();
    const dayMap = new Map();
    for (const date of range.dates) {
        dayMap.set(date, { date, total: 0, codex: 0, claude: 0 });
    }
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, codex: 0, claude: 0 }));
    const projectMap = new Map();
    const engines = { total: 0, codex: 0, claude: 0 };
    for (const session of sessions) {
        const engine = engineKey(session.engine);
        const when = sessionDate(session);
        const dateKey = localDateKey(when);
        engines.total += 1;
        engines[engine] += 1;
        if (dateKey >= range.startDate && dateKey <= range.endDate) {
            const day = dayMap.get(dateKey);
            if (day) {
                day.total += 1;
                day[engine] += 1;
            }
            const hour = Number.isFinite(when.getTime()) ? when.getHours() : 0;
            hours[hour].total += 1;
            hours[hour][engine] += 1;
        }
        const project = projectInfo(session.cwd, session.displayCwd);
        const key = project.key + "\0" + engine;
        const entry = projectMap.get(key) || {
            key: project.key,
            name: project.name,
            path: project.path,
            engine,
            sessions: 0,
            indexedSessions: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            lastAt: "",
        };
        entry.sessions += 1;
        if (!entry.lastAt || when.getTime() > new Date(entry.lastAt).getTime()) {
            entry.lastAt = when.toISOString();
        }
        projectMap.set(key, entry);
    }
    const tokenStats = await readIndexedProjectTokens();
    for (const token of tokenStats.projects) {
        const key = token.key + "\0" + token.engine;
        const entry = projectMap.get(key) || {
            key: token.key,
            name: token.name,
            path: token.path,
            engine: token.engine,
            sessions: 0,
            indexedSessions: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            lastAt: "",
        };
        entry.indexedSessions += token.indexedSessions;
        entry.inputTokens += token.inputTokens;
        entry.outputTokens += token.outputTokens;
        entry.totalTokens += token.totalTokens;
        projectMap.set(key, entry);
    }
    const projects = Array.from(projectMap.values())
        .filter((entry) => entry.sessions || entry.totalTokens)
        .sort((a, b) => (b.sessions - a.sessions) || (b.totalTokens - a.totalTokens) || a.name.localeCompare(b.name, "zh-CN"));
    return {
        generatedAt: new Date().toISOString(),
        scanLimit: limit,
        scannedSessions: sessions.length,
        indexedSessions: tokenStats.indexedSessions,
        range: {
            startDate: range.startDate,
            endDate: range.endDate,
            weeks: ACTIVITY_WEEKS,
        },
        engines,
        days: range.dates.map((date) => dayMap.get(date)),
        hours,
        projects,
    };
}
function activityRange() {
    const today = startOfLocalDay(new Date());
    const startOfCurrentWeek = addDays(today, -today.getDay());
    const start = addDays(startOfCurrentWeek, -(ACTIVITY_WEEKS - 1) * 7);
    const dates = [];
    for (let index = 0; index < ACTIVITY_WEEKS * 7; index += 1) {
        dates.push(localDateKey(addDays(start, index)));
    }
    return {
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        dates,
    };
}
function sessionDate(session) {
    for (const value of [session.createdAt, session.startedAt, session.mtime]) {
        const date = new Date(value);
        if (Number.isFinite(date.getTime())) {
            return date;
        }
    }
    return new Date(0);
}
function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}
function localDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
function engineKey(value) {
    return ENGINE_KEYS.includes(value) ? value : "codex";
}
function projectInfo(rawPath, displayPath) {
    const key = String(rawPath || displayPath || "").trim();
    const display = String(displayPath || rawPath || "").trim();
    if (!key && !display) {
        return { key: "__none__", name: "(无项目)", path: "" };
    }
    const visiblePath = display || key;
    const parts = visiblePath.replace(/[/\\]+$/, "").split(/[/\\]+/).filter(Boolean);
    return {
        key: key || visiblePath,
        name: parts[parts.length - 1] || visiblePath,
        path: visiblePath,
    };
}
function searchIndexPath() {
    const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
    return path.join(cacheHome, "agent-snapshots", "search-index.v2.db");
}
async function readIndexedProjectTokens() {
    const dbFile = searchIndexPath();
    if (!existsSync(dbFile)) {
        return { indexedSessions: 0, projects: [] };
    }
    try {
        const { DatabaseSync } = await import("node:sqlite");
        const db = new DatabaseSync(dbFile);
        try {
            const totalRow = db.prepare("SELECT COUNT(*) AS c FROM docs").get();
            const rows = db.prepare(`
        SELECT source, display_cwd, cwd, tokens_total, tokens_input, tokens_output
        FROM docs
      `).all();
            const projectMap = new Map();
            for (const row of rows) {
                const engine = engineKey(row.source);
                const project = projectInfo(row.cwd, row.display_cwd);
                const key = project.key + "\0" + engine;
                const entry = projectMap.get(key) || {
                    key: project.key,
                    name: project.name,
                    path: project.path,
                    engine,
                    indexedSessions: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0,
                };
                entry.indexedSessions += 1;
                entry.inputTokens += tokenNumber(row.tokens_input);
                entry.outputTokens += tokenNumber(row.tokens_output);
                entry.totalTokens += tokenNumber(row.tokens_total);
                projectMap.set(key, entry);
            }
            return {
                indexedSessions: Number(totalRow?.c || 0),
                projects: Array.from(projectMap.values()),
            };
        }
        finally {
            db.close?.();
        }
    }
    catch {
        return { indexedSessions: 0, projects: [] };
    }
}
function tokenNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}
