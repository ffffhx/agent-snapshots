import { mkdir, writeFile } from "node:fs/promises";
import { RagIndex } from "../dist/server/rag-index.mjs";
import { closeSearchTokenizer, tokenizerVersion } from "../dist/server/search-tokenizer.mjs";
import { fixtureDeps, questions } from "./fixtures/rag-corpus.mjs";

const index = new RagIndex(":memory:");
try {
  const begin = performance.now();
  const sync = await index.sync(fixtureDeps);
  if (sync.failed || sync.pending) throw new Error("Fixture indexing incomplete");
  const buildMs = performance.now() - begin;
  const results = [];
  for (const q of questions) {
    const start = performance.now();
    const hits = await index.keyword(q.query);
    const refs = [...new Set(hits.map((h) => h.session.ref))].slice(0, 5);
    const rank = refs.indexOf(q.expectedRef);
    results.push({ id: q.id, answerable: q.answerable, rank: rank < 0 ? null : rank + 1, candidates: hits.length, ms: performance.now() - start });
  }
  const known = results.filter((r) => r.answerable), unknown = results.filter((r) => !r.answerable);
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const report = {
    dataset: "Authored synthetic rag-corpus; not production accuracy", tokenizerVersion,
    runtime: process.versions, backend: index.lexicalBackend, buildMs,
    answerable: known.length, recallAt5: known.filter((r) => r.rank).length / known.length,
    mrrAt5: known.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / known.length,
    unknownQueries: unknown.length, unknownWithCandidates: unknown.filter((r) => r.candidates).length,
    queryP50Ms: times[Math.floor(times.length * .5)], queryP95Ms: times[Math.floor(times.length * .95)], results,
  };
  await mkdir("docs/evaluations", { recursive: true });
  await writeFile("docs/evaluations/hanlp-keyword.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
} finally { index.close(); closeSearchTokenizer(); }
