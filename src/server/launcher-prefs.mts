import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type LauncherEngine = "codex" | "claude" | "trae";

export interface LauncherPinnedSession {
  ref: string;
  engine: LauncherEngine;
  pinnedAt: string;
}

export interface LauncherPrefs {
  pinned: LauncherPinnedSession[];
}

export interface LauncherPinInput {
  ref?: unknown;
  engine?: unknown;
  pinned?: unknown;
}

const PINNED_LIMIT = 20;
const PREFS_PATH = join(homedir(), ".agent-snapshot", "launcher-prefs.json");

export async function readLauncherPrefs(): Promise<LauncherPrefs> {
  try {
    const raw = await readFile(PREFS_PATH, "utf8");
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return { pinned: [] };
  }
}

export async function setLauncherSessionPinned(input: LauncherPinInput): Promise<{ ok: true; pinned: LauncherPinnedSession[] } | { ok: false; error: string }> {
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

  const next = { pinned: nextPinned.slice(-PINNED_LIMIT) };
  await writeLauncherPrefs(next);
  return { ok: true, pinned: next.pinned };
}

function normalizePrefs(value: unknown): LauncherPrefs {
  const pinned = Array.isArray((value as LauncherPrefs | null)?.pinned)
    ? (value as LauncherPrefs).pinned
    : [];
  const normalized: LauncherPinnedSession[] = [];
  const seen = new Set<string>();

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
  };
}

function normalizePinInput(input: LauncherPinInput): { ok: true; ref: string; engine: LauncherEngine; pinned: boolean } | { ok: false; error: string } {
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

function normalizeEngine(value: unknown): LauncherEngine | null {
  const text = String(value || "").trim().toLowerCase();
  return text === "codex" || text === "claude" || text === "trae" ? text : null;
}

function validDateText(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

async function writeLauncherPrefs(prefs: LauncherPrefs): Promise<void> {
  const dir = dirname(PREFS_PATH);
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.launcher-prefs.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmpPath, `${JSON.stringify(normalizePrefs(prefs), null, 2)}\n`, "utf8");
    await rename(tmpPath, PREFS_PATH);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}
