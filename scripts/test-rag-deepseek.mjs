import assert from "node:assert/strict";
import { test } from "node:test";
import { generateRagAnswer, ragConfig, ragModelStatus } from "../dist/server/rag-service.mjs";

test("DeepSeek generation uses authenticated JSON, validates citations, handles failure and keeps secrets private", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousProvider = process.env.AGENT_SNAPSHOTS_RAG_PROVIDER;
  const testKey = "sk-synthetic-test-secret";
  process.env.DEEPSEEK_API_KEY = testKey;
  process.env.AGENT_SNAPSHOTS_RAG_PROVIDER = "deepseek";
  const evidence = [{ id: 1, ref: "fixture", title: "fixture", cwd: "", source: "Session", turn: 1, timestamp: "", text: "修正路径后测试通过。", truncated: false, score: 1 }];
  const config = { baseUrl: "http://127.0.0.1:11434", embeddingModel: "qwen3-embedding:0.6b", chatModel: "deepseek-flash", chatProvider: "deepseek" };
  let status = 200, finish = "stop", citations = [1];
  try {
    assert(!JSON.stringify(ragConfig()).includes(testKey));
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/api/tags")) {
        assert(!init.headers?.authorization);
        return Response.json({ models: [{ name: config.embeddingModel }] });
      }
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(init.headers.authorization, `Bearer ${testKey}`);
      const body = JSON.parse(init.body);
      assert.equal(body.response_format.type, "json_object");
      assert.equal(body.model, "deepseek-flash");
      assert.deepEqual(JSON.parse(body.messages[1].content).evidence, evidence);
      if (status !== 200) return Response.json({ error: { message: testKey } }, { status });
      return Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify({ insufficient: false, claims: [{ text: "修正路径后测试通过。", citations }] }) } }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
    };
    const answer = await generateRagAnswer("如何修复？", evidence, undefined, config);
    assert.equal(answer.model, "deepseek-flash");
    assert.equal(answer.inputTokens, 20);
    assert.deepEqual(answer.claims[0].citations, [1]);
    const modelStatus = await ragModelStatus();
    assert.equal(modelStatus.available, true);
    assert.deepEqual(modelStatus.missing, []);
    assert(!JSON.stringify(modelStatus).includes(testKey));
    citations = [999];
    await assert.rejects(generateRagAnswer("test", evidence, undefined, config), /引用无效/);
    citations = [1]; finish = "length";
    await assert.rejects(generateRagAnswer("test", evidence, undefined, config), /未完成/);
    finish = "stop";
    for (status of [401, 402, 429, 500]) await assert.rejects(generateRagAnswer("test", evidence, undefined, config), (error) => error.message.includes(String(status)) && !error.message.includes(testKey));
    globalThis.fetch = async (_url, init) => { init.signal.throwIfAborted(); throw new Error(testKey); };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(generateRagAnswer("test", evidence, controller.signal, config), { name: "AbortError" });
    await assert.rejects(generateRagAnswer("test", evidence, undefined, config), (error) => !error.message.includes(testKey));
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey;
    if (previousProvider === undefined) delete process.env.AGENT_SNAPSHOTS_RAG_PROVIDER; else process.env.AGENT_SNAPSHOTS_RAG_PROVIDER = previousProvider;
  }
});
