import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
export function createShareStore(config) {
    if (config.kind === "file") {
        return createFileShareStore(config.filePath);
    }
    throw new Error(`Unsupported share store: ${config.kind || "unknown"}`);
}
export function createFileShareStore(filePath) {
    let queue = Promise.resolve();
    function enqueue(operation) {
        const run = queue.then(operation, operation);
        queue = run.catch(() => undefined);
        return run;
    }
    return {
        putShare(record) {
            return enqueue(async () => {
                const existing = await readShares(filePath);
                await writeShares(filePath, existing.filter((share) => share.id !== record.id).concat(record));
            });
        },
        async getShare(id) {
            const record = (await readShares(filePath)).find((share) => share.id === id);
            return isExpired(record) ? undefined : record;
        },
        async listShares() {
            return (await readShares(filePath))
                .filter((share) => !isExpired(share))
                .sort(compareSharesNewestFirst);
        },
        deleteShare(id) {
            return enqueue(async () => {
                const existing = await readShares(filePath);
                const next = existing.filter((share) => share.id !== id);
                if (next.length === existing.length) {
                    return false;
                }
                await writeShares(filePath, next);
                return true;
            });
        },
        async countShares() {
            return (await readShares(filePath)).filter((share) => !isExpired(share)).length;
        },
    };
}
function compareSharesNewestFirst(left, right) {
    const leftTime = new Date(left.updatedAt || left.createdAt || "").getTime();
    const rightTime = new Date(right.updatedAt || right.createdAt || "").getTime();
    const delta = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    return delta || String(right.id).localeCompare(String(left.id));
}
async function readShares(filePath) {
    try {
        const parsed = JSON.parse(await readFile(filePath, "utf8"));
        const entries = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === "object" && Array.isArray(parsed.entries)
                ? parsed.entries
                : [];
        return entries.flatMap((entry) => normalizeShareRecord(entry) ?? []);
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
async function writeShares(filePath, records) {
    const dir = path.dirname(filePath);
    const tempFile = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
    await mkdir(dir, { recursive: true });
    try {
        await writeFile(tempFile, `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), entries: records }, null, 2)}\n`, "utf8");
        await rename(tempFile, filePath);
    }
    catch (error) {
        await rm(tempFile, { force: true }).catch(() => undefined);
        throw error;
    }
}
function normalizeShareRecord(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    const id = sanitizeText(record.id, 120);
    if (!id) {
        return undefined;
    }
    return {
        id,
        title: sanitizeText(record.title, 240) || id,
        engine: sanitizeText(record.engine, 80) || "codex",
        engineLabel: sanitizeText(record.engineLabel, 80) || "Codex",
        sourceRef: sanitizeText(record.sourceRef, 240) || undefined,
        createdAt: normalizeDate(record.createdAt) || new Date().toISOString(),
        updatedAt: normalizeDate(record.updatedAt) || new Date().toISOString(),
        expiresAt: normalizeDate(record.expiresAt) || undefined,
        redacted: record.redacted !== false,
        turnCount: Number.isFinite(Number(record.turnCount)) ? Number(record.turnCount) : 0,
        owner: normalizeShareOwner(record.owner),
        snapshot: record.snapshot,
    };
}
function normalizeShareOwner(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const owner = value;
    const id = sanitizeText(owner.id, 80);
    const login = sanitizeText(owner.login, 80);
    if (!id || !login) {
        return undefined;
    }
    return {
        id,
        login,
        avatarUrl: sanitizeText(owner.avatarUrl, 400) || undefined,
        profileUrl: sanitizeText(owner.profileUrl, 400) || undefined,
    };
}
function normalizeDate(value) {
    const date = typeof value === "string" ? new Date(value) : undefined;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
function isExpired(record) {
    return Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() <= Date.now());
}
function sanitizeText(value, maxLength) {
    return typeof value === "string"
        ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
        : "";
}
