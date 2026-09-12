import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("RAG HTTP contract: CSRF, streaming, real parser, invalid citations, cancellation and busy lock", { timeout: 60000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rag-http-"));
  let invalidCitation = false, blockChat = false, chatStarted;
  const pending = new Set();
  const model = http.createServer(async (request, response) => {
    if (request.url === "/api/tags") { response.end(JSON.stringify({ models: [{ name: "qwen3:4b" }, { name: "qwen3-embedding:0.6b" }] })); return; }
    const chunks = []; for await (const c of request) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (request.url === "/api/embed") { response.end(JSON.stringify({ embeddings: body.input.map(() => [1, 0.5, 0.2]) })); return; }
    if (blockChat) { pending.add(response); response.once("close", () => pending.delete(response)); chatStarted?.(); return; }
    const evidence = JSON.parse(body.messages[1].content).evidence;
    response.end(JSON.stringify({ message: { content: JSON.stringify({ insufficient: false, claims: [{ text: "最终通过修正 preload 路径修复白屏。", citations: [invalidCitation ? 999 : evidence[0].id] }] }) }, prompt_eval_count: 10, eval_count: 10 }));
  });
  model.listen(0, "127.0.0.1"); await once(model, "listening");
  const reservation = http.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const token = "rag-http-test-csrf-token-123456789";
  const codex = path.join(dir, "codex"), claude = path.join(dir, "claude");
  const project = path.join(claude, "projects", "-rag-fixture");
  await mkdir(codex, { recursive: true }); await mkdir(project, { recursive: true });
  const id = "12345678-1234-4234-8234-123456789012";
  await writeFile(path.join(project, id + ".jsonl"), [
    { type: "user", sessionId: id, cwd: "/rag-fixture", timestamp: "2026-08-21T10:00:00Z", message: { role: "user", content: "Electron 白屏如何修复" } },
    { type: "assistant", sessionId: id, timestamp: "2026-08-21T10:00:01Z", message: { role: "assistant", content: "最终修正 preload 路径，测试通过。" } },
  ].map(JSON.stringify).join("\n") + "\n");
  const child = spawn(process.execPath, ["dist/cli/agent-snapshot.mjs", "serve", "--port", String(port), "--host", "127.0.0.1"], { env: { ...process.env, AGENT_SNAPSHOTS_RAG_PROVIDER: "ollama", AGENT_SNAPSHOTS_RAG_MODEL: "qwen3:4b", CODEX_HOME: codex, CLAUDE_HOME: claude, AGENT_SNAPSHOT_EXTRA_CODEX_HOMES: "", AGENT_SNAPSHOT_DISABLE_CODEX_HOME_AUTODETECT: "1", XDG_CACHE_HOME: path.join(dir, "cache"), AGENT_SNAPSHOTS_RAG_INDEX: path.join(dir, "rag.db"), SNAPSHOT_OLLAMA_URL: `http://127.0.0.1:${model.address().port}`, AGENT_SNAPSHOT_MUTATION_CSRF_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", (c) => { output += c; }); child.stderr.on("data", (c) => { output += c; });
  const headers = { origin, "content-type": "application/json", "x-agent-snapshot-csrf": token };
  const ask = (body, extra = {}) => fetch(origin + "/api/rag/ask", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body), ...extra });
  const events = async (response) => (await response.text()).trim().split("\n").map(JSON.parse);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(origin + "/api/rag/status")).ok) { ready = true; break; } } catch {}
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, output);
    assert.equal((await fetch(origin + "/api/rag/ask")).status, 405);
    assert.equal((await ask({ query: "test" }, { headers: { origin } })).status, 403);
    assert.equal((await ask({ query: "test" }, { headers: { ...headers, origin: "https://evil.example" } })).status, 403);
    assert.equal((await ask("{")).status, 400);
    assert.equal((await ask(null)).status, 400);
    assert.equal((await ask({ query: "x".repeat(2001) })).status, 400);
    assert.equal((await ask({ query: "test", source: "invalid" })).status, 400);
    const response = await ask({ query: "Electron 白屏" });
    assert.match(response.headers.get("content-type"), /ndjson/);
    const stream = await events(response);
    assert.equal(stream.at(-1).type, "answer");
    assert(stream.at(-1).evidence[0].text.includes("preload"));
    assert(stream.at(-1).evidence[0].ref.includes(id));
    const scoped = await events(await ask({ query: "Electron", cwd: "/other-project" }));
    assert(scoped.at(-1).insufficient);
    invalidCitation = true;
    const invalid = await events(await ask({ query: "Electron" }));
    assert.equal(invalid.at(-1).type, "error");
    assert(!invalid.some((e) => e.type === "answer"));
    invalidCitation = false; blockChat = true;
    const started = new Promise((resolve) => { chatStarted = resolve; });
    const abort = new AbortController();
    const waiting = await ask({ query: "Electron" }, { signal: abort.signal });
    const consume = waiting.text().catch(() => "aborted");
    await started;
    assert.equal((await ask({ query: "Electron" })).status, 409);
    abort.abort(); await consume;
    let unlocked = false;
    for (let i = 0; i < 30; i++) {
      const status = await (await fetch(origin + "/api/rag/status")).json();
      if (!status.busy) { unlocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(unlocked, "cancel must release the server lock");
  } finally {
    child.kill(); if (child.exitCode === null) await once(child, "exit");
    for (const response of pending) response.destroy();
    model.closeAllConnections(); await new Promise((resolve) => model.close(resolve));
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
