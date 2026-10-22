// @ts-nocheck
import { parentPort, workerData } from "node:worker_threads";
import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { discoverSessionSummaryCandidates } from "../sources/index.mjs";
import { discoverCodexHomes } from "../sources/codex-homes.mjs";
import { syncSearchFile, removeSearchFile, searchFileState, markSearchHomes } from "./search-index.mjs";

import { tokenizerVersion } from "./search-tokenizer.mjs";

const options = { ...workerData, claudeHome: workerData.claudeHome || path.join(os.homedir(), ".claude") };
const debounceMs = workerData.debounceMs ?? 2000;
const maxWaitMs = workerData.maxWaitMs ?? 10000;
const reconcileMs = workerData.reconcileMs ?? 300000;
const pending = new Map();
const watchers = new Map();
let roots = [];
let busy = false;
let needsReconcile = true;
let reconcileDue = 0;
const skip = new Set(["node_modules", ".git", "Cache", "cache", "tmp", "logs", "subagents", "workflows", "tool-results", "memory"]);
const report = (message) => parentPort.postMessage(message);
const inside = (root, file) => { const rel = path.relative(root, file); return rel === "" || (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel)); };

function enqueue(file) {
  const now = Date.now();
  const old = pending.get(file);
  pending.set(file, { first: old?.first ?? now, due: Math.min(now + debounceMs, (old?.first ?? now) + maxWaitMs) });
}

function requestReconcile() {
  if (!needsReconcile) reconcileDue = Date.now() + debounceMs;
  needsReconcile = true;
}

async function refreshWatchers() {
  const homes = await discoverCodexHomes(options.codexHome);
  roots = homes.flatMap((home) => ["sessions", "archived_sessions"].map((dir) => ({ path: path.join(home.home, dir), engine: "codex", home })));
  roots.push(...["projects", "sessions"].map((dir) => ({ path: path.join(options.claudeHome, dir), engine: "claude" })));
  const wanted = new Set();
  for (const root of roots) {
    if (workerData.watchEnabled === false) continue;
    // Watch the nearest existing ancestor so creation of a missing root is seen.
    let watchPath = root.path;
    while (!(await stat(watchPath).catch(() => null))?.isDirectory()) {
      const parent = path.dirname(watchPath);
      if (parent === watchPath) break;
      watchPath = parent;
    }
    wanted.add(watchPath);
    if (watchers.has(watchPath)) continue;
    try {
      const watcher = watch(watchPath, { recursive: true }, (_event, filename) => {
        if (!filename) { requestReconcile(); return; }
        const file = path.resolve(watchPath, String(filename));
        if (!roots.some((item) => inside(item.path, file) || inside(file, item.path))) return;
        if (file.endsWith(".jsonl")) enqueue(file);
        else if (_event === "rename") requestReconcile(); // directory creation, rename or removal
      });
      watcher.on("error", (error) => {
        watcher.close(); watchers.delete(watchPath); requestReconcile();
        report({ type: "warning", error: error.message });
      });
      watchers.set(watchPath, watcher);
    } catch (error) {
      report({ type: "warning", error: error.message });
    }
  }
  for (const [key, watcher] of watchers) if (!wanted.has(key)) { watcher.close(); watchers.delete(key); }
}

async function update(file) {
  const root = roots.find((item) => inside(item.path, file));
  if (!root) return;
  const parts = path.relative(root.path, file).split(path.sep);
  if (parts.slice(0, -1).some((part) => skip.has(part)) || parts.length > 9) return;
  if (root.engine === "claude" && (path.basename(file) === "journal.jsonl" || /^agent-.*\.jsonl$/.test(path.basename(file)))) return;
  let info;
  try { info = await stat(file); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await removeSearchFile(file);
    report({ type: "deleted", file });
    return;
  }
  if (!info.isFile() || info.size > 512 * 1024 * 1024) return;
  const changed = await syncSearchFile({
    filePath: file, engine: root.engine, mtimeMs: info.mtimeMs, size: info.size, sizeBytes: info.size,
    codexHomeKey: root.home?.key || "", codexHomeLabel: root.home?.label || "", codexHomePrimary: root.home?.primary ?? true,
  }, options);
  if (changed) report({ type: "updated", file });
}

async function reconcile() {
  await refreshWatchers();
  const candidates = await discoverSessionSummaryCandidates(options);
  const db = await searchFileState();
  const states = new Map(db.prepare("SELECT * FROM search_files_v1").all().map((row) => [row.path, row]));
  for (const candidate of candidates) {
    const fingerprint = JSON.stringify([candidate.mtimeMs, candidate.size, candidate.codexHomeKey, candidate.codexHomePrimary, tokenizerVersion]);
    const old = states.get(candidate.filePath);
    if (!old || old.fingerprint !== fingerprint || !JSON.parse(old.keys_json).every((key) => db.prepare("SELECT 1 FROM docs WHERE cache_key = ?").get(key))) enqueue(candidate.filePath);
  }
  // Never infer deletion from an incomplete directory walk (permissions, limits).
  // Also include legacy rows, which have no fingerprint yet.
  const known = new Set([...states.keys(), ...db.prepare("SELECT summary_json FROM docs").all().flatMap((row) => {
    try { return [JSON.parse(row.summary_json).filePath].filter(Boolean); } catch { return []; }
  })]);
  for (const file of known) {
    if (!roots.some((root) => inside(root.path, file))) continue;
    try { await stat(file); } catch (error) { if (error.code === "ENOENT") enqueue(file); }
  }
  await markSearchHomes(options);
  report({ type: "reconciled", scanned: candidates.length, pending: pending.size });
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (needsReconcile && Date.now() >= reconcileDue) {
      needsReconcile = false;
      await reconcile();
    }
    // Short batches leave room for notifications; pending entries are never dropped.
    const batch = [...pending].filter(([, state]) => state.due <= Date.now()).slice(0, 20);
    for (const [file, state] of batch) {
      if (pending.get(file) !== state) continue;
      pending.delete(file);
      try { await update(file); } catch (error) {
        if (!pending.has(file)) pending.set(file, { first: Date.now(), due: Date.now() + 10000 });
        report({ type: "retry", file, error: error.message });
      }
    }
  } catch (error) {
    needsReconcile = true;
    reconcileDue = Date.now() + 10000;
    report({ type: "warning", error: error.message });
  } finally { busy = false; }
}
parentPort.on("message", (message) => { if (message.type === "reconcile") requestReconcile(); });
setInterval(requestReconcile, reconcileMs);
setInterval(() => void tick(), 100);
void tick();
