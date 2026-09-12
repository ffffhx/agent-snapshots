import { createHash } from "node:crypto";
import assert from "node:assert/strict";

export const digest = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export const percentile = (xs, p) => xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * p) - 1)] : null;
export function validateDataset(data) {
  assert.equal(data.version, 2);
  assert(data.provenance?.kind && data.provenance?.annotationType, "provenance required");
  const sessions = new Map(data.sessions.map((s) => [s.ref, s]));
  assert.equal(sessions.size, data.sessions.length, "duplicate sessions");
  const groupSplits = new Map(), queries = new Set(), ids = new Set();
  for (const s of sessions.values()) {
    assert(s.group && ["dev", "test"].includes(s.split));
    assert(!groupSplits.has(s.group) || groupSplits.get(s.group) === s.split, "group leakage across splits");
    groupSplits.set(s.group, s.split);
    assert(data.snapshots[s.ref]?.turns?.length, "missing source snapshot");
  }
  for (const q of data.questions) {
    assert(q.id && !ids.has(q.id), "duplicate question id"); ids.add(q.id);
    const query = q.query?.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    assert(query && !queries.has(query), "duplicate question"); queries.add(query);
    assert(groupSplits.get(q.group) === q.split, "question split differs from group");
    assert(Array.isArray(q.tags) && q.tags.length && typeof q.answerable === "boolean");
    assert(Array.isArray(q.gold) && Array.isArray(q.keyPoints));
    if (q.answerable) {
      assert(q.gold.length && q.keyPoints.length, "answerable questions require gold evidence and key points");
      for (const g of q.gold) {
        assert(sessions.get(g.ref)?.split === q.split, "gold source split leakage");
        const turn = data.snapshots[g.ref]?.turns.find((t) => t.turn === g.turn && (!g.role || t.role === g.role));
        assert(g.quote && turn?.text.includes(g.quote), `gold quote not present: ${q.id}`);
      }
    } else assert(!q.gold.length && q.absenceReason, "unanswerable label requires a corpus-scoped reason");
  }
  return data;
}

export function retrievalMetrics(hits, gold, k = 5) {
  const refs = [...new Set(hits.map((h) => h.session.ref))].slice(0, k);
  const relevant = new Set(gold.map((g) => g.ref));
  if (!relevant.size) return { refs, hitAtK: null, recallAtK: null, precisionAtK: null, reciprocalRank: null, ndcgAtK: null };
  const flags = refs.map((ref) => Number(relevant.has(ref)));
  const found = flags.reduce((a, b) => a + b, 0);
  const rank = flags.indexOf(1);
  const dcg = flags.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  const ideal = Array.from({ length: Math.min(k, relevant.size) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  return { refs, hitAtK: Number(found > 0), recallAtK: found / relevant.size, precisionAtK: found / k, reciprocalRank: rank < 0 ? 0 : 1 / (rank + 1), ndcgAtK: dcg / ideal };
}

export function quoteCoverage(evidence, gold) {
  return gold.length ? gold.filter((g) => evidence.some((e) => e.ref === g.ref && e.text.includes(g.quote))).length / gold.length : null;
}
export function wilson(successes, n) {
  if (!n) return null;
  const z = 1.96, p = successes / n, denominator = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}
export function retrievalSummary(rows) {
  const out = {};
  for (const mode of ["keyword", "vector", "hybrid"]) {
    const valid = rows.filter((r) => r.answerable && !r.variants[mode].error).map((r) => r.variants[mode]);
    out[mode] = { questions: rows.length, answerable: rows.filter((r) => r.answerable).length, scored: valid.length,
      errors: rows.filter((r) => r.variants[mode].error).length,
      ...Object.fromEntries(["hitAtK", "recallAtK", "precisionAtK", "reciprocalRank", "ndcgAtK", "quoteCoverageProxy"].map((key) => [key, mean(valid.map((r) => r[key]))])),
      hitWilson95: wilson(valid.reduce((s, r) => s + r.hitAtK, 0), valid.length),
      p50Ms: percentile(rows.map((r) => r.variants[mode].latencyMs).filter(Number.isFinite), .5),
      p95Ms: percentile(rows.map((r) => r.variants[mode].latencyMs).filter(Number.isFinite), .95) };
  }
  return out;
}

// Missing reviews never become passes; references bind annotations to exact outputs.
export function scoreReviews(run, reviews) {
  assert.equal(reviews.runHash, digest(run), "reviews belong to a different run");
  assert(["human", "agent", "llm"].includes(reviews.reviewerType));
  const items = new Map(run.results.map((r) => [r.id, r]));
  const seen = new Set(), scores = [];
  for (const review of reviews.items) {
    assert(!seen.has(review.id), "duplicate review"); seen.add(review.id);
    const item = items.get(review.id); assert(item, "unknown reviewed item");
    assert.equal(review.answerHash, digest(item.answer), "answer changed after review");
    if (review.status !== "reviewed") continue;
    assert(!item.error, "failed generation cannot be scored as an answer");
    assert(review.notes?.trim(), "review rationale required");
    for (const key of ["correctness", "completeness", "relevance", "temporalAccuracy"]) assert([0, 1, 2].includes(review[key]), `invalid ${key}`);
    assert.equal(review.claims.length, item.answer.claims.length, "every claim must be reviewed");
    const claimIds = new Set();
    for (const claim of review.claims) {
      assert(Number.isInteger(claim.index) && claim.index >= 0 && claim.index < review.claims.length && !claimIds.has(claim.index)); claimIds.add(claim.index);
      assert([0, 1, 2].includes(claim.support) && [0, 1, 2].includes(claim.citationSupport));
      assert(claim.reason?.trim());
    }
    scores.push({ id: item.id, model: item.config.chatModel, split: item.split, answerable: item.answerable, ...Object.fromEntries(["correctness", "completeness", "relevance", "temporalAccuracy"].map((key) => [key, review[key] / 2])),
      faithfulness: mean(review.claims.map((c) => c.support / 2)), citationSupport: mean(review.claims.map((c) => c.citationSupport / 2)) });
  }
  const summary = {};
  for (const model of new Set(run.results.map((r) => r.config.chatModel))) {
    const modelRows = run.results.filter((r) => r.config.chatModel === model);
    const reviewed = scores.filter((s) => s.model === model);
    const aggregate = (rs) => ({ reviewed: rs.length, ...Object.fromEntries(["correctness", "completeness", "relevance", "temporalAccuracy", "faithfulness", "citationSupport"].map((key) => [key, mean(rs.map((r) => r[key]).filter((v) => v !== null))])) });
    summary[model] = { total: modelRows.length, errors: modelRows.filter((r) => r.error).length, ...aggregate(reviewed),
      bySplit: Object.fromEntries(["dev", "test"].map((split) => [split, aggregate(reviewed.filter((r) => r.split === split))])),
      byAnswerability: { answerable: aggregate(reviewed.filter((r) => r.answerable)), unanswerable: aggregate(reviewed.filter((r) => r.answerable === false)) } };
  }
  return { reviewerType: reviews.reviewerType, reviewer: reviews.reviewer, summary, scores };
}
