import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, appendFile, stat, utimes, unlink, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSessionFile } from "agent-session-core";
import { SessionParseCache, closeSessionParseCache } from "../dist/sources/session-parse-cache.mjs";
import { loadSnapshot } from "../dist/sources/asc-adapter.mjs";

const row = (text) => JSON.stringify({ type: "response_item", timestamp: "2026-09-12T00:00:00Z", payload: {
  type: "message", role: "user", content: [{ type: "input_text", text }],
} }) + "\n";
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "session-parse-cache-"));
  const cache = new SessionParseCache(options);
  t.after(() => cache.close());
  async function file(name = "first", content = row(name)) {
    const f = { path: path.join(dir, `${name}.jsonl`), engine: "codex" };
    await writeFile(f.path, JSON.stringify({ type: "session_meta", payload: { id: name } }) + "\n" + content);
    return f;
  }
  return { dir, cache, file };
}

test("worker matches full core parse; cache and concurrent callers cannot mutate each other", async (t) => {
  const { cache, file } = await fixture(t);
  const f = await file();
  const values = await Promise.all(Array.from({ length: 12 }, () => cache.load(f)));
  const info = await stat(f.path);
  assert.deepEqual(values[0], parseSessionFile({ ...f, mtimeMs: info.mtimeMs, sizeBytes: info.size }));
  assert.equal(cache.stats().parses, 1);
  assert.equal(cache.stats().coalesced, 11);
  values[0].events[0].text = "mutated";
  assert.equal(values[1].events[0].text, "first");
  assert.equal((await cache.load(f)).events[0].text, "first");
  assert.equal(cache.stats().parses, 1);
});

test("append with preserved mtime invalidates only the changed file; truncated/replaced/deleted logs refresh", async (t) => {
  const { cache, file } = await fixture(t);
  const a = await file("a"), b = await file("b");
  await cache.load(a); await cache.load(b);
  const old = await stat(a.path);
  await appendFile(a.path, row("appended"));
  await utimes(a.path, old.atime, old.mtime);
  assert.equal((await cache.load(a)).events.length, 2);
  await cache.load(b);
  assert.equal(cache.stats().parses, 3);
  await writeFile(a.path, row("short"));
  assert.equal((await cache.load(a)).events.length, 1);
  const replacement = await file("replacement", row("replacement"));
  await rename(replacement.path, a.path);
  assert.equal((await cache.load(a)).events[0].text, "replacement");
  await unlink(a.path);
  assert.equal(await cache.load(a), null);
});

test("summary and full caches are separate; unfinished JSONL tails are picked up when completed", async (t) => {
  const { cache, file } = await fixture(t);
  const f = await file("partial", row("first") + row("second"));
  assert.equal((await cache.load(f, { maxLines: 2 })).events.length, 1);
  assert.equal((await cache.load(f)).events.length, 2);
  const next = row("complete 中文");
  await appendFile(f.path, next.slice(0, -5));
  assert.equal((await cache.load(f)).events.length, 2);
  await appendFile(f.path, next.slice(-5));
  assert.equal((await cache.load(f)).events.at(-1).text, "complete 中文");
});

test("LRU evicts by entry/serialized-byte budgets; oversized results are not retained", async (t) => {
  const { cache, file } = await fixture(t, { maxEntries: 2 });
  const a = await file("a"), b = await file("b"), c = await file("c");
  await cache.load(a); await cache.load(b); await cache.load(a); await cache.load(c);
  assert.equal(cache.stats().evictions, 1);
  await cache.load(b);
  assert.equal(cache.stats().parses, 4);
  const small = new SessionParseCache({ maxBytes: 1 });
  t.after(() => small.close());
  await small.load(a); await small.load(a);
  assert.equal(small.stats().entries, 0);
  assert.equal(small.stats().parses, 2);
});

test("worker failure rejects pending calls and a later request restarts it", async (t) => {
  const { cache, file } = await fixture(t);
  const f = await file();
  const pending = cache.load(f);
  const rejected = assert.rejects(pending, /worker exited/);
  while (!cache.worker) await new Promise((resolve) => setImmediate(resolve));
  await cache.worker.terminate();
  await rejected;
  await appendFile(f.path, row("retry"));
  assert.equal((await cache.load(f)).events.length, 2);
  await cache.close();
  await assert.rejects(cache.load(f), /closed/);
});

test("production Claude child changes refresh even when the parent is cached", async (t) => {
  const { dir } = await fixture(t);
  t.after(closeSessionParseCache);
  const f = path.join(dir, "parent.jsonl");
  const claudeRow = (text) => JSON.stringify({ type: "user", sessionId: "parent", message: { role: "user", content: text } }) + "\n";
  await writeFile(f, claudeRow("parent"));
  const childDir = path.join(dir, "parent", "subagents");
  await mkdir(childDir, { recursive: true });
  const child = path.join(childDir, "agent-abcd.jsonl");
  await writeFile(child, claudeRow("child-first"));
  const options = { codexHome: dir, claudeHome: dir, includeTools: true, includeToolOutput: true, redact: false };
  const before = await loadSnapshot(`claude:${f}`, options);
  assert.equal(before.subagents[0].turns.length, 1);
  await appendFile(child, claudeRow("child-second"));
  const after = await loadSnapshot(`claude:${f}`, options);
  assert.equal(after.subagents[0].turns.length, 2);
});

test("a write while the worker is starting is retried instead of publishing stale metadata", async (t) => {
  const { cache, file } = await fixture(t);
  const f = await file();
  const result = cache.load(f);
  while (!cache.stats().parses) await new Promise((resolve) => setImmediate(resolve));
  await appendFile(f.path, row("during-read"));
  const session = await result;
  assert.equal(session.events.at(-1).text, "during-read");
  assert.equal(session.sizeBytes, (await stat(f.path)).size);
  assert.ok(cache.stats().retries >= 1);
});

test("production adapter preserves redaction options and notices appended content", async (t) => {
  const { dir, file } = await fixture(t);
  t.after(closeSessionParseCache);
  const f = await file("snapshot", row("api_key=sk-syntheticTestKey123456789012345"));
  const options = { codexHome: dir, claudeHome: dir, includeTools: true, includeToolOutput: false };
  const ref = `codex:${f.path}`;
  const redacted = await loadSnapshot(ref, { ...options, redact: true });
  const raw = await loadSnapshot(ref, { ...options, redact: false });
  assert.notEqual(redacted.turns[0].text, raw.turns[0].text);
  assert.ok(raw.turns[0].text.includes("sk-syntheticTestKey123456789012345"));
  await appendFile(f.path, row("new-round"));
  assert.equal((await loadSnapshot(ref, { ...options, redact: false })).turns.at(-1).text, "new-round");
});
