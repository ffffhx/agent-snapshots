import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type ShareRecord = {
  id: string;
  title: string;
  engine: string;
  engineLabel: string;
  sourceRef?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  redacted: boolean;
  turnCount: number;
  owner?: ShareOwner;
  snapshot: unknown;
};

export type ShareOwner = {
  id: string;
  login: string;
  avatarUrl?: string;
  profileUrl?: string;
};

export type ShareStore = {
  putShare(record: ShareRecord): Promise<void>;
  getShare(id: string): Promise<ShareRecord | undefined>;
  listShares(): Promise<ShareRecord[]>;
  deleteShare(id: string): Promise<boolean>;
  countShares(): Promise<number>;
};

export type ShareStoreConfig =
  | {
      kind: "file";
      filePath: string;
    };

export function createShareStore(config: ShareStoreConfig): ShareStore {
  if (config.kind === "file") {
    return createFileShareStore(config.filePath);
  }
  throw new Error(`Unsupported share store: ${(config as { kind?: string }).kind || "unknown"}`);
}

export function createFileShareStore(filePath: string): ShareStore {
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
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

function compareSharesNewestFirst(left: ShareRecord, right: ShareRecord): number {
  const leftTime = new Date(left.updatedAt || left.createdAt || "").getTime();
  const rightTime = new Date(right.updatedAt || right.createdAt || "").getTime();
  const delta = (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  return delta || String(right.id).localeCompare(String(left.id));
}

async function readShares(filePath: string): Promise<ShareRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray(parsed.entries)
        ? parsed.entries
        : [];
    return entries.flatMap((entry: unknown) => normalizeShareRecord(entry) ?? []);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeShares(filePath: string, records: ShareRecord[]): Promise<void> {
  const dir = path.dirname(filePath);
  const tempFile = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );

  await mkdir(dir, { recursive: true });

  try {
    await writeFile(
      tempFile,
      `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), entries: records }, null, 2)}\n`,
      "utf8",
    );
    await rename(tempFile, filePath);
  } catch (error) {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizeShareRecord(value: unknown): ShareRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
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

function normalizeShareOwner(value: unknown): ShareOwner | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const owner = value as Record<string, unknown>;
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

function normalizeDate(value: unknown): string {
  const date = typeof value === "string" ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function isExpired(record: ShareRecord | undefined): boolean {
  return Boolean(record?.expiresAt && new Date(record.expiresAt).getTime() <= Date.now());
}

function sanitizeText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}
