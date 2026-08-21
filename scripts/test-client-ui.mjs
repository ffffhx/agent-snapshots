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
let launcherHtmlCache = "";
let viewerScriptCache = "";

async function launcherHtml() {
  if (!launcherHtmlCache) {
    const { renderLauncherApp } = await import(path.join(ROOT_DIR, "dist/server/launcher-app.mjs"));
    launcherHtmlCache = renderLauncherApp("test-csrf");
  }
  return launcherHtmlCache;
}

async function launcherScript() {
  if (!launcherScriptCache) {
    launcherScriptCache = largestInlineScript(await launcherHtml());
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
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in rendered client script`);
  const asyncPrefix = "async ";
  if (start >= asyncPrefix.length && source.slice(start - asyncPrefix.length, start) === asyncPrefix) {
    start -= asyncPrefix.length;
  }
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
      "isTypingTarget",
      "shouldOpenPreviewFromSearchInput",
      "peekTurnText",
      "resumeCommand",
      "setScope",
    ],
    `
${escPrelude()}
const SCOPES = ["all", "codex", "claude"];
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
      "isTypingTarget",
      "shouldOpenPreviewFromSearchInput",
      "peekTurnText",
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
  assert.equal(merged.items[0]._live, true, "a pinned running session should retain its live state");
  assert.equal(merged.items[1]._live, true);
});

test("launcher live indicators stay static while idle", async () => {
  const html = await launcherHtml();
  assert.ok(html.includes(".live-dot{"), "launcher should render live indicator styles");
  assert.ok(!html.includes("@keyframes livepulse"), "launcher should not continuously animate live indicators");
  assert.ok(!/\.live-dot\{[^}]*animation:(?!none)/u.test(html), "launcher live indicators should not schedule idle repaints");
});

test("launcher builds resume commands per engine", async () => {
  const { resumeCommand } = await launcherRuntime();
  assert.equal(
    resumeCommand({ engine: "codex", id: "abc123" }),
    "codex resume --dangerously-bypass-approvals-and-sandbox abc123",
  );
  assert.equal(resumeCommand({ engine: "claude", ref: "claude:ccc-111" }), "claude --resume ccc-111");
});

test("launcher scope filtering updates active scope and ignores invalid scopes", async () => {
  await withDom(`
    <body>
      <button class="scope active" data-scope="all"></button>
      <button class="scope" data-scope="codex"></button>
      <button class="scope" data-scope="claude"></button>
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

test("launcher preview shortcut respects the caret and preserves complete text", async () => {
  await withDom(`<body><input id="q" value="abcdef"><button id="button"></button></body>`, async () => {
    const { isTypingTarget, shouldOpenPreviewFromSearchInput, peekTurnText } = await launcherRuntime();
    const input = document.getElementById("q");
    input.setSelectionRange(2, 2);
    assert.equal(shouldOpenPreviewFromSearchInput(input), false, "middle-caret ArrowRight should move the caret");
    input.setSelectionRange(6, 6);
    assert.equal(shouldOpenPreviewFromSearchInput(input), true, "end-caret ArrowRight should open preview");
    input.setSelectionRange(1, 4);
    assert.equal(shouldOpenPreviewFromSearchInput(input), false, "range selection should not open preview");
    assert.equal(isTypingTarget(input), true, "document shortcut should ignore focused input events");
    assert.equal(isTypingTarget(document.getElementById("button")), false, "document shortcut can run outside typing controls");

    const longEmoji = "\u{1F600}".repeat(405);
    assert.equal(peekTurnText(longEmoji), longEmoji, "client preview should preserve messages longer than 400 characters");
    assert.equal(peekTurnText(longEmoji).includes("\uFFFD"), false, "client preview should not introduce replacement characters");
  });
});

// --- Viewer ----------------------------------------------------------------

test("viewer search history dedupes most recent query and caps entries", async () => {
  const { normalizeSearchHistory } = await viewerRuntime(
    ["normalizeSearchHistory"],
    "",
    ["normalizeSearchHistory"],
  );
  const older = Array.from({ length: 24 }, (_, index) => `query-${index}`);
  const normalized = normalizeSearchHistory(older, "query-3", 20);
  assert.equal(normalized.length, 20);
  assert.equal(normalized[0], "query-3");
  assert.equal(normalized.filter((item) => item === "query-3").length, 1);
  assert.equal(normalized.includes("query-19"), true);
  assert.equal(normalized.includes("query-20"), false);
  assert.equal(normalized.includes("query-23"), false, "oldest entries should fall off the cap");
});

test("viewer saved searches add dedupe and remove snapshots", async () => {
  const runtime = await viewerRuntime(
    [
      "savedSearchSnapshot",
      "savedSearchIdentity",
      "normalizeSavedSearchItem",
      "sanitizeSavedSearches",
      "savedSearchItemFromSnapshot",
      "addSavedSearch",
      "removeSavedSearch",
    ],
    "",
    ["savedSearchSnapshot", "addSavedSearch", "removeSavedSearch"],
  );
  const snapshot = runtime.savedSearchSnapshot("deploy source:codex", {
    mode: "semantic",
    flags: { caseSensitive: true, wholeWord: false },
  });
  const first = runtime.addSavedSearch([], snapshot, 12, 1000);
  assert.equal(first.length, 1);
  assert.equal(first[0].name, "deploy source:codex");
  assert.equal(first[0].mode, "semantic");
  assert.equal(first[0].flags.caseSensitive, true);

  const second = runtime.addSavedSearch(
    [{ id: "other", name: "other", query: "other", mode: "keyword", flags: {}, createdAt: 1, updatedAt: 1 }, ...first],
    snapshot,
    12,
    2000,
  );
  assert.equal(second.length, 2);
  assert.equal(second[0].id, first[0].id, "duplicate snapshots should move to the front instead of cloning");
  assert.equal(second[0].updatedAt, 2000);

  const removed = runtime.removeSavedSearch(second, second[0].id, 12);
  assert.deepEqual(removed.map((item) => item.id), ["other"]);
});

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
let toastCount = 0;
function scheduleOutlineRebuild() { outlineRebuilds += 1; }
function showToast() { toastCount += 1; }
function outlineRebuildCalls() { return outlineRebuilds; }
function toastCalls() { return toastCount; }
`,
      ["state", "applyVerbosity", "outlineRebuildCalls", "toastCalls"],
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
    assert.equal(runtime.toastCalls(), 0, "silent mode application should not toast");

    runtime.applyVerbosity("standard", { persist: false, toast: true });
    assert.equal(runtime.toastCalls(), 0, "non-user mode application should remain silent even with toast option");
    runtime.applyVerbosity("detailed", { persist: false, toast: true, userInitiated: true });
    assert.equal(runtime.toastCalls(), 1, "explicit user mode changes should toast");
  });
});

test("viewer gallery cards reserve image aspect ratios with fallback", async () => {
  const runtime = await viewerRuntime(
    ["galleryImageAspectRatio", "galleryEngineLabel", "galleryProjectLabel", "renderGalleryCard"],
    `
${escPrelude()}
function relativeTime() { return "刚刚"; }
`,
    ["galleryImageAspectRatio", "renderGalleryCard"],
  );
  assert.equal(runtime.galleryImageAspectRatio({ width: 16, height: 9 }), "16 / 9");
  assert.equal(runtime.galleryImageAspectRatio({}), "4 / 3");
  assert.match(
    runtime.renderGalleryCard({ id: "img-1", width: 16, height: 9, mime: "image/png", sessionTitle: "A" }, 0),
    /style='aspect-ratio:16 \/ 9'/,
  );
  assert.match(
    runtime.renderGalleryCard({ id: "img-2", mime: "image/webp", sessionTitle: "B" }, 1),
    /style='aspect-ratio:4 \/ 3'/,
  );
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

test("viewer transcript match mode skips summary-hidden process turns", async () => {
  await withDom(`
    <body data-view-verbosity="summary">
      <div id="matchNav" hidden><span id="matchNavCount"></span></div>
      <div id="turns">
        <article class="turn process">
          <details class="process-details">
            <div class="process-body">
              <section class="process-entry process-assistant" data-turn-number="2"><div class="body">hidden needle</div></section>
            </div>
          </details>
        </article>
        <article class="turn assistant" data-turn-number="3"><div class="message-card"><div class="body">visible Needle text</div></div></article>
      </div>
    </body>
  `, async (dom) => {
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
      this.setAttribute("data-scrolled", "1");
    };
    const runtime = await viewerRuntime(
      [
        "escapeRegExp",
        "tokenizeMatchTerms",
        "transcriptMatchBody",
        "isSummaryHiddenTranscriptNode",
        "isTranscriptMatchCandidate",
        "transcriptMatchCandidates",
        "transcriptNodeMatchTerm",
        "clearTranscriptMatchMarks",
        "markTranscriptTerms",
        "markTranscriptMatches",
        "updateTranscriptMatchIndicator",
        "dismissTranscriptMatchMode",
        "refreshTranscriptMatches",
        "flashTranscriptMatch",
        "scrollTranscriptMatchIndex",
        "startTranscriptMatchMode",
      ],
      `
${escPrelude()}
const state = { selected: "codex:a", transcriptMatch: { active: false, query: "", terms: [], matches: [], index: -1, timer: 0 } };
const $ = (id) => document.getElementById(id);
function flushTranscriptHydration() {}
function preferredScrollBehavior() { return "auto"; }
function showToast() {}
`,
      ["state", "startTranscriptMatchMode", "refreshTranscriptMatches"],
    );

    assert.equal(runtime.startTranscriptMatchMode(["needle"], { autoScroll: true }), true);
    assert.equal(runtime.state.transcriptMatch.matches.length, 1);
    assert.equal(document.querySelector(".assistant").getAttribute("data-scrolled"), "1");
    assert.equal(document.querySelectorAll(".transcript-match-mark").length, 1);
    assert.equal(document.getElementById("matchNavCount").textContent, "1/1 匹配");

    document.body.setAttribute("data-view-verbosity", "standard");
    assert.equal(runtime.refreshTranscriptMatches({ keepCurrent: true }), true);
    assert.equal(runtime.state.transcriptMatch.matches.length, 2);
    assert.equal(document.querySelectorAll(".transcript-match-mark").length, 2);
  });
});

test("viewer insight skill drafts escape markdown control text from history", async () => {
  const runtime = await viewerRuntime(
    ["tokenUsageNumber", "formatTokenCount", "promptPatternSkillDraft", "draftTitle", "uniqueDraftLines", "draftInline", "escapeDraftMarkdown"],
    "",
    ["promptPatternSkillDraft", "draftInline"],
  );
  const malicious = "`rm -rf` [link](javascript:alert(1)) <script>alert(1)</script> # heading";
  const markdown = runtime.promptPatternSkillDraft({
    id: "malicious",
    prefix: malicious,
    triggerPhrases: [malicious],
    examples: [malicious],
    count: 3,
  });
  assert.ok(!markdown.includes("`rm -rf`"), markdown);
  assert.ok(!markdown.includes("[link](javascript:alert(1))"), markdown);
  assert.ok(!markdown.includes("<script>"), markdown);
  assert.ok(markdown.includes("\\`rm"), markdown);
  assert.ok(runtime.draftInline("a\n# b").includes("\\# b"), "draftInline should escape headings after whitespace normalization");
});

test("viewer live-session detection handles codex and claude edge cases", async () => {
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
});

test("viewer selectSession renders failed snapshot loads without throwing", async () => {
  await withDom(`
    <body>
      <h2 id="title"></h2>
      <div id="meta"></div>
      <div id="turns"></div>
    </body>
  `, async () => {
    const { state, selectSession } = await viewerRuntime(
      ["selectSession"],
      `
${escPrelude()}
const state = { requestToken: 0, selected: "", currentSnapshot: null };
const $ = (id) => document.getElementById(id);
function renderSessions() {}
function showViewerLoading() { $("turns").setAttribute("aria-busy", "true"); }
function activeOptions() { return new URLSearchParams({ id: state.selected }); }
function renderSnapshot() { throw new Error("renderSnapshot should not run on failed fetch"); }
const fetch = async () => { throw new Error("network down"); };
`,
      ["state", "selectSession"],
    );

    await assert.doesNotReject(() => selectSession("codex:oops"));
    assert.equal(state.selected, "codex:oops");
    assert.equal(document.getElementById("title").textContent, "会话加载失败");
    assert.equal(document.getElementById("turns").hasAttribute("aria-busy"), false);
    assert.match(document.getElementById("turns").innerHTML, /network down/);
  });
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
