import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RagIndex } from '../dist/server/rag-index.mjs';
import { buildRagDocument, sessionKey, packRagEvidence, ragEvidenceBudget } from '../dist/server/rag-core.mjs';
import { searchQueryTerms, tokenizerVersion, closeSearchTokenizer } from '../dist/server/search-tokenizer.mjs';
import { searchTerms, foldSearchText } from '../dist/sources/local-history.mjs';
import { sessions, snapshots, questions } from './fixtures/rag-corpus.mjs';
import { digest, validateDataset, retrievalMetrics, quoteCoverage, mean, percentile } from './lib/rag-eval.mjs';

// A prototype trigram RAG retriever, not a change to production search.
// FTS5 cannot MATCH <3-character strings. For these terms we scan substrings
// and add their BM25 contribution, with the SAME FTS5 k1/b/IDF and actual FTS
// token lengths from fts5vocab. This is not an indexed short-query operation.
class TrigramRag {
  db = new DatabaseSync(':memory:');
  constructor(chunks) {
    this.chunks = chunks;
    this.texts = chunks.map((h) => foldSearchText(h.text));
    this.db.exec("CREATE VIRTUAL TABLE tri USING fts5(text,content='',tokenize='trigram'); CREATE VIRTUAL TABLE vocabulary USING fts5vocab(tri,'instance')");
    const insert = this.db.prepare('INSERT INTO tri(rowid,text) VALUES(?,?)');
    this.db.exec('BEGIN');
    this.texts.forEach((t, i) => insert.run(i + 1, t));
    this.db.exec('COMMIT');
    this.lengths = new Map(this.db.prepare('SELECT doc,count(*) AS n FROM vocabulary GROUP BY doc').all().map((r) => [r.doc, r.n]));
    this.average = [...this.lengths.values()].reduce((s, n) => s + n, 0) / Math.max(1, chunks.length);
  }
  close() { this.db.close(); }
  contribution(tf, df, id) {
    const idf = Math.max(1e-6, Math.log((this.chunks.length - df + .5) / (df + .5)));
    return idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * (this.lengths.get(id) || 0) / Math.max(1, this.average)));
  }
  occurrences(term) {
    return this.texts.map((text) => {
      let count = 0, at = 0;
      while ((at = text.indexOf(term, at)) >= 0) { count++; at++; }
      return count;
    });
  }
  keyword(terms, scope = {}) {
    terms = [...new Set(terms)].slice(0, 32);
    if (!terms.length) return [];
    const long = terms.filter((t) => Array.from(t).length >= 3), short = terms.filter((t) => Array.from(t).length < 3);
    const scores = new Map();
    if (long.length) {
      const match = long.map((t) => '"' + t.replaceAll('"', '""') + '"').join(' OR ');
      for (const row of this.db.prepare('SELECT rowid,bm25(tri) AS rank FROM tri WHERE tri MATCH ?').all(match)) scores.set(row.rowid, -row.rank);
    }
    for (const term of short) {
      const counts = this.occurrences(term), df = counts.filter(Boolean).length;
      counts.forEach((tf, i) => { if (tf) scores.set(i + 1, (scores.get(i + 1) || 0) + this.contribution(tf, df, i + 1)); });
    }
    return [...scores].map(([id, score]) => ({ ...this.chunks[id - 1], score, ordinal: id }))
      .filter((h) => (!scope.cwd || h.session.cwd === scope.cwd) && (!scope.source || scope.source === 'all' || h.session.engine === scope.source))
      .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal).slice(0, 40);
  }
}

// Validate OR union, short-term fallback, SQL quoting, scope and the auxiliary
// BM25 formula against native FTS5 on a phrase which native FTS5 can evaluate.
const check = new TrigramRag(['abcdefgh abcd', 'abcdef', 'zzzzzz', 'qqqqqq', 'mmmmmm'].map((text, i) => ({ id: String(i), text, session: { ref: String(i), cwd: String(i) } })));
try {
  const counts = check.occurrences('abcd'), df = counts.filter(Boolean).length;
  for (const hit of check.keyword(['abcd'])) assert(Math.abs(hit.score - check.contribution(counts[hit.ordinal - 1], df, hit.ordinal)) < 1e-10);
  assert.equal(check.keyword(['ab']).length, 2);
  assert.equal(check.keyword(['abcd', 'zzzz']).length, 3);
  assert.equal(check.keyword(['ab'], { cwd: '1' }).length, 1);
  assert.equal(check.keyword(['" OR unknown']).length, 0);
} finally { check.close(); }

const output = path.resolve(process.argv[2] || '.agent-snapshots/rag-tokenizer-comparison/' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const datasets = [{ name: 'synthetic', sessions, snapshots: Object.fromEntries(snapshots), questions: questions.map((q) => ({ ...q, gold: q.answerable ? [{ ref: q.expectedRef, quote: q.expectedText }] : [] })) }];
try { datasets.push({ ...validateDataset(JSON.parse(await readFile('.agent-snapshots/rag-eval/dataset-v2.json', 'utf8'))), name: 'frozen-real' }); }
catch (error) { if (error.code !== 'ENOENT') throw error; console.log('Private real dataset missing: synthetic-only run.'); }
const variants = ['hanlp', 'trigram-native-query', 'trigram-hanlp-query'];
const report = { createdAt: new Date().toISOString(), runtime: process.versions, cpu: os.cpus()[0]?.model, tokenizerVersion,
  methodology: 'RAG lexical retrieval only; production 1200-char chunks/150 overlap, OR + BM25, top40 chunks, session-dedup top5. HanLP runs actual RagIndex.keyword(). Trigram >=3 terms use native FTS5 phrase BM25; shorter terms scan substrings with additive FTS5-formula BM25 (validated on a native phrase). Native-query baseline uses whitespace; shared-query control uses production HanLP terms incl single-Han filtering. Same scope, source, parent expansion and evidence budget. Five alternating warm repetitions after all three query paths prewarm. No embeddings or answer generation. All real data remain in ignored output; public summaries omit query/source text. No tuning on test results.', datasets: [] };
try {
  const start = performance.now(); await searchQueryTerms('模型预热'); report.coldHanlpMs = performance.now() - start;
  for (const dataset of datasets) {
    const deps = { listSessions: async () => dataset.sessions, loadSnapshot: async (ref) => dataset.snapshots[ref] };
    const index = new RagIndex(':memory:');
    assert.equal(index.lexicalBackend, 'fts5', 'Must run with Electron FTS5; scan fallback is not this experiment');
    const start = performance.now(); const sync = await index.sync(deps, undefined, Infinity);
    assert.equal(sync.failed, 0); assert.equal(sync.pending, 0);
    const hanlpBuildMs = performance.now() - start;
    const chunks = dataset.sessions.flatMap((s) => buildRagDocument(dataset.snapshots[s.ref], sessionKey(s)).chunks.map((h) => ({ ...h, session: s })));
    const triStart = performance.now(); const tri = new TrigramRag(chunks);
    const result = { name: dataset.name, datasetHash: digest(dataset), sessions: dataset.sessions.length, chunks: chunks.length, questions: dataset.questions.length, hanlpBuildMs, trigramBuildMs: performance.now() - triStart, rows: [], summary: {}, testSummary: {} };
    try {
      for (const q of dataset.questions) {
        const scope = { cwd: q.cwd || '' };
        const begin = performance.now();
        const raw = await searchQueryTerms(q.query), meaningful = raw.filter((t) => !/^\p{Script=Han}$/u.test(t));
        const shared = (meaningful.length ? meaningful : raw).slice(0, 32);
        const firstQueryTermsMs = performance.now() - begin;
        const native = searchTerms(q.query).slice(0, 32);
        const retrieve = (v) => v === 'hanlp' ? index.keyword(q.query, scope) : tri.keyword(v === 'trigram-native-query' ? native : shared, scope);
        for (const v of variants) await retrieve(v);
        const row = { id: q.id, query: q.query, answerable: q.answerable, split: q.split, firstQueryTermsMs, sharedTerms: shared, nativeTerms: native, variants: {} };
        for (let i = 0; i < 5; i++) {
          for (const v of i % 2 ? [...variants].reverse() : variants) {
            const at = performance.now(); const hits = await retrieve(v); const ms = performance.now() - at;
            if (!i) {
              const evidence = packRagEvidence(hits, (h) => index.parents(h), { budget: ragEvidenceBudget(q.query) });
              const m = retrievalMetrics(hits, q.gold);
              row.variants[v] = { ...m, candidates: hits.length, coverage: quoteCoverage(evidence, q.gold), times: [], hitIds: hits.map((h) => h.id) };
            } else assert.deepEqual(hits.map((h) => h.id), row.variants[v].hitIds, 'repeatable rank order');
            row.variants[v].times.push(ms);
          }
        }
        result.rows.push(row);
      }
      function summarize(rows, v) {
        const known = rows.filter((r) => r.answerable).map((r) => r.variants[v]), unknown = rows.filter((r) => !r.answerable).map((r) => r.variants[v]);
        return { answerable: known.length, hitAt5: mean(known.map((r) => r.hitAtK)), recallAt5: mean(known.map((r) => r.recallAtK)), mrrAt5: mean(known.map((r) => r.reciprocalRank)), ndcgAt5: mean(known.map((r) => r.ndcgAtK)), goldCoverage: mean(known.map((r) => r.coverage)), unknown: unknown.length, unknownWithCandidates: unknown.filter((r) => r.candidates).length, warmP95Ms: percentile(rows.flatMap((r) => r.variants[v].times), .95) };
      }
      for (const v of variants) { result.summary[v] = summarize(result.rows, v); result.testSummary[v] = summarize(result.rows.filter((r) => r.split === 'test'), v); }
      result.firstHanlpQueryP95Ms = percentile(result.rows.map((r) => r.firstQueryTermsMs), .95);
      report.datasets.push(result);
      console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
    } finally { tri.close(); index.close(); }
  }
  report.scriptHash = digest(await readFile(new URL(import.meta.url), 'utf8'));
  report.codeHashes = Object.fromEntries(await Promise.all(['rag-core', 'rag-index', 'search-tokenizer'].map(async (name) => [name, digest(await readFile(new URL('../dist/server/' + name + '.mjs', import.meta.url), 'utf8'))])));
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile('docs/evaluations/rag-tokenizer-comparison.json', JSON.stringify({ ...report, datasets: report.datasets.map(({ rows, ...d }) => ({ ...d, perQuestion: rows.map((r) => ({ id: r.id, answerable: r.answerable, split: r.split, variants: Object.fromEntries(variants.map((v) => { const { refs, hitIds, times, ...metrics } = r.variants[v]; return [v, metrics]; })) })) })) }, null, 2) + '\n');
  console.log('Private artifacts: ' + output);
} finally { closeSearchTokenizer(); }
