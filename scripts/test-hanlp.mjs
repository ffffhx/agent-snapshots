import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { tokenizeTexts, searchQueryTerms, closeSearchTokenizer, tokenizerVersion } from "../dist/server/search-tokenizer.mjs";
import { syncSearchIndex, searchIndexed, searchFileState, closeSearchIndexDatabases } from "../dist/server/search-index.mjs";
after(() => closeSearchTokenizer());

test("real HanLP: Chinese short words, technical dictionary, code identifiers and query boundaries", async () => {
  const start = performance.now();
  const [tokens] = await tokenizeTexts(["排查数据库连接池耗尽 getUserSession rag_service.ts ERR_CONNECTION_REFUSED 白屏"]);
  for (const term of ["数据库", "连接池", "连接", "getusersession", "get", "user", "session", "rag_service.ts", "rag", "service", "ts", "err_connection_refused", "白屏"]) assert(tokens.includes(term), term);
  assert.deepEqual(await searchQueryTerms("getUserSession"), ["getusersession"]);
  assert.deepEqual(await searchQueryTerms("ERR_CONNECTION_REFUSED"), ["err_connection_refused"]);
  assert.deepEqual(await searchQueryTerms("如何排查连接池耗尽的问题"), ["排查", "连接池", "耗尽"]);
  console.log(`HanLP first request ${Math.round(performance.now() - start)} ms`);
  const timings = [];
  for (const query of ["数据库连接失败", "向量检索", "如何修复白屏", "自动恢复", "冷启动耗时"]) {
    const t = performance.now(); await searchQueryTerms(query); timings.push(Math.round(performance.now() - t));
  }
  console.log("HanLP warm uncached queries (ms):", timings);
});

test("search migration, semantic word boundaries, code parts, updates and deletion", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "hanlp-search-"));
  const previousCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = path.join(temp, "cache");
  const file = path.join(temp, "sessions", "fixture.jsonl");
  await mkdir(path.dirname(file), { recursive: true });
  const summary = { id: "hanlp-fixture", ref: "codex:hanlp-fixture", engine: "codex", filePath: file, cwd: temp, mtime: "2026-09-14T00:00:00Z" };
  const write = async (text) => writeFile(file, [
    { type: "session_meta", payload: { id: summary.id, cwd: temp } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } },
  ].map(JSON.stringify).join("\n") + "\n");
  const sync = () => syncSearchIndex({ sessions: [summary], withTokens: false, force: true });
  try {
    await write("排查数据库连接池耗尽，修复白屏。函数 getUserSession，文件 src/server/rag_service.ts，错误 ERR_CONNECTION_REFUSED。");
    assert.equal((await sync()).failed, 0);
    for (const query of ["连接池", "白屏", "数据库 耗尽", "getUserSession", "Session", "rag_service.ts", "service", "ERR_CONNECTION_REFUSED"]) {
      assert.equal((await searchIndexed({ query })).matched, 1, query);
    }
    for (const query of ["数据", "getUser", "ERR_CONNECTION_RESET", '" OR unknownmarker', "构建", ""]) {
      assert.equal((await searchIndexed({ query })).matched, 0, query);
    }
    assert.equal((await searchIndexed({ query: "白屏", cwd: "/elsewhere" })).matched, 0);
    assert.equal((await searchIndexed({ query: "白屏", source: "claude" })).matched, 0);
    let db = await searchFileState();
    // Simulate an old cache in place, including the original FTS schema when
    // this runtime supports FTS5. Migration must replace it, not just IF NOT EXISTS.
    const fts = db.prepare("SELECT sql FROM sqlite_master WHERE name='docs_fts'").get();
    if (fts) {
      db.exec("DROP TRIGGER docs_fts_ai; DROP TRIGGER docs_fts_ad; DROP TRIGGER docs_fts_au; DROP TABLE docs_fts");
      db.exec("CREATE VIRTUAL TABLE docs_fts USING fts5(fold, content='docs', content_rowid='rowid', tokenize='trigram')");
      db.exec("INSERT INTO docs_fts(docs_fts) VALUES('rebuild')");
      db.exec("DELETE FROM meta WHERE key='hanlp_fts_ready'");
    }
    db.exec("UPDATE docs SET lexical_version='old'");
    await closeSearchIndexDatabases();
    assert.equal((await searchIndexed({ query: "白屏" })).matched, 0, "stale tokenizer version excluded");
    const refreshed = await syncSearchIndex({ sessions: [summary], withTokens: false });
    assert.equal(refreshed.updated, 1, "same mtime must still retokenize");
    db = await searchFileState();
    assert.equal(db.prepare("SELECT lexical_version FROM docs").get().lexical_version, tokenizerVersion);
    assert.equal((await searchIndexed({ query: "白屏" })).matched, 1);
    await write("修复内存泄漏 NEW_CONTENT");
    assert.equal((await sync()).failed, 0);
    assert.equal((await searchIndexed({ query: "白屏" })).matched, 0);
    assert.equal((await searchIndexed({ query: "NEW_CONTENT" })).matched, 1);
    db.exec("DELETE FROM docs");
    assert.equal((await searchIndexed({ query: "NEW_CONTENT" })).matched, 0);
  } finally {
    await closeSearchIndexDatabases();
    if (previousCache === undefined) delete process.env.XDG_CACHE_HOME; else process.env.XDG_CACHE_HOME = previousCache;
    assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(temp, { recursive: true, force: true });
  }
});
