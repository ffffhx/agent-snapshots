// @ts-nocheck

import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

const CACHE_TTL_MS = 60_000;
const TAIL_BYTES = 256 * 1024;
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
  } catch {
    value = { available: false };
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
    } catch {
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
      } catch {
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
      } catch {
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
  } finally {
    await handle.close().catch(() => {});
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
  const updatedAt = toIso(
    limits.updated_at ||
    limits.updatedAt ||
    parent?.timestamp ||
    parent?.ts ||
    row?.timestamp ||
    row?.ts
  ) || new Date(mtimeMs || Date.now()).toISOString();
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
