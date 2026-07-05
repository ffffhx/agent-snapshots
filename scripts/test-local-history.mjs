#!/usr/bin/env node
// Unit tests for the Claude/Codex session parsing core (dist/sources/local-history.mjs).
// Builds throwaway fixture homes so the tests are hermetic and do not touch the
// developer's real ~/.claude / ~/.codex sessions.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { listSessions, loadSnapshot } = await import(path.join(ROOT_DIR, "dist/sources/local-history.mjs"));
const { renderMarkdownHtml } = await import(path.join(ROOT_DIR, "dist/renderers/markdown.mjs"));
const { prewarmSemanticIndex, semanticSearchSessions } = await import(path.join(ROOT_DIR, "dist/server/semantic-index.mjs"));

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function jsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

function fakeSemanticEmbed(texts) {
  return Promise.resolve(texts.map((text) => {
    const value = String(text || "").toLowerCase();
    const vector = [
      countMatches(value, /hide|hidden|source|trae|隐藏|来源|列表/g),
      countMatches(value, /deploy|release|发布|部署/g),
      countMatches(value, /price|cost|价格|费用/g),
    ];
    const magnitude = Math.sqrt(vector.reduce((total, item) => total + item * item, 0)) || 1;
    return vector.map((item) => item / magnitude);
  }));
}

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

// Write a Claude transcript at projects/<encoded-cwd>/<id>.jsonl
async function writeClaudeSession(claudeHome, encodedDir, id, rows) {
  const dir = path.join(claudeHome, "projects", encodedDir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.jsonl`), jsonl(rows), "utf8");
  return dir;
}

function userRow(id, cwd, content) {
  return { sessionId: id, cwd, type: "user", message: { role: "user", content }, timestamp: "2026-06-01T00:00:00.000Z" };
}
function assistantRow(id, content) {
  return { sessionId: id, type: "assistant", message: { role: "assistant", content }, timestamp: "2026-06-01T00:00:01.000Z" };
}

async function makeClaudeHome() {
  return mkdtemp(path.join(os.tmpdir(), "cs-claude-test-"));
}

// --- Markdown rendering -----------------------------------------------------

test("local code path markdown links render as inline code instead of anchors", () => {
  const html = renderMarkdownHtml(
    "改动在 [src/server/local-viewer-app.mts](/Users/bytedance/Code/codex-snapshots/src/server/local-viewer-app.mts)，" +
      "并同步生成 [dist/server/local-viewer-app.mjs](dist/server/local-viewer-app.mjs)。",
  );
  assert.ok(html.includes("<code>src/server/local-viewer-app.mts</code>"), html);
  assert.ok(html.includes("<code>dist/server/local-viewer-app.mjs</code>"), html);
  assert.ok(!html.includes('href="/Users/bytedance/Code/codex-snapshots/src/server/local-viewer-app.mts"'), html);
  assert.ok(!html.includes('href="dist/server/local-viewer-app.mjs"'), html);
});

test("web markdown links stay clickable", () => {
  const html = renderMarkdownHtml(
    "验证 [本地查看器](http://127.0.0.1:4321/)、[官网](https://example.com) 和 [分享页](/share/index.html)。",
  );
  assert.ok(html.includes('<a href="http://127.0.0.1:4321/"'), html);
  assert.ok(html.includes('<a href="https://example.com"'), html);
  assert.ok(html.includes('<a href="/share/index.html"'), html);
  assert.ok(html.includes('target="_blank"'), html);
  assert.ok(html.includes('rel="noopener noreferrer"'), html);
});

// --- Persistent semantic index ---------------------------------------------

test("semantic session search persists and reuses indexed embeddings", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "cs-semantic-index-"));
  try {
    const indexPath = path.join(home, "semantic-index.json");
    const sessions = [
      {
        id: "a",
        ref: "codex:a",
        title: "Hide Trae source",
        engine: "codex",
        engineLabel: "Codex",
        cwd: "/tmp/proj",
        displayCwd: "proj",
        mtime: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "b",
        ref: "codex:b",
        title: "Deploy notes",
        engine: "codex",
        engineLabel: "Codex",
        cwd: "/tmp/proj",
        displayCwd: "proj",
        mtime: "2026-06-01T00:01:00.000Z",
      },
    ];
    const snapshots = {
      "codex:a": { id: "a", ref: "codex:a", turns: [{ role: "user", turn: 1, text: "隐藏某个来源的会话列表，把 Trae source hide 掉。" }] },
      "codex:b": { id: "b", ref: "codex:b", turns: [{ role: "user", turn: 1, text: "Prepare deploy release checklist." }] },
    };
    let loadCount = 0;
    const options = {
      query: "隐藏来源列表",
      indexPath,
      listSessions: async ({ limit }) => sessions.slice(0, Number.isFinite(limit) ? limit : sessions.length),
      loadSnapshot: async (ref) => {
        loadCount += 1;
        return snapshots[ref];
      },
      embedder: fakeSemanticEmbed,
      model: "fake-embedding",
      scanLimit: 10,
    };

    const first = await semanticSearchSessions(options);
    assert.equal(first.updated, 2);
    assert.equal(first.results[0].ref, "codex:a");
    assert.equal(loadCount, 2);
    const persisted = JSON.parse(await readFile(indexPath, "utf8"));
    assert.equal(Object.keys(persisted.entries).length, 2);

    const second = await semanticSearchSessions(options);
    assert.equal(second.updated, 0);
    assert.equal(second.results[0].ref, "codex:a");
    assert.equal(loadCount, 2, "unchanged sessions should reuse the persisted index");

    sessions[0].mtime = "2026-06-01T00:02:00.000Z";
    const third = await semanticSearchSessions(options);
    assert.equal(third.updated, 1);
    assert.equal(third.results[0].ref, "codex:a");
    assert.equal(loadCount, 3, "only the changed session should be reloaded");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("semantic index prewarm fills stale entries without a query", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "cs-semantic-prewarm-"));
  try {
    const indexPath = path.join(home, "semantic-index.json");
    const sessions = [
      {
        id: "a",
        ref: "codex:a",
        title: "Hide Trae source",
        engine: "codex",
        engineLabel: "Codex",
        cwd: "/tmp/proj",
        displayCwd: "proj",
        mtime: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "b",
        ref: "codex:b",
        title: "Price notes",
        engine: "codex",
        engineLabel: "Codex",
        cwd: "/tmp/proj",
        displayCwd: "proj",
        mtime: "2026-06-01T00:01:00.000Z",
      },
    ];
    const snapshots = {
      "codex:a": { id: "a", ref: "codex:a", turns: [{ role: "user", turn: 1, text: "隐藏某个来源的会话列表，把 Trae source hide 掉。" }] },
      "codex:b": { id: "b", ref: "codex:b", turns: [{ role: "user", turn: 1, text: "Compare model price and cost." }] },
    };
    let loadCount = 0;
    const options = {
      indexPath,
      listSessions: async ({ limit }) => sessions.slice(0, Number.isFinite(limit) ? limit : sessions.length),
      loadSnapshot: async (ref) => {
        loadCount += 1;
        return snapshots[ref];
      },
      embedder: fakeSemanticEmbed,
      model: "fake-embedding",
      scanLimit: 10,
      updateLimit: 1,
    };

    const first = await prewarmSemanticIndex(options);
    assert.equal(first.updated, 1);
    assert.equal(first.pending, 1);
    assert.equal(first.complete, false);

    const second = await prewarmSemanticIndex(options);
    assert.equal(second.updated, 1);
    assert.equal(second.pending, 0);
    assert.equal(second.complete, true);

    const third = await prewarmSemanticIndex(options);
    assert.equal(third.updated, 0);
    assert.equal(third.pending, 0);
    assert.equal(third.complete, true);
    assert.equal(loadCount, 2, "prewarm should reuse unchanged indexed sessions");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// --- Title resolution -------------------------------------------------------

test("prefers aiTitle row for the session title", async () => {
  const home = await makeClaudeHome();
  try {
    await writeClaudeSession(home, "-tmp-projA", "11111111-1111-1111-1111-111111111111", [
      { type: "ai-title", aiTitle: "My AI Title", sessionId: "11111111-1111-1111-1111-111111111111" },
      userRow("11111111-1111-1111-1111-111111111111", "/tmp/projA", "hello world please do something useful"),
      assistantRow("11111111-1111-1111-1111-111111111111", "ok"),
    ]);
    const [s] = await listSessions({ claudeHome: home, source: "claude", limit: Infinity });
    assert.equal(s.title, "My AI Title");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a file-path first message is not treated as a slash command", async () => {
  const home = await makeClaudeHome();
  try {
    await writeClaudeSession(home, "-tmp-projB", "22222222-2222-2222-2222-222222222222", [
      userRow("22222222-2222-2222-2222-222222222222", "/tmp/projB", "/Users/me/file.doc 根据这个文件帮我做事"),
      assistantRow("22222222-2222-2222-2222-222222222222", "ok"),
    ]);
    const [s] = await listSessions({ claudeHome: home, source: "claude", limit: Infinity });
    assert.ok(s.title.startsWith("/Users/me/file.doc"), `expected path title, got: ${s.title}`);
    assert.notEqual(s.title, s.id);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a post-/clear session is titled by its first real message, not /clear", async () => {
  const home = await makeClaudeHome();
  try {
    const id = "33333333-3333-3333-3333-333333333333";
    await writeClaudeSession(home, "-tmp-projC", id, [
      userRow(id, "/tmp/projC", "<local-command-caveat>Caveat: generated while running /clear</local-command-caveat>"),
      userRow(id, "/tmp/projC", "<command-name>/clear</command-name>\n<command-message>clear</command-message>"),
      userRow(id, "/tmp/projC", "实际的第一句话 the real first message"),
      assistantRow(id, "ok"),
    ]);
    const [s] = await listSessions({ claudeHome: home, source: "claude", limit: Infinity });
    assert.ok(s.title.includes("实际的第一句话"), `expected real first message, got: ${s.title}`);
    assert.ok(!/clear/i.test(s.title), `title should not be the clear command, got: ${s.title}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a /clear-only session keeps a stable non-uuid title", async () => {
  const home = await makeClaudeHome();
  try {
    const id = "44444444-4444-4444-4444-444444444444";
    await writeClaudeSession(home, "-tmp-projD", id, [
      userRow(id, "/tmp/projD", "<command-name>/clear</command-name>\n<command-message>clear</command-message>"),
    ]);
    const [s] = await listSessions({ claudeHome: home, source: "claude", limit: Infinity });
    assert.notEqual(s.title, s.id, "empty /clear session should not fall back to the raw UUID");
    assert.ok(/clear/i.test(s.title), `expected a clear-ish title, got: ${s.title}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a secret in the first prompt is redacted from the snapshot title", async () => {
  const home = await makeClaudeHome();
  try {
    const id = "66666666-6666-6666-6666-666666666666";
    await writeClaudeSession(home, "-tmp-projF", id, [
      userRow(id, "/tmp/projF", "fix this leaked key AKIAIOSFODNN7EXAMPLE in my repo"),
      assistantRow(id, "ok"),
    ]);
    const snap = await loadSnapshot(`claude:${id}`, {
      claudeHome: home,
      includeTools: false,
      includeToolOutput: false,
      redact: true,
    });
    assert.ok(!/AKIAIOSFODNN7EXAMPLE/.test(snap.title), `title leaked the secret: ${snap.title}`);
    assert.ok(/REDACTED/.test(snap.title), `expected a redaction marker in title: ${snap.title}`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// --- Subagent exclusion + nesting ------------------------------------------

async function writeParentWithSubagent(home) {
  const encoded = "-tmp-projE";
  const parentId = "55555555-5555-5555-5555-555555555555";
  const dir = await writeClaudeSession(home, encoded, parentId, [
    { type: "ai-title", aiTitle: "Parent Session", sessionId: parentId },
    userRow(parentId, "/tmp/projE", "spawn a subagent please"),
    {
      sessionId: parentId, type: "assistant", timestamp: "2026-06-01T00:00:02.000Z",
      message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_sub1", name: "Agent", input: { description: "Do the subtask" } }] },
    },
  ]);
  const agentDir = path.join(dir, parentId, "subagents", "workflows", "wf_test");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "agent-abcdef123456.jsonl"), jsonl([
    { isSidechain: true, type: "user", message: { role: "user", content: "do the subtask now" } },
    { isSidechain: true, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_inner", name: "Bash", input: { command: "ls" } }] } },
    { isSidechain: true, type: "assistant", message: { role: "assistant", content: "subtask done" } },
  ]), "utf8");
  await writeFile(path.join(agentDir, "agent-abcdef123456.meta.json"), JSON.stringify({ agentType: "general-purpose", description: "Do the subtask", toolUseId: "toolu_sub1" }), "utf8");
  // a workflow journal that must never appear as its own session
  await writeFile(path.join(agentDir, "journal.jsonl"), jsonl([{ type: "started", key: "v2:abc" }]), "utf8");
  return { parentId };
}

test("subagent and journal artifacts are excluded from the session list", async () => {
  const home = await makeClaudeHome();
  try {
    await writeParentWithSubagent(home);
    const sessions = await listSessions({ claudeHome: home, source: "claude", limit: Infinity });
    assert.equal(sessions.length, 1, `only the parent should be listed, got ${sessions.length}`);
    assert.equal(sessions[0].title, "Parent Session");
    assert.ok(!sessions.some((s) => /^agent-/.test(s.title) || s.title === "journal"), "no artifact-titled sessions");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("loadSnapshot nests the subagent under its parent with metadata", async () => {
  const home = await makeClaudeHome();
  try {
    const { parentId } = await writeParentWithSubagent(home);
    const snap = await loadSnapshot(`claude:${parentId}`, { claudeHome: home, includeTools: true, includeToolOutput: true, redact: false });
    assert.ok(Array.isArray(snap.subagents), "snapshot.subagents should be an array");
    assert.equal(snap.subagents.length, 1, "exactly one subagent");
    const sub = snap.subagents[0];
    assert.equal(sub.agentType, "general-purpose");
    assert.equal(sub.description, "Do the subtask");
    assert.equal(sub.toolUseId, "toolu_sub1");
    assert.ok(sub.turns.length >= 2, "subagent turns parsed");
    assert.ok(sub.turns.some((t) => (t.text || "").includes("subtask done")), "subagent content present");
    assert.ok(sub.turns.some((t) => t.kind === "tool"), "subagent tool turn present when includeTools=true");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("subagents honor includeTools=false (no tool turns leak)", async () => {
  const home = await makeClaudeHome();
  try {
    const { parentId } = await writeParentWithSubagent(home);
    const snap = await loadSnapshot(`claude:${parentId}`, { claudeHome: home, includeTools: false, includeToolOutput: false, redact: false });
    const sub = snap.subagents[0];
    assert.ok(sub.turns.length >= 1, "subagent message turns still parsed");
    assert.ok(!sub.turns.some((t) => t.kind === "tool"), "no tool turns when includeTools=false");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// --- Ephemeral agent grouping (extracted from the built viewer client) ------

test("ephemeral temp-dir agent runs collapse to one group per prefix", async () => {
  // Use the evaluated client script (renderServerApp output), not the raw module
  // source, so the template-literal escaping matches what the browser runs.
  const { renderServerApp } = await import(path.join(ROOT_DIR, "dist/server/local-viewer-app.mjs"));
  const html = renderServerApp("test-csrf", {});
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const src = scripts.sort((a, b) => b.length - a.length)[0] || "";
  function extract(name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `function ${name} not found in built client`);
    let depth = 0;
    const open = src.indexOf("{", start);
    for (let j = open; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(start, j + 1); }
    }
    throw new Error(`unbalanced ${name}`);
  }
  const names = ["ephemeralAgentInfo", "projectKey", "isNoProjectSession", "isCodexStandaloneConversationPath", "isStandaloneConversationPath", "projectDisplayPath", "projectPath", "normalizeProjectPath", "projectLabel", "sortProjectGroups", "projectGroupTier", "sessionHaystack", "groupSessions", "sessionEngine"];
  const { groupSessions } = new Function(names.map(extract).join("\n") + "\n return { groupSessions };")();
  const sessions = [
    { engine: "claude", cwd: "/private/var/folders/pk/xy/T/eval-AAAAAA", title: "a", mtime: "2026-06-01T00:00:00Z" },
    { engine: "claude", cwd: "/private/var/folders/pk/xy/T/eval-bbbbbb", title: "b", mtime: "2026-06-01T00:00:00Z" },
    { engine: "claude", cwd: "/tmp/eval-CcCcCc", title: "c", mtime: "2026-06-01T00:00:00Z" },
    { engine: "claude", cwd: "/private/var/folders/pk/xy/T/judge-cl-ZZ9zz9", title: "d", mtime: "2026-06-01T00:00:00Z" },
    { engine: "claude", cwd: "/Users/me/Code/realproj", title: "e", mtime: "2026-06-02T00:00:00Z" },
  ];
  const groups = groupSessions(sessions, "");
  const evalGroup = groups.find((g) => g.label === "eval");
  assert.ok(evalGroup, "an 'eval' group should exist");
  assert.equal(evalGroup.sessions.length, 3, "all three eval-* runs collapse into one group");
  assert.equal(evalGroup.isEphemeral, true);
  const judge = groups.find((g) => g.label === "judge-cl");
  assert.ok(judge && judge.sessions.length === 1, "judge-cl collapses by prefix");
  const real = groups.find((g) => g.label === "realproj");
  assert.ok(real && !real.isEphemeral, "real project is not treated as ephemeral");
});

// --- Runner -----------------------------------------------------------------

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error instanceof Error ? error.message : error}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) {
  process.exit(1);
}
