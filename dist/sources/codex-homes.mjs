// @ts-nocheck
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const HOME_KEY_PREFIX = "home-";
const HOME_KEY_RE = /^home-[0-9a-f]{12}$/;
export function defaultCodexHome() {
    return path.join(os.homedir(), ".codex");
}
export function primaryCodexHome(value = "") {
    return path.resolve(expandHome(value || process.env.CODEX_HOME || defaultCodexHome()));
}
export async function discoverCodexHomes(primaryHome = "") {
    const primary = primaryCodexHome(primaryHome);
    const disableAutoDetect = process.env.AGENT_SNAPSHOT_DISABLE_CODEX_HOME_AUTODETECT === "1";
    const homes = [];
    const seen = new Set();
    const addHome = (home, { primary = false, label = "" } = {}) => {
        const resolved = path.resolve(expandHome(home));
        const dedupeKey = normalizeHomePath(resolved);
        if (!resolved || seen.has(dedupeKey)) {
            return;
        }
        seen.add(dedupeKey);
        homes.push({
            home: resolved,
            key: codexHomeKey(resolved),
            label: primary ? "" : (label || friendlyCodexHomeLabel(resolved)),
            primary,
        });
    };
    addHome(primary, { primary: true });
    if (!disableAutoDetect) {
        await addDefaultCodexHomeIfPresent(primary, addHome);
    }
    for (const candidate of candidateExtraCodexHomes(primary, { disableAutoDetect })) {
        const sessionsDir = path.join(candidate.home, "sessions");
        const info = await stat(sessionsDir).catch(() => null);
        if (!info?.isDirectory()) {
            continue;
        }
        addHome(candidate.home, { label: candidate.label });
    }
    return homes;
}
async function addDefaultCodexHomeIfPresent(primary, addHome) {
    const defaultHome = defaultCodexHome();
    if (normalizeHomePath(defaultHome) === normalizeHomePath(primary)) {
        return;
    }
    const sessionsDir = path.join(defaultHome, "sessions");
    const info = await stat(sessionsDir).catch(() => null);
    if (!info?.isDirectory()) {
        return;
    }
    addHome(defaultHome, { label: "default" });
}
export function codexHomeKey(home) {
    const normalized = normalizeHomePath(path.resolve(expandHome(home)));
    return HOME_KEY_PREFIX + createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}
export function codexHomeCacheKey(homeInfo) {
    return homeInfo?.key || codexHomeKey(homeInfo?.home || defaultCodexHome());
}
export function codexSessionRef(sessionId, homeInfo) {
    const id = String(sessionId || "").trim();
    if (!id) {
        return "codex:";
    }
    return homeInfo?.primary ? `codex:${id}` : `codex:${codexHomeCacheKey(homeInfo)}:${id}`;
}
export function parseCodexSessionRef(ref) {
    const text = String(ref || "").trim();
    const bare = text.startsWith("codex:") ? text.slice("codex:".length) : text;
    const split = bare.indexOf(":");
    if (split > 0) {
        const maybeKey = bare.slice(0, split);
        if (HOME_KEY_RE.test(maybeKey)) {
            return {
                homeKey: maybeKey,
                sessionId: bare.slice(split + 1),
                bareRef: bare.slice(split + 1),
            };
        }
    }
    return { homeKey: "", sessionId: bare, bareRef: bare };
}
export async function resolveCodexHomeForRef(ref, primaryHome = "", homes = null) {
    const codexHomes = homes || await discoverCodexHomes(primaryHome);
    const parsed = parseCodexSessionRef(ref);
    if (parsed.homeKey) {
        const found = codexHomes.find((home) => home.key === parsed.homeKey);
        if (found) {
            return { ...parsed, home: found, homes: codexHomes };
        }
        return { ...parsed, home: { home: primaryCodexHome(primaryHome), key: parsed.homeKey, label: "", primary: false }, homes: codexHomes };
    }
    return { ...parsed, home: codexHomes[0] || { home: primaryCodexHome(primaryHome), key: codexHomeKey(primaryCodexHome(primaryHome)), label: "", primary: true }, homes: codexHomes };
}
export function codexHomeKeys(homes) {
    return new Set((homes || []).map((home) => codexHomeCacheKey(home)).filter(Boolean));
}
function candidateExtraCodexHomes(primary, { disableAutoDetect = false } = {}) {
    const out = [];
    if (!disableAutoDetect && process.platform === "darwin") {
        out.push({
            home: path.join(os.homedir(), "Library", "Application Support", "orca", "codex-runtime-home", "home"),
            label: "orca",
        });
    }
    for (const item of String(process.env.AGENT_SNAPSHOT_EXTRA_CODEX_HOMES || "").split(":")) {
        const home = item.trim();
        if (home) {
            out.push({ home, label: friendlyCodexHomeLabel(home) });
        }
    }
    return out.filter((item) => normalizeHomePath(item.home) !== normalizeHomePath(primary));
}
function friendlyCodexHomeLabel(home) {
    const normalized = path.resolve(expandHome(home));
    const parts = normalized.split(path.sep).filter(Boolean);
    const leaf = parts[parts.length - 1] || "codex";
    const parent = parts[parts.length - 2] || "";
    const raw = leaf === "home" && parent ? parent : leaf;
    return sanitizeLabel(raw) || "extra";
}
function sanitizeLabel(value) {
    return String(value || "")
        .replace(/^codex-runtime-home$/i, "orca")
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, 18);
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
    return path.resolve(expandHome(value)).replace(/[\\/]+$/, "");
}
