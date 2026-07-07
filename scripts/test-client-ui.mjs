#!/usr/bin/env node
// Focused tests for hand-rolled launcher/viewer client logic.
// The app keeps its browser code inside server-rendered template strings, so
// these tests render the HTML, extract selected function declarations, and
// evaluate them in small deterministic harnesses.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

let launcherScriptCache = "";
let viewerScriptCache = "";

async function launcherScript() {
  if (!launcherScriptCache) {
    const { renderLauncherApp } = await import(path.join(ROOT_DIR, "dist/server/launcher-app.mjs"));
    launcherScriptCache = largestInlineScript(renderLauncherApp("test-csrf"));
  }
  return launcherScriptCache;
}

async function viewerScript() {
  if (!viewerScriptCache) {
    const { renderServerApp } = await import(path.join(ROOT_DIR, "dist/server/local-viewer-app.mjs"));
    viewerScriptCache = largestInlineScript(renderServerApp("test-csrf", {}));
  }
  return viewerScriptCache;
}

function largestInlineScript(html) {
  const scripts = [...String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  scripts.sort((a, b) => b.length - a.length);
  assert.ok(scripts[0], "rendered app should contain an inline client script");
  return scripts[0];
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in rendered client script`);
  const paramsOpen = source.indexOf("(", start);
  assert.ok(paramsOpen >= 0, `function ${name} has no parameter list`);
  let parenDepth = 0;
  let paramsClose = -1;
  for (let index = paramsOpen; index < source.length; index += 1) {
    if (source[index] === "(") {
      parenDepth += 1;
    } else if (source[index] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsClose = index;
        break;
      }
    }
  }
  assert.ok(paramsClose >= 0, `function ${name} has no closing parameter paren`);
  const open = source.indexOf("{", paramsClose);
  assert.ok(open >= 0, `function ${name} has no opening brace`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`unbalanced function body for ${name}`);
}

function evaluateFunctions(source, names, prelude, returnedNames) {
  const body = [
    prelude,
    ...names.map((name) => extractFunction(source, name)),
    `return { ${returnedNames.join(", ")} };`,
  ].join("\n");
  return new Function(body)();
}

function escPrelude() {
  return `
const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
`;
}

async function withDom(html, fn) {
  const dom = new JSDOM(html, { url: "http://127.0.0.1/" });
  const previous = new Map();
  function install(name, value) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  install("window", dom.window);
  install("document", dom.window.document);
  install("localStorage", dom.window.localStorage);
  install("HTMLElement", dom.window.HTMLElement);
  install("Node", dom.window.Node);
  install("IntersectionObserver", undefined);
  try {
    return await fn(dom);
  } finally {
    for (const [name, descriptor] of [...previous.entries()].reverse()) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
    dom.window.close();
  }
}

async function launcherRuntime() {
  const source = await launcherScript();
  return evaluateFunctions(
    source,
    [
      "relTime",
      "engineKey",
      "bareSessionId",
      "sessionKey",
      "isCompleteItem",
      "isLiveCandidate",
      "mergeRecent",
      "rankRecentRows",
      "decayedUsageBoost",
      "sessionMtimeMs",
      "normalizePercent",
      "formatReset",
      "freshnessText",
      "quotaMeter",
      "resumeCommand",
      "setScope",
    ],
    `
${escPrelude()}
const SCOPES = ["all", "codex", "claude", "trae"];
const state = { accessPrefs: {}, projectPrefs: {}, scope: "all" };
let runCallCount = 0;
function run() { runCallCount += 1; }
function runCalls() { return runCallCount; }
`,
    [
      "state",
      "runCalls",
      "sessionKey",
      "isLiveCandidate",
      "mergeRecent",
      "rankRecentRows",
      "decayedUsageBoost",
      "quotaMeter",
      "resumeCommand",
      "setScope",
    ],
  );
}

async function viewerRuntime(names, prelude, returnedNames) {
  return evaluateFunctions(await viewerScript(), names, prelude, returnedNames);
}

// --- Launcher --------------------------------------------------------------

test("launcher decays usage boost with age", async () => {
  const { decayedUsageBoost } = await launcherRuntime();
  const now = Date.parse("2026-07-08T12:00:00.000Z");
  const fresh = decayedUsageBoost({ count: 2, last: new Date(now).toISOString() }, now, 1000, 100000);
  const stale = decayedUsageBoost({ count: 2, last: new Date(now - 14 * 86400000).toISOString() }, now, 1000, 100000);
  assert.ok(stale < fresh, `expected stale boost ${stale} to be below fresh boost ${fresh}`);
  assert.ok(stale > 0, "decayed boost should not drop to zero for valid old usage");
});

test("launcher keeps today's recent sessions above old boosted rows", async () => {
  const { state, rankRecentRows } = await launcherRuntime();
  const today = { engine: "codex", ref: "codex:today", title: "Today", mtime: new Date().toISOString() };
  const old = {
    engine: "codex",
    ref: "codex:old",
    title: "Old favorite",
    mtime: new Date(Date.now() - 8 * 86400000).toISOString(),
  };
  state.accessPrefs = { "codex:old": { count: 1000, last: new Date().toISOString() } };
  const ranked = rankRecentRows([old, today]);
  assert.equal(ranked[0].ref, "codex:today");
  assert.equal(ranked[1].ref, "codex:old");
  assert.equal(ranked[1]._frecencyBoosted, true);
});

test("launcher merges pinned, live, and recent rows with dedupe", async () => {
  const { mergeRecent } = await launcherRuntime();
  const pinned = { engine: "codex", ref: "codex:pinned", id: "pinned", title: "Pinned" };
  const live = { engine: "claude", ref: "claude:live", id: "live", title: "Live", complete: false };
  const recent = { engine: "codex", ref: "codex:recent", id: "recent", title: "Recent", mtime: "2026-07-08T00:00:00.000Z" };
  const merged = mergeRecent(
    [pinned],
    [{ ...pinned, complete: false }, live],
    [{ ...live, complete: true }, recent],
  );
  assert.deepEqual(merged.items.map((item) => item.ref), ["codex:pinned", "claude:live", "codex:recent"]);
  assert.deepEqual(
    { pinnedCount: merged.pinnedCount, liveCount: merged.liveCount, recentCount: merged.recentCount },
    { pinnedCount: 1, liveCount: 1, recentCount: 1 },
  );
  assert.equal(merged.items[0]._pinned, true);
  assert.equal(merged.items[1]._live, true);
});

test("launcher builds resume commands per engine", async () => {
  const { resumeCommand } = await launcherRuntime();
  assert.equal(resumeCommand({ engine: "codex", id: "abc123" }), "codex resume abc123");
  assert.equal(resumeCommand({ engine: "claude", ref: "claude:ccc-111" }), "claude --resume ccc-111");
  assert.equal(resumeCommand({ engine: "trae", id: "ttt" }), "");
});

test("launcher scope filtering updates active scope and ignores invalid scopes", async () => {
  await withDom(`
    <body>
      <button class="scope active" data-scope="all"></button>
      <button class="scope" data-scope="codex"></button>
      <button class="scope" data-scope="claude"></button>
      <button class="scope" data-scope="trae"></button>
    </body>
  `, async () => {
    const { state, runCalls, setScope } = await launcherRuntime();
    setScope("claude");
    assert.equal(state.scope, "claude");
    assert.equal(runCalls(), 1);
    assert.equal(document.querySelector('[data-scope="claude"]').classList.contains("active"), true);
    assert.equal(document.querySelector('[data-scope="all"]').classList.contains("active"), false);

    setScope("claude");
    assert.equal(runCalls(), 1, "setting the same scope should not refetch");
    setScope("missing");
    assert.equal(state.scope, "claude");
    assert.equal(runCalls(), 1, "invalid scopes should be ignored");
  });
});

test("launcher quota meter classes switch at green amber red thresholds", async () => {
  const { quotaMeter } = await launcherRuntime();
  const resetsAt = "2026-07-08T16:00:00.000Z";
  const updatedAt = "2026-07-08T12:00:00.000Z";
  assert.match(quotaMeter("5h", { usedPercent: 60, resetsAt }, updatedAt), /quota-meter ok/);
  assert.match(quotaMeter("5h", { usedPercent: 60.1, resetsAt }, updatedAt), /quota-meter warn/);
  assert.match(quotaMeter("5h", { usedPercent: 85, resetsAt }, updatedAt), /quota-meter warn/);
  assert.match(quotaMeter("5h", { usedPercent: 85.1, resetsAt }, updatedAt), /quota-meter danger/);
});

// --- Viewer ----------------------------------------------------------------

test("viewer verbosity modes apply to transcript details DOM", async () => {
  await withDom(`
    <body>
      <button data-view-verbosity="standard"></button>
      <button data-view-verbosity="detailed"></button>
      <button data-view-verbosity="summary"></button>
      <div id="turns">
        <article><details class="process-details" open><summary>process</summary></details></article>
        <article><details class="tool-details" open><summary>tool</summary></details></article>
      </div>
    </body>
  `, async () => {
    const runtime = await viewerRuntime(
      ["setTranscriptDetailsOpen", "applyVerbosity"],
      `
const VIEW_VERBOSITIES = ["standard", "detailed", "summary"];
const VIEW_VERBOSITY_KEY = "agent-snapshot.view-verbosity.v1";
const VIEW_VERBOSITY_LABELS = { standard: "标准", detailed: "详细", summary: "摘要" };
const state = { reading: { verbosity: "standard" } };
let outlineRebuilds = 0;
function scheduleOutlineRebuild() { outlineRebuilds += 1; }
function showToast() {}
function outlineRebuildCalls() { return outlineRebuilds; }
`,
      ["state", "applyVerbosity", "outlineRebuildCalls"],
    );

    runtime.applyVerbosity("standard", { persist: false });
    assert.equal(document.body.getAttribute("data-view-verbosity"), "standard");
    assert.equal(document.querySelector("details.process-details").open, false);
    assert.equal(document.querySelector("details.tool-details").open, false);

    runtime.applyVerbosity("detailed", { persist: false });
    assert.equal(document.body.getAttribute("data-view-verbosity"), "detailed");
    assert.equal(document.querySelector("details.process-details").open, true);
    assert.equal(document.querySelector("details.tool-details").open, true);
    assert.equal(document.querySelector('[data-view-verbosity="detailed"]').getAttribute("aria-pressed"), "true");

    runtime.applyVerbosity("summary", { persist: false });
    assert.equal(document.body.getAttribute("data-view-verbosity"), "summary");
    assert.equal(runtime.state.reading.verbosity, "summary");
    assert.equal(document.querySelector("details.process-details").open, false);
    assert.equal(document.querySelector("details.tool-details").open, false);
    assert.equal(runtime.outlineRebuildCalls(), 3);
  });
});

test("viewer rebuilds outline from user turns with 60 character truncation", async () => {
  const longText = "0123456789".repeat(7);
  await withDom(`
    <body>
      <div id="turns">
        <article class="turn user" data-turn-number="1"><div class="body">short user request</div></article>
        <article class="turn assistant" data-turn-number="2"><div class="body">assistant response</div></article>
        <article class="turn user" data-turn-number="3"><div class="body">${longText}</div></article>
      </div>
      <div id="outlineList"></div>
    </body>
  `, async () => {
    const runtime = await viewerRuntime(
      ["outlineText", "rebuildOutline"],
      `
${escPrelude()}
const state = { reading: { outlineItems: [], outlineVisible: new Set(), outlineTargets: new Map(), outlineActiveId: "" } };
let outlineObserver = null;
const $ = (id) => document.getElementById(id);
let activeUpdates = 0;
function updateActiveOutline() { activeUpdates += 1; }
function activeUpdateCalls() { return activeUpdates; }
`,
      ["state", "outlineText", "rebuildOutline", "activeUpdateCalls"],
    );
    runtime.rebuildOutline();
    const labels = [...document.querySelectorAll("#outlineList .outline-text")].map((node) => node.textContent);
    assert.deepEqual(labels, ["short user request", longText.slice(0, 60) + "..."]);
    assert.equal(runtime.state.reading.outlineItems.length, 2);
    assert.equal(runtime.state.reading.outlineTargets.size, 2);
    assert.equal(runtime.outlineText("", "fallback"), "fallback");
    assert.equal(runtime.activeUpdateCalls(), 1);
  });
});

test("viewer live-session detection handles codex claude and trae edge cases", async () => {
  const { isLiveSessionItem } = await viewerRuntime(
    ["sessionEngineKey", "normalizedSessionPath", "isLiveSessionItem"],
    "",
    ["isLiveSessionItem"],
  );
  assert.equal(isLiveSessionItem({ engine: "codex", filePath: "/Users/me/.codex/archived_sessions/a.jsonl" }), false);
  assert.equal(isLiveSessionItem({ engine: "codex", filePath: "/Users/me/.codex/sessions/2026/07/a.jsonl" }), true);
  assert.equal(isLiveSessionItem({ engine: "claude", historyOnly: true, complete: false }), false);
  assert.equal(isLiveSessionItem({ engine: "claude", sourceKind: "summary", complete: false }), false);
  assert.equal(isLiveSessionItem({ engine: "claude", sourceKind: "transcript", complete: false }), true);
  assert.equal(isLiveSessionItem({ engine: "trae", complete: false }), false);
});

test("viewer quota color clamps from green through amber to red", async () => {
  const { quotaColor } = await viewerRuntime(["quotaColor"], "", ["quotaColor"]);
  assert.equal(quotaColor(-5), "hsl(138 55% 38%)");
  assert.equal(quotaColor(0), "hsl(138 55% 38%)");
  assert.equal(quotaColor(70), "hsl(48 55% 38%)");
  assert.equal(quotaColor(100), "hsl(8 55% 38%)");
  assert.equal(quotaColor(999), "hsl(8 55% 38%)");
});

// --- Runner ----------------------------------------------------------------

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.stack || error.message : error}`);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) {
  process.exit(1);
}
