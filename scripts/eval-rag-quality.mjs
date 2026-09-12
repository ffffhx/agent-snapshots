import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RagIndex } from "../dist/server/rag-index.mjs";
import { fuseRagRanks, selectRagEvidenceHits, packRagEvidence, ragEvidenceBudget, RAG_SYSTEM_PROMPT } from "../dist/server/rag-core.mjs";
import { ragConfig, ollamaEmbedder, generateRagAnswer } from "../dist/server/rag-service.mjs";
import { digest, validateDataset, retrievalMetrics, quoteCoverage, retrievalSummary, percentile } from "./lib/rag-eval.mjs";

const arg = (name, fallback = "") => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const datasetPath = arg("--dataset");
if (!datasetPath) throw new Error("--dataset is required; real data defaults to private output directories");
const dataset = validateDataset(JSON.parse(await readFile(datasetPath, "utf8")));
const datasetHash = digest(dataset), promptHash = digest(RAG_SYSTEM_PROMPT);
const output = path.resolve(arg("--output", ".agent-snapshots/rag-eval/quality"));
await mkdir(output, { recursive: true });
for (const name of ["retrieval.json", "generation.json"]) {
  let exists = false;
  try { await readFile(path.join(output, name)); exists = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (exists) throw new Error(`Output already contains ${name}; choose a new output directory to preserve the frozen run`);
}
const split = arg("--split", "all");
if (!["all", "dev", "test"].includes(split)) throw new Error("Invalid split");
const config = ragConfig();
const code = {};
for (const name of ["rag-core", "rag-index", "rag-service"]) code[name] = digest(await readFile(new URL(`../dist/server/${name}.mjs`, import.meta.url), "utf8"));
let frozen;
if (arg("--replay")) {
  frozen = JSON.parse(await readFile(arg("--replay"), "utf8"));
  if (frozen.datasetHash !== datasetHash || frozen.promptHash !== promptHash) throw new Error("Replay dataset/prompt mismatch");
  if (frozen.split !== split) throw new Error("Replay split mismatch");
} else {
  const index = new RagIndex(path.join(output, `${datasetHash.slice(0, 16)}-index.db`));
  const embed = ollamaEmbedder(config), key = `${config.baseUrl}\0${config.embeddingModel}`;
  const begin = performance.now();
  const rows = [];
  try {
    const deps = { listSessions: async () => dataset.sessions, loadSnapshot: async (ref) => dataset.snapshots[ref] };
    let sync;
    do { sync = await index.sync(deps); if (sync.failed) throw new Error("Dataset sync failed"); } while (sync.pending);
    while (index.vectorStatus({}, key).pending) {
      await index.embedPending({}, key, embed, undefined, 32);
      console.log(JSON.stringify({ stage: "embedding", pending: index.vectorStatus({}, key).pending }));
    }
    const buildMs = performance.now() - begin;
    for (const q of dataset.questions.filter((q) => split === "all" || q.split === split)) {
      const scope = q.cwd ? { cwd: q.cwd } : {};
      const beginKeyword = performance.now(), keyword = index.keyword(q.query, scope), keywordMs = performance.now() - beginKeyword;
      const beginVector = performance.now();
      const [embedding] = await embed([q.query]);
      const vector = index.vector(embedding, scope, key).filter((h) => h.score >= .3);
      const vectorMs = performance.now() - beginVector;
      const row = { id: q.id, query: q.query, split: q.split, group: q.group, tags: q.tags, answerable: q.answerable, variants: {} };
      for (const [name, hits, elapsed] of [["keyword", keyword, keywordMs], ["vector", vector, vectorMs], ["hybrid", fuseRagRanks([keyword, vector]), keywordMs + vectorMs]]) {
        const packedAt = performance.now();
        const selected = name === "hybrid" ? selectRagEvidenceHits(hits, keyword, vector) : hits;
        const evidence = packRagEvidence(selected, (h) => index.parents(h), { budget: ragEvidenceBudget(q.query) });
        row.variants[name] = { ...retrievalMetrics(hits, q.gold), quoteCoverageProxy: quoteCoverage(evidence, q.gold),
          evidence, evidenceHash: digest(evidence), candidateCount: hits.length, gateAbstained: !evidence.length, latencyMs: elapsed + performance.now() - packedAt };
      }
      rows.push(row); console.log(JSON.stringify({ stage: "retrieval", question: q.id, count: rows.length }));
    }
    frozen = { version: 2, createdAt: new Date().toISOString(), datasetHash, promptHash, split, code, config, buildMs, lexicalBackend: index.lexicalBackend,
      limitations: ["Curated real-history corpus; not the full production corpus", "Agent-authored labels, not independently human-validated", "Quote coverage is an exact-text proxy, not semantic support", "Session-level metrics; Wilson interval is descriptive and ignores within-project dependence", "Test split must not guide tuning after inspection"],
      runtime: { node: process.version, platform: process.platform, keepAlive: process.env.AGENT_SNAPSHOTS_RAG_KEEP_ALIVE || "0" }, rows,
      summary: { all: retrievalSummary(rows), dev: retrievalSummary(rows.filter((r) => r.split === "dev")), test: retrievalSummary(rows.filter((r) => r.split === "test")) } };
    await writeFile(path.join(output, "retrieval.json"), JSON.stringify(frozen, null, 2));
  } finally { index.close(); }
}
if (process.argv.includes("--retrieval-only")) process.exit(0);
const repeats = Number(arg("--repeats", "2"));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("repeats must be 1..10");
const models = arg("--models", `${config.chatProvider}:${config.chatModel}`).split(",").map((entry) => {
  const colon = entry.indexOf(":"); const chatProvider = entry.slice(0, colon), chatModel = entry.slice(colon + 1);
  if (!["ollama", "deepseek"].includes(chatProvider) || !chatModel) throw new Error("models must be provider:model");
  return { ...config, chatProvider, chatModel };
});
const run = { version: 2, startedAt: new Date().toISOString(), datasetHash, promptHash, code, frozenHash: digest(frozen), split, repeats,
  priceNote: "DeepSeek Flash USD estimates use 2026-09-11 peak/off-peak rates; not a billing receipt. Local hardware/electricity and failed-request charges excluded.",
  priceSource: "https://api-docs.deepseek.com/quick_start/pricing/", results: [] };
for (let repeat = 0; repeat < repeats; repeat++) {
  // Rotate order to reduce a fixed cold-start advantage between models/repeats.
  const ordered = repeat % 2 ? [...frozen.rows].reverse() : frozen.rows;
  for (const row of ordered) for (const model of repeat % 2 ? [...models].reverse() : models) {
    const evidence = row.variants.hybrid.evidence;
    const start = performance.now();
    const item = { id: `${row.id}:${model.chatProvider}:${model.chatModel}:${repeat}`, questionId: row.id, split: row.split, group: row.group, repeat,
      answerable: row.answerable, config: model, evidenceHash: digest(evidence), abstentionStage: evidence.length ? "model" : "retrieval-gate" };
    try {
      item.answer = evidence.length ? await generateRagAnswer(row.query, evidence, undefined, model) : { insufficient: true, reason: "No evidence passed retrieval gate", claims: [], inputTokens: 0, outputTokens: 0 };
      item.outcome = item.answerable ? item.answer.insufficient ? "false-abstention" : "answered" : item.answer.insufficient ? "correct-abstention" : "unsupported-answer";
    } catch (error) { item.error = error.message; item.outcome = "error"; }
    item.latencyMs = performance.now() - start;
    if (item.answer && model.chatProvider === "deepseek" && model.chatModel === "deepseek-flash") {
      const usage = item.answer;
      const hit = usage.cacheHitTokens || 0, miss = Math.max(0, (usage.inputTokens || 0) - hit);
      const peak = (hit * .006 + miss * .3 + (usage.outputTokens || 0) * 1.2) / 1e6;
      item.estimatedUsdRange = [peak / 2, peak];
    }
    run.results.push(item);
    await writeFile(path.join(output, "generation.json"), JSON.stringify(run, null, 2));
    console.log(JSON.stringify({ stage: "generation", question: row.id, model: model.chatModel, repeat, outcome: item.outcome }));
  }
}
run.finishedAt = new Date().toISOString();
run.summary = Object.fromEntries(models.map((model) => {
  const rows = run.results.filter((r) => r.config.chatModel === model.chatModel && r.config.chatProvider === model.chatProvider);
  return [`${model.chatProvider}:${model.chatModel}`, { calls: rows.filter((r) => r.abstentionStage === "model").length, questions: frozen.rows.length, repeats,
    outcomes: Object.fromEntries(["answered", "false-abstention", "correct-abstention", "unsupported-answer", "error"].map((v) => [v, rows.filter((r) => r.outcome === v).length])),
    modelAbstentions: rows.filter((r) => r.answer?.insufficient && r.abstentionStage === "model").length, gateAbstentions: rows.filter((r) => r.abstentionStage === "retrieval-gate").length,
    p50Ms: percentile(rows.map((r) => r.latencyMs), .5), p95Ms: percentile(rows.map((r) => r.latencyMs), .95),
    inputTokens: rows.reduce((s, r) => s + (r.answer?.inputTokens || 0), 0), outputTokens: rows.reduce((s, r) => s + (r.answer?.outputTokens || 0), 0),
    estimatedUsdRange: rows.some((r) => r.estimatedUsdRange) ? [0, 1].map((i) => rows.reduce((s, r) => s + (r.estimatedUsdRange?.[i] || 0), 0)) : null }];
}));
await writeFile(path.join(output, "generation.json"), JSON.stringify(run, null, 2));
const reviews = { runHash: digest(run), reviewerType: "human", reviewer: "", rubricVersion: 1,
  items: run.results.filter((r) => !r.error).map((r) => ({ id: r.id, answerHash: digest(r.answer), status: "pending", correctness: null, completeness: null, relevance: null, temporalAccuracy: null, notes: "", claims: r.answer.claims.map((_, index) => ({ index, support: null, citationSupport: null, reason: "" })) })) };
await writeFile(path.join(output, "review-template.json"), JSON.stringify(reviews, null, 2));
await writeFile(path.join(output, "review-packet.json"), JSON.stringify({ datasetHash, questions: dataset.questions, snapshots: dataset.snapshots, evidence: frozen.rows.map((r) => ({ id: r.id, evidence: r.variants.hybrid.evidence })), run }, null, 2));
console.log(JSON.stringify({ output, summary: run.summary }));
if (run.results.some((r) => r.error)) process.exitCode = 1;
