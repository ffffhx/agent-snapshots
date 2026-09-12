import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { buildRagDocument, fuseRagRanks, selectRagEvidenceHits, packRagEvidence, validateRagAnswer, ragTerms, ragEvidenceBudget } from "../dist/server/rag-core.mjs";
import { RagIndex } from "../dist/server/rag-index.mjs";
import { createRagService } from "../dist/server/rag-service.mjs";
import { fixtureDeps, sessions, snapshots } from "./fixtures/rag-corpus.mjs";
import { ragJs } from "../dist/server/viewer-ui/js/rag.mjs";

const fakeEmbed = async (texts) => texts.map((t) => [t.includes("Electron") ? 1 : 0.1, 0.3, 0.4]);
const withIndex = async (fn) => { const index = new RagIndex(":memory:"); try { await index.sync(fixtureDeps); await fn(index); } finally { index.close(); } };

test("long sessions retain final fixes beyond 140 chunks and isolate subagents", () => {
  const turns = Array.from({ length: 160 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", turn: i + 1, text: `讨论 ${i}` }));
  turns.push({ role: "assistant", turn: 161, text: "FINAL_FIXED" });
  const doc = buildRagDocument({ turns, subagents: [{ label: "same", turns: [{ role: "user", text: "one", turn: 1 }] }, { label: "same", turns: [{ role: "user", text: "two", turn: 1 }] }] }, "test");
  assert(doc.chunks.some((c) => c.text.includes("FINAL_FIXED")));
  assert.equal(new Set(doc.chunks.map((c) => c.id)).size, doc.chunks.length);
});

test("redacts secrets and excludes privileged historical instructions", () => {
  const doc = buildRagDocument({ turns: [{ role: "system", text: "SYSTEM_PRIVATE" }, { role: "developer", text: "DEV_PRIVATE" }, { role: "user", text: "token sk-abcdefghijklmnopqrstuvwxyz1234567890" }] }, "privacy");
  const text = JSON.stringify(doc);
  assert(!text.includes("SYSTEM_PRIVATE")); assert(!text.includes("DEV_PRIVATE")); assert(!text.includes("sk-abcdefghijklmnopqrstuvwxyz1234567890"));
});

test("Chinese intent and code identifiers tokenize without SQL query injection", async () => withIndex(async (index) => {
  assert(ragTerms("怎么处理 ENOSPC 文件监听失败").includes("enospc"));
  assert.equal(index.keyword("ENOSPC")[0].session.ref, "claude:rag-fixture-watch");
  assert.deepEqual(index.keyword('" OR 1=1 -- nonexistentmarker'), []);
  assert(index.keyword("CSRF").length);
  assert.deepEqual(index.keyword("CSRF", { cwd: "/fixtures/port" }), []);
  assert.deepEqual(index.keyword("CSRF", { source: "codex" }), []);
  assert.deepEqual(index.keyword("我的银行卡余额"), [], "isolated 卡 must not match 卡顿 in an unrelated query");
}));

test("RRF ignores score scales and duplicate hits within a single rank list", () => {
  const a = { id: "a", score: 9999 }, b = { id: "b", score: 0.01 };
  const hits = fuseRagRanks([[a, b, b], [b, a]]);
  assert(Math.abs(hits.find((h) => h.id === "b").score - (1 / 61 + 1 / 62)) < 1e-10);
});

test("parent expansion includes failed attempt and later fix; dedup and budget enforced", async () => withIndex(async (index) => {
  const hits = index.keyword("硬件加速");
  const evidence = packRagEvidence(hits, (hit) => index.parents(hit));
  assert(evidence[0].text.includes("白屏仍然存在"));
  assert(evidence[0].text.includes("修正 preload 路径"));
  assert(evidence[0].text.includes("启动集成测试通过"));
  const childOnly = packRagEvidence(hits, (hit) => index.parents(hit), { expand: false });
  assert(!childOnly[0].text.includes("修正 preload 路径"));
  assert(packRagEvidence(hits, (hit) => index.parents(hit), { budget: 900 }).reduce((n, e) => n + e.text.length, 0) <= 900);
}));

test("citation validation rejects invented and missing sources, handles abstention", () => {
  const evidence = [{ id: 1 }];
  assert.throws(() => validateRagAnswer('{"insufficient":false,"claims":[{"text":"fixed","citations":[99]}]}', evidence));
  assert.throws(() => validateRagAnswer('{"insufficient":false,"claims":[{"text":"fixed","citations":[]}]}', evidence));
  assert.equal(validateRagAnswer('{"insufficient":true,"reason":"没有证据","claims":[]}', evidence).insufficient, true);
  assert.equal(validateRagAnswer('{"insufficient":false,"claims":[{"text":"fixed","citations":[1]}]}', evidence).claims.length, 1);
  assert.equal(validateRagAnswer('{"insufficient":false,"claims":[]}', evidence).abstentionSource, "empty-claims-guard");
  assert.throws(() => validateRagAnswer("null", evidence));
});

test("RRF agreement alone does not admit weak unrelated semantic evidence", () => {
  const hit = { id: "low", session: sessions[0], score: 0.31 };
  assert.equal(selectRagEvidenceHits(fuseRagRanks([[hit]]), [], [hit]).length, 0);
  assert.equal(selectRagEvidenceHits(fuseRagRanks([[hit]]), [{ ...hit, score: 2 }], []).length, 1);
});

test("serialized Chinese evidence stays within byte budget with truncation disclosed", async () => withIndex(async (index) => {
  const budget = ragEvidenceBudget("如何修复白屏？");
  const evidence = packRagEvidence(index.keyword("Electron"), (hit) => index.parents(hit), { budget });
  assert(Buffer.byteLength(JSON.stringify(evidence)) <= budget + 2);
}));

test("file size changes invalidate RAG even when visible message and file timestamps stay equal", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rag-file-fingerprint-"));
  const filePath = path.join(dir, "log.jsonl");
  const index = new RagIndex(":memory:"); let text = "OLD_CONTENT";
  const deps = { listSessions: async () => [{ ...sessions[0], filePath }], loadSnapshot: async () => ({ turns: [{ role: "assistant", text }] }) };
  try {
    await writeFile(filePath, "old"); const before = await stat(filePath);
    await index.sync(deps);
    text = "NEW_CONTENT"; await writeFile(filePath, "longer updated content"); await utimes(filePath, before.atime, before.mtime);
    const result = await index.sync(deps);
    assert.equal(result.updated, 1); assert.equal(index.keyword("OLD_CONTENT").length, 0); assert(index.keyword("NEW_CONTENT").length);
  } finally { index.close(); assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(dir, { recursive: true, force: true }); }
});

test("restart reuses index and embeddings, updates invalidate old text, deletion removes vectors", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rag-index-test-"));
  const file = path.join(dir, "test.db");
  let index = new RagIndex(file);
  let current = [sessions[0]]; let snapshot = snapshots.get(sessions[0].ref); let loads = 0, embeddings = 0;
  const deps = { listSessions: async () => current, loadSnapshot: async () => { loads++; return snapshot; } };
  const embed = async (texts) => { embeddings += texts.length; return fakeEmbed(texts); };
  try {
    await index.sync(deps); await index.embedPending({}, "model-a", embed);
    const initial = embeddings; index.close(); index = new RagIndex(file);
    await index.sync(deps); await index.embedPending({}, "model-a", embed);
    assert.equal(loads, 1); assert.equal(embeddings, initial);
    assert(index.vectorStatus({}, "model-b").pending > 0);
    current = [{ ...current[0], mtime: "2026-08-22" }];
    snapshot = { turns: [{ role: "assistant", text: "NEWFIX" }] };
    await index.sync(deps);
    assert.equal(index.keyword("preload").length, 0);
    assert(index.keyword("NEWFIX").length);
    assert.equal(index.vectorStatus({}, "model-a").ready, 0);
    current = []; await index.sync(deps); assert.equal(index.keyword("NEWFIX").length, 0);
  } finally { index.close(); assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(dir, { recursive: true, force: true }); }
});

test("stale sessions are excluded until successfully reloaded and enumeration failure preserves index", async () => withIndex(async (index) => {
  const deps = { listSessions: async () => sessions.map((s) => ({ ...s, mtime: "changed" })), loadSnapshot: async () => { throw new Error("unreadable"); } };
  const result = await index.sync(deps);
  assert.equal(result.failed, 10); assert.equal(index.keyword("ENOSPC").length, 0);
  await index.sync(fixtureDeps);
  await assert.rejects(index.sync({ ...fixtureDeps, listSessions: async () => { throw new Error("enumeration failed"); } }));
  assert(index.keyword("ENOSPC").length);
}));

test("vector cardinality/dimension errors are explicit and canceled work stops", async () => withIndex(async (index) => {
  await assert.rejects(index.embedPending({}, "bad", async () => [[NaN]]));
  await index.embedPending({}, "good", fakeEmbed);
  assert.throws(() => index.vector([1, 0], {}, "good"), /维度/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(index.sync(fixtureDeps, controller.signal));
}));

test("service emits evidence before answer, degrades embeddings and releases busy state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rag-service-test-"));
  let generated = 0;
  const service = createRagService(fixtureDeps, { indexPath: path.join(dir, "index.db"), embed: async () => { throw new Error("offline"); }, generate: async (_q, evidence) => { generated++; return { ...validateRagAnswer(JSON.stringify({ insufficient: false, claims: [{ text: "修正 preload 路径", citations: [evidence[0].id] }] }), evidence), model: "test", inputTokens: 1, outputTokens: 1 }; } });
  try {
    const events = []; await service.run({ query: "Electron 白屏" }, (event) => events.push(event));
    assert(events.findIndex((e) => e.type === "evidence") < events.findIndex((e) => e.type === "answer"));
    assert(events.at(-1).warnings.some((w) => w.includes("降级"))); assert(!service.isBusy());
    const result = await service.run({ query: "xyzzynotincorpus", mode: "keyword" }, () => {});
    assert(result.insufficient); assert.equal(generated, 1);
  } finally { assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(dir, { recursive: true, force: true }); }
});

test("RAG UI renders hostile model and source text as text, not HTML", () => {
  const ids = ["ragPanel", "searchFacets", "searchResults", "searchCount", "searchScopeLabel", "globalSearch", "ragAsk", "ragBuild", "ragCancel", "ragScope", "ragProgress", "ragWarnings", "ragAnswer", "ragSources", "ragMetrics", "ragModels"];
  const dom = new JSDOM(ids.map((id) => `<${id === "globalSearch" ? "input" : "div"} id="${id}"></${id === "globalSearch" ? "input" : "div"}>`).join(""), { runScripts: "outside-only" });
  dom.window.eval(`const state={search:{mode:'rag'}}; const $=(id)=>document.getElementById(id); const csrfToken='test'; ${ragJs}
    ragResult={claims:[{text:'<img src=x onerror=alert(1)>',citations:[1]}]};
    ragEvidence=[{id:1,title:'<script>bad</script>',source:'Session',turn:1,text:'<img src=x>',ref:'test'}]; renderRag();`);
  assert.equal(dom.window.document.querySelectorAll("img,script").length, 0);
  assert(dom.window.document.getElementById("ragAnswer").textContent.includes("<img"));
  dom.window.close();
});
