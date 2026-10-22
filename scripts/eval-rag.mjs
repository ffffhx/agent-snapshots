#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { RagIndex } from "../dist/server/rag-index.mjs";
import { fuseRagRanks, selectRagEvidenceHits, packRagEvidence, ragEvidenceBudget } from "../dist/server/rag-core.mjs";
import { ollamaEmbedder, generateRagAnswer, ragConfig } from "../dist/server/rag-service.mjs";
import { sessions as fixtureSessions, snapshots as fixtureSnapshots, questions as fixtureQuestions } from "./fixtures/rag-corpus.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const datasetFile = arg("--dataset", "");
const dataset = datasetFile ? JSON.parse(await readFile(datasetFile, "utf8")) : null;
const sessions = dataset?.sessions || fixtureSessions;
const snapshots = dataset ? new Map(Object.entries(dataset.snapshots)) : fixtureSnapshots;
const questions = dataset?.questions || fixtureQuestions;
const generationCount = Math.max(0, Number(arg("--generate", "0")));
const config = ragConfig(), embed = ollamaEmbedder(config);
const key = `${config.baseUrl}\0${config.embeddingModel}`;
const temp = await mkdtemp(path.join(os.tmpdir(), "rag-eval-"));
const index = new RagIndex(path.join(temp, "index.db"));
const output = path.resolve(arg("--output", "docs/evaluations/rag-latest.json"));
const results = [];
try {
  const started = performance.now();
  const deps = { listSessions: async () => sessions, loadSnapshot: async (ref) => { const snapshot = snapshots.get(ref); if (!snapshot) throw new Error(`Missing snapshot: ${ref}`); return snapshot; } };
  let sync;
  do { sync = await index.sync(deps); if (sync.failed) throw new Error("Dataset contains unreadable sessions"); } while (sync.pending);
  while (index.vectorStatus({}, key).pending) await index.embedPending({}, key, embed, undefined, 256);
  const buildMs = performance.now() - started;
  console.log(`Indexed ${sessions.length} sessions / ${sync.chunks} chunks. Running ${questions.length} questions with ${config.embeddingModel}.`);
  const answerable = questions.filter((q) => q.answerable);
  const unknown = questions.filter((q) => !q.answerable);
  const groups = Map.groupBy(answerable, (q) => q.expectedRef);
  const diverse = [...groups.values()].map((group, i) => group[i % group.length]);
  const remaining = answerable.filter((q) => !diverse.includes(q));
  const generationIds = new Set([...diverse, ...remaining].slice(0, Math.ceil(generationCount * 2 / 3)).concat(unknown.slice(0, Math.floor(generationCount / 3))).map((q) => q.id));
  for (const question of questions) {
    const scope = { cwd: question.cwd || "" };
    const keywordStart = performance.now();
    const keyword = (await index.keyword(question.query, scope));
    const keywordMs = performance.now() - keywordStart;
    const vectorStart = performance.now();
    const [query] = await embed([question.query]);
    const vector = index.vector(query, scope, key).filter((hit) => hit.score >= 0.3);
    const vectorMs = performance.now() - vectorStart;
    const row = { id: question.id, query: question.query, answerable: question.answerable, expectedRef: question.expectedRef, variants: {} };
    for (const [name, hits, latency] of [["keyword", keyword, keywordMs], ["vector", vector, vectorMs], ["hybrid", fuseRagRanks([keyword, vector]), keywordMs + vectorMs]]) {
      const before = performance.now();
      const refs = [...new Set(hits.map((h) => h.session.ref))].slice(0, 5);
      const rank = refs.indexOf(question.expectedRef);
      const selected = name === "hybrid" ? selectRagEvidenceHits(hits, keyword, vector) : hits;
      const evidence = packRagEvidence(selected, (hit) => index.parents(hit), { budget: ragEvidenceBudget(question.query) });
      const children = packRagEvidence(selected, (hit) => index.parents(hit), { expand: false, budget: ragEvidenceBudget(question.query) });
      row.variants[name] = { recallAt5: question.answerable ? Number(rank >= 0) : null, reciprocalRank: question.answerable ? (rank < 0 ? 0 : 1 / (rank + 1)) : null, parentContainsGold: question.answerable ? evidence.some((e) => e.ref === question.expectedRef && e.text.includes(question.expectedText)) : null, childContainsGold: question.answerable ? children.some((e) => e.ref === question.expectedRef && e.text.includes(question.expectedText)) : null, candidates: hits.length, retrievalMs: latency + performance.now() - before };
      if (name === "hybrid" && generationIds.has(question.id)) {
        const genStart = performance.now();
        try {
          const answer = evidence.length ? await generateRagAnswer(question.query, evidence) : { insufficient: true, claims: [], reason: "No evidence" };
          row.generation = { ...answer, generationMs: performance.now() - genStart, expectedPhraseMatched: question.answerable ? answer.claims.some((c) => c.text.includes(question.expectedText)) : null, correctAbstention: question.answerable ? null : answer.insufficient, citedEvidence: evidence.filter((e) => answer.claims.some((c) => c.citations.includes(e.id))).map((e) => ({ id: e.id, ref: e.ref, text: e.text })) };
        } catch (error) { row.generation = { error: error.message, generationMs: performance.now() - genStart }; }
      }
    }
    results.push(row);
    console.log(`${results.length}/${questions.length}: ${question.id}${row.generation ? row.generation.error ? " generation ERROR: " + row.generation.error : " generated" : ""}`);
  }
  const mean = (values) => values.reduce((a, b) => a + Number(b), 0) / Math.max(1, values.length);
  const p95 = (values) => values.sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] || 0;
  const summary = Object.fromEntries(["keyword", "vector", "hybrid"].map((name) => {
    const known = results.filter((r) => r.answerable).map((r) => r.variants[name]);
    return [name, { recallAt5: mean(known.map((r) => r.recallAt5)), mrrAt5: mean(known.map((r) => r.reciprocalRank)), parentGoldCoverage: mean(known.map((r) => r.parentContainsGold)), childGoldCoverage: mean(known.map((r) => r.childContainsGold)), retrievalP95Ms: p95(results.map((r) => r.variants[name].retrievalMs)) }];
  }));
  const generated = results.filter((r) => r.generation);
  const codeHash = createHash("sha256");
  for (const file of ["rag-core", "rag-index", "rag-service"]) codeHash.update(await readFile(new URL(`../dist/server/${file}.mjs`, import.meta.url)));
  const report = { generatedAt: new Date().toISOString(), codeHash: codeHash.digest("hex"), dataset: datasetFile || "authored-synthetic-regression-fixtures", limitations: ["Synthetic fixtures are not production quality measurements.", "Gold phrase coverage is an automatic proxy, not a factuality or citation-support score.", "Recall@5/MRR@5 are measured over distinct sessions, not chunks.", "No reranker evaluated. Generation is sampled; scores and latency are local single-run observations."], config, runtime: { node: process.version, platform: process.platform, memoryGiB: os.totalmem() / 1073741824, keepAlive: process.env.AGENT_SNAPSHOTS_RAG_KEEP_ALIVE || "0", embedGpu: process.env.AGENT_SNAPSHOTS_RAG_EMBED_GPU || "-1", context: 8192 }, lexicalBackend: index.lexicalBackend, sessions: sessions.length, questions: questions.length, answerableQuestions: answerable.length, buildMs, summary, generation: { count: generated.length, errors: generated.filter((r) => r.generation.error).length, unanswerableCount: generated.filter((r) => !r.answerable).length, correctAbstentions: generated.filter((r) => !r.answerable && r.generation.correctAbstention).length, p95Ms: p95(generated.map((r) => r.generation.generationMs)) }, results };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ output, summary, generation: report.generation }, null, 2));
  if (report.generation.errors) process.exitCode = 1;
} finally {
  index.close();
  if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe temp cleanup path");
  await rm(temp, { recursive: true, force: true });
}
