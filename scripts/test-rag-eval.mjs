import { test } from "node:test";
import assert from "node:assert/strict";
import { digest, validateDataset, retrievalMetrics, quoteCoverage, retrievalSummary, scoreReviews } from "./lib/rag-eval.mjs";
const hit = (ref) => ({ session: { ref } });
function dataset() { return { version: 2, provenance: { kind: "synthetic-unit-test", annotationType: "test" },
  sessions: [{ ref: "a", group: "one", split: "dev" }, { ref: "b", group: "two", split: "test" }],
  snapshots: { a: { turns: [{ turn: 1, role: "assistant", text: "verified evidence" }] }, b: { turns: [{ turn: 2, role: "assistant", text: "other evidence" }] } },
  questions: [{ id: "q", query: "question", group: "one", split: "dev", answerable: true, tags: ["exact"], keyPoints: ["verified"], gold: [{ ref: "a", turn: 1, quote: "verified" }] }] }; }
test("retrieval metrics distinguish Hit from multi-source Recall, deduplicate sessions and use fixed K", () => {
  const m = retrievalMetrics([hit("x"), hit("a"), hit("a")], [{ ref: "a" }, { ref: "b" }]);
  assert.equal(m.hitAtK, 1); assert.equal(m.recallAtK, .5); assert.equal(m.precisionAtK, .2); assert.equal(m.reciprocalRank, .5);
  assert(m.ndcgAtK > 0 && m.ndcgAtK < 1);
  assert.equal(retrievalMetrics([], []).hitAtK, null);
  assert.equal(retrievalMetrics([], [{ ref: "a" }]).recallAtK, 0);
});
test("dataset requires real quote anchors and blocks project leakage or false no-answer labels", () => {
  validateDataset(dataset());
  const badQuote = dataset(); badQuote.questions[0].gold[0].quote = "fabricated";
  assert.throws(() => validateDataset(badQuote), /gold quote/);
  const leaked = dataset(); leaked.sessions[1].group = "one";
  assert.throws(() => validateDataset(leaked), /leakage/);
  const badGold = dataset(); badGold.questions[0].gold[0] = { ref: "b", turn: 2, quote: "other" };
  assert.throws(() => validateDataset(badGold), /leakage/);
  const unknown = dataset(); unknown.questions[0].answerable = false;
  assert.throws(() => validateDataset(unknown), /unanswerable/);
});
test("quote proxy checks source identity and empty aggregates are null", () => {
  assert.equal(quoteCoverage([{ref:"wrong",text:"gold"}], [{ref:"a",quote:"gold"}]), 0);
  assert.equal(quoteCoverage([{ref:"a",text:"gold"}], [{ref:"a",quote:"gold"}]), 1);
  assert.equal(retrievalSummary([]).hybrid.recallAtK, null);
});
test("reviews bind exact answer hashes and cannot silently mark unreviewed answers successful", () => {
  const answer = { claims: [{ text: "claim", citations: [1] }] };
  const run = { results: [{ id: "q:0", config: { chatModel: "test" }, answer, split: "test" }] };
  const reviews = { runHash: digest(run), reviewerType: "agent", reviewer: "fixture", items: [{ id: "q:0", answerHash: digest(answer), status: "pending" }] };
  assert.equal(scoreReviews(run, reviews).summary.test.reviewed, 0);
  assert.equal(scoreReviews(run, reviews).summary.test.correctness, null);
  reviews.items[0] = { ...reviews.items[0], status: "reviewed", correctness: 1, completeness: 0, relevance: 2, temporalAccuracy: 1, notes: "Partial claim", claims: [{ index: 0, support: 1, citationSupport: 0, reason: "Citation does not support it" }] };
  assert.equal(scoreReviews(run, reviews).summary.test.citationSupport, 0);
  run.results[0].answer.claims[0].text = "changed";
  assert.throws(() => scoreReviews(run, reviews), /different run/);
});
