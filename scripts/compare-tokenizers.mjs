// Runs under Electron's node mode: real FTS5 trigram is required (no mocks).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { tokenizeTexts, searchQueryTerms, indexToken, tokenizerVersion, closeSearchTokenizer } from '../dist/server/search-tokenizer.mjs';
import { matchSearchDocument, foldSearchText, searchTerms } from '../dist/sources/local-history.mjs';
import { sessions, snapshots, questions } from './fixtures/rag-corpus.mjs';

const digest = (s) => createHash('sha256').update(s).digest('hex');
const output = path.resolve(process.argv[2] || '.agent-snapshots/tokenizer-comparison/' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const variants = ['hanlp', 'trigram-native', 'trigram-shared-query'];
const mean = (a) => a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
const percentile = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1] : null;
const phrase = (t) => '"' + t.replaceAll('"', '""') + '"';
const like = (t) => '%' + t.replace(/[\\%_]/g, '\\$&') + '%';
const synthetic = { name: 'synthetic-history', sessions, snapshots: Object.fromEntries(snapshots), questions: questions.map((q) => ({ ...q, gold: q.expectedRef ? [{ ref: q.expectedRef }] : [], category: 'natural-question' })) };
const cases = [
  ['pool', '数据库连接池耗尽导致连接失败'], ['db', '数据库备份成功'],
  ['connection', '网络连接失败但内存池正常'], ['data', '数据清洗完成'],
  ['code', 'getUserSession 位于 src/server/rag_service.ts'], ['other-code', 'getUserSettings 位于 src/server/user_service.ts'],
  ['refused', 'ERR_CONNECTION_REFUSED 连接被拒绝'], ['reset', 'ERR_CONNECTION_RESET 连接被重置'],
  ['screen', 'Electron 启动白屏'], ['accelerate', '启用硬件加速'],
  ['leak', '内存泄漏引发崩溃'], ['leakage', '密钥泄漏事件调查'],
];
const edgeQuestions = [
  ['连接池', ['pool'], 'short-technical'], ['数据库', ['pool', 'db'], 'technical'],
  ['白屏', ['screen'], 'short-technical'], ['内存泄漏', ['leak'], 'technical'],
  ['内存', ['leak', 'connection'], 'short-word'], ['数据', ['data'], 'word-boundary'],
  ['getUserSession', ['code'], 'exact-code'], ['Session', ['code'], 'code-part'],
  ['rag_service.ts', ['code'], 'basename'], ['service', ['code', 'other-code'], 'code-part'],
  ['ERR_CONNECTION_REFUSED', ['refused'], 'exact-error'], ['ERR_CONNECTION_RESET', ['reset'], 'exact-error'],
  ['getUser', ['code', 'other-code'], 'identifier-prefix'], ['UserSess', ['code'], 'identifier-substring'],
  ['rag_serv', ['code'], 'filename-substring'], ['CONNECTION_REF', ['refused'], 'error-substring'],
  ['connection', ['refused', 'reset'], 'code-part'], ['内存 泄漏', ['leak'], 'multiword'],
  ['量子计算', [], 'absent'], ['ERR_DISK_FULL', [], 'absent'],
];
const edges = { name: 'boundary-cases', sessions: cases.map(([id]) => ({ ref: id, title: '', mtime: '2026-01-01T00:00:00Z' })),
  snapshots: Object.fromEntries(cases.map(([id, text]) => [id, { turns: [{ role: 'user', text }] }])),
  questions: edgeQuestions.map(([query, refs, category], i) => ({ id: 'edge-' + i, query, category, answerable: !!refs.length, gold: refs.map((ref) => ({ ref })) })) };
const datasets = [synthetic, edges];
const realPath = '.agent-snapshots/rag-eval/dataset-v2.json';
try {
  const real = JSON.parse(await readFile(realPath, 'utf8'));
  datasets.push({ ...real, name: 'frozen-real-history', questions: real.questions.map((q) => ({ ...q, category: 'natural-question' })) });
  const forms = JSON.parse(await readFile('.agent-snapshots/rag-eval/keyword-queries.json', 'utf8'));
  datasets.push({ ...real, name: 'real-keyword-forms', questions: Object.entries(forms).map(([id, query]) => {
    const original = real.questions.find((q) => q.id === id); assert(original, 'keyword form requires existing gold');
    return { ...original, query, category: 'manual-keyword-form' };
  }) });
}
catch (error) { if (error.code !== 'ENOENT') throw error; console.log('Frozen real dataset absent; running public fixtures only.'); }

const report = { createdAt: new Date().toISOString(), tokenizerVersion, cpu: os.cpus()[0]?.model, runtime: process.versions,
  methodology: 'Ordinary keyword search, session-level documents, AND across query terms, identical existing field/snippet scoring and source text. No embedding/generation. trigram-native uses legacy whitespace query terms; trigram-shared-query uses the SAME HanLP query terms as hanlp to isolate indexed word vs substring matching. Trigram terms under 3 characters use escaped SQL LIKE, matching legacy behavior. 5 alternating warm repetitions AFTER explicit common query prewarm; JS query cache bypassed with tokenizeTexts(query=true); model sentence cache remains warm. First query preprocessing and cold HanLP model load measured separately. Index bytes include identical raw text table plus contentless FTS. Real corpus and per-query results remain in ignored output directory. Keyword forms are manually shortened from existing questions, inherit existing agent gold, and are not independent natural query logs.', datasets: [] };
try {
  const cold = performance.now(); await tokenizeTexts(['预热中文分词模型']); report.hanlpColdMs = performance.now() - cold;
  for (const dataset of datasets) {
    const documents = dataset.sessions.map((summary, i) => {
      const snapshot = dataset.snapshots[summary.ref];
      const segments = (snapshot.turns || []).filter((t) => !['system', 'developer'].includes(t.role)).map((t, j) => ({ text: t.text || '', role: t.role, turn: t.turn || j + 1 }));
      const fields = [summary.title || '', summary.cwd || ''];
      return { id: i + 1, summary: { ...summary, mtime: '2026-01-01T00:00:00Z' }, fields, segments, text: [fields.join('\n'), ...segments.map((s) => s.text)].join('\n') };
    });
    const byId = new Map(documents.map((d) => [d.id, d]));
    const result = { name: dataset.name, corpusHash: digest(JSON.stringify(documents)), questionsHash: digest(JSON.stringify(dataset.questions)), documents: documents.length, questions: dataset.questions.length, rawBytes: documents.reduce((s, d) => s + Buffer.byteLength(d.text), 0), build: {}, summary: {}, rows: [] };
    const dbs = {};
    for (const kind of ['trigram', 'hanlp']) {
      const file = path.join(output, dataset.name + '-' + kind + '.db');
      const db = new DatabaseSync(file); dbs[kind] = db;
      db.exec('CREATE TABLE docs(id INTEGER PRIMARY KEY,body TEXT);');
      const rawInsert = db.prepare('INSERT INTO docs VALUES(?,?)');
      db.exec('BEGIN'); for (const d of documents) rawInsert.run(d.id, foldSearchText(d.text)); db.exec('COMMIT');
      const baseBytes = (await stat(file)).size;
      const start = performance.now();
      db.exec(`CREATE VIRTUAL TABLE idx USING fts5(text,content='',tokenize='${kind === 'hanlp' ? 'ascii' : 'trigram'}')`);
      let tokenMs = 0;
      const insert = db.prepare('INSERT INTO idx(rowid,text) VALUES(?,?)');
      for (const d of documents) {
        const t = performance.now();
        const value = kind === 'hanlp' ? (await tokenizeTexts([d.text]))[0].map(indexToken).join(' ') : foldSearchText(d.text);
        tokenMs += performance.now() - t;
        insert.run(d.id, value);
      }
      db.exec("INSERT INTO idx(idx) VALUES('optimize')");
      result.build[kind] = { elapsedMs: performance.now() - start, tokenMs, totalBytes: (await stat(file)).size, indexAddedBytes: (await stat(file)).size - baseBytes };
    }
    function retrieve(kind, query, terms) {
      if (!terms.length) return [];
      const db = dbs[kind];
      const long = kind === 'hanlp' ? terms : terms.filter((t) => Array.from(t).length >= 3);
      const short = kind === 'hanlp' ? [] : terms.filter((t) => Array.from(t).length < 3);
      const params = []; const clauses = [];
      if (long.length) { clauses.push('id IN (SELECT rowid FROM idx WHERE idx MATCH ?)'); params.push(long.map((t) => phrase(kind === 'hanlp' ? indexToken(t) : t)).join(' AND ')); }
      for (const term of short) { clauses.push("body LIKE ? ESCAPE '\\'"); params.push(like(term)); }
      const ids = db.prepare('SELECT id FROM docs WHERE ' + clauses.join(' AND ')).all(...params);
      return ids.map(({ id }) => matchSearchDocument(byId.get(id), query, foldSearchText(query), terms, true))
        .filter(Boolean).sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
    }
    for (const q of dataset.questions) {
      const row = { id: q.id, query: q.query, category: q.category, split: q.split, answerable: q.answerable, gold: [...new Set(q.gold.map((g) => g.ref))], variants: {} };
      const firstStart = performance.now();
      await tokenizeTexts([q.query], true);
      row.firstHanlpQueryMs = performance.now() - firstStart;
      for (let repeat = 0; repeat < 5; repeat++) {
        for (const variant of repeat % 2 ? [...variants].reverse() : variants) {
          const start = performance.now();
          const terms = variant === 'trigram-native' ? searchTerms(q.query) : (await tokenizeTexts([q.query], true))[0].slice(0, 32);
          const queryMs = performance.now() - start;
          const hits = retrieve(variant === 'hanlp' ? 'hanlp' : 'trigram', q.query, terms).filter((h) => !q.cwd || h.cwd === q.cwd);
          const elapsed = performance.now() - start;
          const refs = hits.slice(0, 5).map((h) => h.ref);
          const relevant = refs.filter((ref) => row.gold.includes(ref)).length;
          const first = refs.findIndex((ref) => row.gold.includes(ref));
          const score = { recall: q.answerable ? relevant / row.gold.length : null, hit: q.answerable ? Number(relevant > 0) : null,
            rr: q.answerable ? (first < 0 ? 0 : 1 / (first + 1)) : null, precisionAt5: q.answerable ? relevant / 5 : null, falsePositive: !q.answerable && hits.length > 0, refs, terms, candidates: hits.length };
          if (repeat === 0) row.variants[variant] = { ...score, times: [], queryTimes: [], lookupTimes: [] };
          else assert.deepEqual(refs, row.variants[variant].refs, 'rank stability across repeats');
          row.variants[variant].times.push(elapsed); row.variants[variant].queryTimes.push(queryMs); row.variants[variant].lookupTimes.push(elapsed - queryMs);
        }
      }
      result.rows.push(row);
    }
    for (const variant of variants) {
      const rows = result.rows.map((r) => r.variants[variant]);
      const known = rows.filter((r) => r.recall !== null), unknown = rows.filter((r) => r.recall === null);
      result.summary[variant] = { answerable: known.length, recallAt5: mean(known.map((r) => r.recall)), hitAt5: mean(known.map((r) => r.hit)), mrrAt5: mean(known.map((r) => r.rr)), precisionAt5: mean(known.map((r) => r.precisionAt5)), unknown: unknown.length, unknownWithHits: unknown.filter((r) => r.falsePositive).length,
        p50Ms: percentile(rows.flatMap((r) => r.times), .5), p95Ms: percentile(rows.flatMap((r) => r.times), .95), lookupP95Ms: percentile(rows.flatMap((r) => r.lookupTimes), .95) };
    }
    result.firstHanlpQueryP95Ms = percentile(result.rows.map((r) => r.firstHanlpQueryMs), .95);
    for (const db of Object.values(dbs)) db.close();
    report.datasets.push(result);
    console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
  }
  report.scriptHash = digest(await readFile(new URL(import.meta.url)));
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const publicReport = { ...report, datasets: report.datasets.map(({ rows, ...d }) => ({ ...d, disagreements: rows.filter((r) => new Set(variants.map((v) => JSON.stringify(r.variants[v].refs))).size > 1).map((r) => ({ id: r.id, category: r.category, answerable: r.answerable, variants: Object.fromEntries(variants.map((v) => [v, { recall: r.variants[v].recall, rr: r.variants[v].rr, candidates: r.variants[v].candidates }])) })) })) };
  await writeFile('docs/evaluations/tokenizer-comparison.json', JSON.stringify(publicReport, null, 2) + '\n');
  console.log('Private artifacts: ' + output);
} finally { closeSearchTokenizer(); }
