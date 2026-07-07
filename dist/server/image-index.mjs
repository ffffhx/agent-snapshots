// @ts-nocheck
const MAX_SCAN_SESSIONS = 300;
const DEFAULT_IMAGE_LIMIT = 36;
const MAX_IMAGE_LIMIT = 120;
const MAX_IMAGE_REF_CHARS = 8192;
const INLINE_IMAGE_RE = /^data:(image\/(?:png|jpe?g|gif|webp));base64,([\s\S]+)$/i;
const sessionImageCache = new Map();
export async function listImageEntries({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, listSessions, loadSnapshot, source = "all", limit = DEFAULT_IMAGE_LIMIT, offset = 0, }) {
    const pageLimit = clampPositive(limit, DEFAULT_IMAGE_LIMIT, MAX_IMAGE_LIMIT);
    const pageOffset = Math.max(0, Number(offset) || 0);
    const targetCount = pageOffset + pageLimit;
    const imageSource = normalizeSource(source);
    const sessions = await listSessions({
        codexHome,
        claudeHome,
        traeHome,
        traeAppHome,
        traeRecordingsDir,
        limit: MAX_SCAN_SESSIONS,
        cwd: "",
        includeArchived: true,
        source: imageSource,
        completeOnly: false,
    });
    const entries = [];
    let scanned = 0;
    let failed = 0;
    for (const session of sessions.slice(0, MAX_SCAN_SESSIONS)) {
        scanned += 1;
        try {
            const sessionEntries = await readSessionImages(session, {
                codexHome,
                claudeHome,
                traeHome,
                traeAppHome,
                traeRecordingsDir,
                loadSnapshot,
            });
            entries.push(...sessionEntries);
            if (entries.length >= targetCount) {
                break;
            }
        }
        catch {
            failed += 1;
        }
        await yieldToEventLoop();
    }
    const page = entries.slice(pageOffset, pageOffset + pageLimit).map(publicImageEntry);
    return {
        entries: page,
        limit: pageLimit,
        offset: pageOffset,
        scanned,
        failed,
        scanLimit: MAX_SCAN_SESSIONS,
        hasMore: entries.length > pageOffset + pageLimit || scanned < Math.min(sessions.length, MAX_SCAN_SESSIONS),
    };
}
export async function readImageBytes({ ref, codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, loadSnapshot, }) {
    const target = decodeImageId(ref);
    if (!target) {
        return null;
    }
    let snapshot;
    try {
        snapshot = await loadSnapshot(target.sessionRef, {
            codexHome,
            claudeHome,
            traeHome,
            traeAppHome,
            traeRecordingsDir,
            includeTools: false,
            includeToolOutput: false,
            redact: false,
        });
    }
    catch {
        return null;
    }
    const turn = Array.isArray(snapshot?.turns) ? snapshot.turns[target.turnIndex] : null;
    const image = Array.isArray(turn?.images) ? turn.images[target.imageIndex] : null;
    const parsed = parseInlineImageSrc(image?.src);
    if (!parsed) {
        return null;
    }
    return parsed;
}
async function readSessionImages(session, options) {
    const ref = sessionRef(session);
    const fingerprint = sessionFingerprint(session);
    const cached = sessionImageCache.get(ref);
    if (cached?.fingerprint === fingerprint) {
        return cached.entries;
    }
    const snapshot = await options.loadSnapshot(ref, {
        codexHome: options.codexHome,
        claudeHome: options.claudeHome,
        traeHome: options.traeHome,
        traeAppHome: options.traeAppHome,
        traeRecordingsDir: options.traeRecordingsDir,
        includeTools: false,
        includeToolOutput: false,
        redact: false,
    });
    const entries = extractSnapshotImages(snapshot, session, ref);
    sessionImageCache.set(ref, { fingerprint, entries });
    return entries;
}
function extractSnapshotImages(snapshot, session, ref) {
    const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];
    const title = String(session?.title || snapshot?.title || ref);
    const project = String(session?.displayCwd || session?.cwd || snapshot?.displayCwd || snapshot?.cwd || "");
    const engine = normalizeSource(snapshot?.engine || session?.engine || ref.split(":")[0]);
    const engineLabel = String(snapshot?.engineLabel || session?.engineLabel || engineLabelFor(engine));
    const entries = [];
    turns.forEach((turn, turnIndex) => {
        const images = Array.isArray(turn?.images) ? turn.images : [];
        images.forEach((image, imageIndex) => {
            const parsed = parseInlineImageSrc(image?.src);
            if (!parsed) {
                return;
            }
            const turnNumber = positiveNumber(turn?.turn) || turnIndex + 1;
            entries.push({
                id: encodeImageId({ sessionRef: ref, turnIndex, imageIndex }),
                sessionRef: ref,
                sessionTitle: title,
                project,
                engine,
                engineLabel,
                turnIndex,
                turnNumber,
                timestamp: String(turn?.timestamp || snapshot?.mtime || session?.mtime || snapshot?.generatedAt || ""),
                mime: parsed.mime,
            });
        });
    });
    return entries;
}
function publicImageEntry(entry) {
    return {
        id: entry.id,
        sessionRef: entry.sessionRef,
        sessionTitle: entry.sessionTitle,
        project: entry.project,
        engine: entry.engine,
        engineLabel: entry.engineLabel,
        turnIndex: entry.turnIndex,
        turnNumber: entry.turnNumber,
        timestamp: entry.timestamp,
        mime: entry.mime,
    };
}
function parseInlineImageSrc(src) {
    const match = String(src || "").match(INLINE_IMAGE_RE);
    if (!match) {
        return null;
    }
    const mime = match[1].toLowerCase();
    const base64 = match[2].replace(/\s+/g, "");
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        return null;
    }
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length) {
        return null;
    }
    return { mime, bytes };
}
function encodeImageId({ sessionRef, turnIndex, imageIndex }) {
    return Buffer.from(JSON.stringify({ v: 1, r: sessionRef, t: turnIndex, i: imageIndex }), "utf8").toString("base64url");
}
function decodeImageId(ref) {
    try {
        const text = String(ref || "");
        if (!text || text.length > MAX_IMAGE_REF_CHARS) {
            return null;
        }
        const decoded = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
        const sessionRef = String(decoded?.r || "");
        const turnIndex = Number(decoded?.t);
        const imageIndex = Number(decoded?.i);
        if (!sessionRef || decoded?.v !== 1 || !Number.isInteger(turnIndex) || turnIndex < 0 || !Number.isInteger(imageIndex) || imageIndex < 0) {
            return null;
        }
        return { sessionRef, turnIndex, imageIndex };
    }
    catch {
        return null;
    }
}
function sessionRef(session) {
    const engine = normalizeSource(session?.engine || "codex");
    return String(session?.ref || `${engine}:${session?.id || ""}`);
}
function sessionFingerprint(session) {
    return [
        sessionRef(session),
        String(session?.filePath || session?.displayFilePath || ""),
        String(session?.mtime || ""),
        String(session?.size || ""),
    ].join("\x1f");
}
function normalizeSource(value) {
    const key = String(value || "all").toLowerCase();
    return key === "claude" || key === "trae" || key === "codex" ? key : "all";
}
function engineLabelFor(engine) {
    if (engine === "claude")
        return "Claude Code";
    if (engine === "trae")
        return "Trae";
    return "Codex";
}
function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}
function clampPositive(value, fallback, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        return fallback;
    }
    return Math.min(Math.floor(number), max);
}
function yieldToEventLoop() {
    return new Promise((resolve) => setImmediate(resolve));
}
