import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
const PINNED_LIMIT = 20;
const ACCESS_REF_LIMIT = 200;
const ACCESS_PROJECT_LIMIT = 50;
const PREFS_PATH = join(process.env.AGENT_SNAPSHOT_PREFS_DIR || join(homedir(), ".agent-snapshot"), "launcher-prefs.json");
export async function readLauncherPrefs() {
    try {
        const raw = await readFile(PREFS_PATH, "utf8");
        return normalizePrefs(JSON.parse(raw));
    }
    catch {
        return emptyLauncherPrefs();
    }
}
export async function setLauncherSessionPinned(input) {
    const parsed = normalizePinInput(input);
    if (!parsed.ok) {
        return parsed;
    }
    const prefs = await readLauncherPrefs();
    const nextPinned = prefs.pinned.filter((item) => item.ref !== parsed.ref);
    if (parsed.pinned) {
        nextPinned.push({
            ref: parsed.ref,
            engine: parsed.engine,
            pinnedAt: new Date().toISOString(),
        });
    }
    const next = normalizePrefs({ ...prefs, pinned: nextPinned.slice(-PINNED_LIMIT) });
    await writeLauncherPrefs(next);
    return { ok: true, pinned: next.pinned };
}
export async function recordLauncherAccess(input) {
    const parsed = normalizeTouchInput(input);
    if (!parsed.ok) {
        return parsed;
    }
    const prefs = await readLauncherPrefs();
    const next = normalizePrefs({
        ...prefs,
        accesses: incrementUsageRecord(prefs.accesses, parsed.ref, parsed.at),
        projects: parsed.cwd ? incrementUsageRecord(prefs.projects, parsed.cwd, parsed.at) : prefs.projects,
    });
    await writeLauncherPrefs(next);
    return { ok: true, prefs: next };
}
function emptyLauncherPrefs() {
    return { pinned: [], accesses: {}, projects: {} };
}
function normalizePrefs(value) {
    const pinned = Array.isArray(value?.pinned)
        ? value.pinned
        : [];
    const normalized = [];
    const seen = new Set();
    for (const item of pinned) {
        const input = normalizePinInput({ ref: item?.ref, engine: item?.engine, pinned: true });
        if (!input.ok || seen.has(input.ref)) {
            continue;
        }
        const pinnedAt = validDateText(item?.pinnedAt) || new Date(0).toISOString();
        normalized.push({ ref: input.ref, engine: input.engine, pinnedAt });
        seen.add(input.ref);
    }
    return {
        pinned: normalized
            .sort((a, b) => new Date(a.pinnedAt).getTime() - new Date(b.pinnedAt).getTime())
            .slice(-PINNED_LIMIT),
        accesses: normalizeUsageMap(value?.accesses, ACCESS_REF_LIMIT, normalizeSessionRef),
        projects: normalizeUsageMap(value?.projects, ACCESS_PROJECT_LIMIT, normalizeProjectKey),
    };
}
function normalizePinInput(input) {
    const rawRef = String(input.ref || "").trim();
    if (!rawRef) {
        return { ok: false, error: "missing ref" };
    }
    const refMatch = /^(codex|claude|trae):(.+)$/i.exec(rawRef);
    const refEngine = refMatch ? normalizeEngine(refMatch[1]) : null;
    const bodyEngine = normalizeEngine(input.engine);
    const engine = bodyEngine || refEngine;
    if (!engine) {
        return { ok: false, error: "invalid engine" };
    }
    if (refEngine && bodyEngine && refEngine !== bodyEngine) {
        return { ok: false, error: "ref and engine do not match" };
    }
    if (typeof input.pinned !== "boolean") {
        return { ok: false, error: "pinned must be a boolean" };
    }
    return {
        ok: true,
        ref: refEngine ? `${refEngine}:${refMatch?.[2] || ""}` : `${engine}:${rawRef}`,
        engine,
        pinned: input.pinned,
    };
}
function normalizeEngine(value) {
    const text = String(value || "").trim().toLowerCase();
    return text === "codex" || text === "claude" || text === "trae" ? text : null;
}
function normalizeTouchInput(input) {
    const ref = normalizeSessionRef(input.ref);
    if (!ref) {
        return { ok: false, error: "invalid ref" };
    }
    return {
        ok: true,
        ref,
        cwd: normalizeProjectKey(input.cwd),
        at: validDateText(input.at) || new Date().toISOString(),
    };
}
function normalizeSessionRef(value) {
    const text = String(value || "").trim();
    const match = /^(codex|claude|trae):(.+)$/i.exec(text);
    const engine = match ? normalizeEngine(match[1]) : null;
    const id = String(match?.[2] || "").trim();
    return engine && id ? `${engine}:${id}` : "";
}
function normalizeProjectKey(value) {
    return String(value || "").trim().slice(0, 2048);
}
function incrementUsageRecord(records, key, at) {
    const current = records[key];
    return {
        ...records,
        [key]: {
            count: Math.min(999999, Math.max(0, Math.floor(Number(current?.count) || 0)) + 1),
            last: at,
        },
    };
}
function normalizeUsageMap(value, limit, normalizeKey) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const entries = [];
    for (const [rawKey, rawRecord] of Object.entries(value)) {
        const key = normalizeKey(rawKey);
        if (!key || !rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
            continue;
        }
        const record = rawRecord;
        const count = Math.min(999999, Math.max(0, Math.floor(Number(record.count) || 0)));
        const last = validDateText(record.last);
        if (count <= 0 || !last) {
            continue;
        }
        entries.push([key, { count, last }]);
    }
    entries.sort((a, b) => new Date(b[1].last).getTime() - new Date(a[1].last).getTime());
    return Object.fromEntries(entries.slice(0, limit));
}
function validDateText(value) {
    const text = String(value || "").trim();
    if (!text) {
        return "";
    }
    const time = new Date(text).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : "";
}
async function writeLauncherPrefs(prefs) {
    const dir = dirname(PREFS_PATH);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.launcher-prefs.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
    try {
        await writeFile(tmpPath, `${JSON.stringify(normalizePrefs(prefs), null, 2)}\n`, "utf8");
        await rename(tmpPath, PREFS_PATH);
    }
    catch (error) {
        await rm(tmpPath, { force: true }).catch(() => { });
        throw error;
    }
}
