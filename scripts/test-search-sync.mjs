import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rename, unlink, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startSearchSync } from "../dist/server/search-sync.mjs";

const temp = await mkdtemp(path.join(os.tmpdir(), "agent-search-sync-"));
process.env.XDG_CACHE_HOME = path.join(temp, "cache");
process.env.AGENT_SNAPSHOT_DISABLE_CODEX_HOME_AUTODETECT = "1";
process.env.AGENT_SNAPSHOT_EXTRA_CODEX_HOMES = "";
const codexHome = path.join(temp, "codex");
const claudeHome = path.join(temp, "claude");
const { searchIndexed, searchFileState, closeSearchIndexDatabases } = await import("../dist/server/search-index.mjs");
let service;
let events = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(50); }
  throw new Error(`${label}: ${JSON.stringify(events.slice(-10))}`);
}
const message = (text) => JSON.stringify({ type: "response_item", timestamp: "2026-09-10T00:00:00.000Z", payload: {
  type: "message", role: "user", content: [{ type: "input_text", text }],
} }) + "\n";
async function fixture(file, id, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ type: "session_meta", payload: { id, cwd: temp } }) + "\n" + message(text));
}
async function matched(query) { return (await searchIndexed({ query })).matched; }
function start(extra = {}) {
  events = [];
  service = startSearchSync({ codexHome, claudeHome, debounceMs: 80, maxWaitMs: 300, reconcileMs: 3600000, ...extra }, {
    onMessage: (event) => events.push(event),
  });
}
try {
  // Start with nonexistent transcript directories, then create a nested session.
  await mkdir(codexHome, { recursive: true });
  await mkdir(claudeHome, { recursive: true });
  start();
  await until(() => events.some((e) => e.type === "reconciled"), "initial scan");
  const file = path.join(codexHome, "sessions", "2026", "09", "10", "first.jsonl");
  await fixture(file, "first", "initialneedle");
  await until(() => matched("initialneedle"), "new file notification");
  console.log("PASS new session in a newly created nested directory");

  // Visible message timestamp is deliberately unchanged; size still invalidates.
  const before = await stat(file);
  await appendFile(file, message("appendedneedle"));
  await utimes(file, before.atime, before.mtime);
  await until(() => matched("appendedneedle"), "modified file");
  assert.equal((await (await searchFileState()).prepare("SELECT count(*) AS n FROM docs").get()).n, 1);
  console.log("PASS append updates one row even with unchanged message time");

  const updatesBefore = events.filter((e) => e.type === "updated" && e.file === file).length;
  let updatedDuringStream = false;
  for (let i = 0; i < 18; i++) {
    await appendFile(file, message(`streamneedle${i}`));
    await pause(40);
    if (i < 16 && events.filter((e) => e.type === "updated" && e.file === file).length > updatesBefore) updatedDuringStream = true;
  }
  assert(updatedDuringStream, "continuous writes must not postpone indexing forever");
  await until(() => matched("streamneedle17"), "final streamed content");
  console.log("PASS continuous writes are indexed before the stream ends");

  const archive = path.join(codexHome, "archived_sessions", "first.jsonl");
  await mkdir(path.dirname(archive), { recursive: true });
  await rename(file, archive);
  await until(async () => {
    const results = await searchIndexed({ query: "appendedneedle" });
    return results.matched === 1 && events.some((e) => e.type === "updated" && e.file === archive);
  }, "archive move");
  await pause(300);
  assert.equal(await matched("appendedneedle"), 1);
  await unlink(archive);
  await until(async () => (await matched("appendedneedle")) === 0, "delete");
  console.log("PASS archive move and deletion update FTS");

  for (let i = 0; i < 27; i++) await fixture(path.join(codexHome, "sessions", `batch-${i}.jsonl`), `batch-${i}`, "batchneedle");
  await until(async () => (await matched("batchneedle")) === 27, "queue draining");
  console.log("PASS backlog larger than one batch drains without searches triggering sync");

  const claudeFile = path.join(claudeHome, "projects", "project", "claude-test.jsonl");
  await mkdir(path.dirname(claudeFile), { recursive: true });
  await writeFile(claudeFile, JSON.stringify({ type: "user", sessionId: "claude-test", cwd: temp, timestamp: "2026-09-10T00:00:00.000Z", message: { role: "user", content: "claudeneedle" } }) + "\n");
  await until(() => matched("claudeneedle"), "Claude new file");
  console.log("PASS Claude session notification");

  await service.stop();
  start();
  await until(() => events.some((e) => e.type === "reconciled"), "restart");
  await pause(400);
  assert.equal(events.filter((e) => e.type === "updated").length, 0);
  console.log("PASS restart skips unchanged files using persistent fingerprints");

  await service.stop();
  await fixture(file, "first", "offlineneedle");
  start({ watchEnabled: false, reconcileMs: 300 });
  await until(() => matched("offlineneedle"), "offline changes");
  await appendFile(file, message("fallbackneedle"));
  await until(() => matched("fallbackneedle"), "periodic fallback with watcher disabled");
  console.log("PASS startup catches offline edits and periodic scan catches missed events");
} finally {
  await service?.stop();
  await closeSearchIndexDatabases();
  // Retain isolated fixtures for inspection; never touch the user's session files.
}
