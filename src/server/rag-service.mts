import { defaultEmbeddingModel, defaultOllamaBaseUrl } from "./semantic-search.mjs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fuseRagRanks, selectRagEvidenceHits, packRagEvidence, ragEvidenceBudget, RAG_SYSTEM_PROMPT, validateRagAnswer, type RagEvidence } from "./rag-core.mjs";
import { openRagIndex, validateVectors, type RagDependencies, type RagEmbedder, type RagScope } from "./rag-index.mjs";

export type RagEvent = { type: string; [key: string]: unknown };
export type RagOptions = RagScope & { query: string; mode?: "keyword" | "vector" | "hybrid"; expand?: boolean };
type Config = { baseUrl: string; embeddingModel: string; chatModel: string; chatProvider?: "ollama" | "deepseek" };

function deepseekApiKey() {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return process.env.DEEPSEEK_API_KEY.trim();
  try { return readFileSync(path.join(os.homedir(), ".config", "agent-snapshots", "deepseek-api-key"), "utf8").trim(); }
  catch { return ""; }
}

export function ragConfig(): Config {
  const requested = process.env.AGENT_SNAPSHOTS_RAG_PROVIDER;
  if (requested && requested !== "ollama" && requested !== "deepseek") throw new Error("Unsupported RAG provider");
  const chatProvider: "ollama" | "deepseek" = requested === "deepseek" || (!requested && deepseekApiKey()) ? "deepseek" : "ollama";
  return { baseUrl: defaultOllamaBaseUrl().replace(/\/$/, ""), embeddingModel: defaultEmbeddingModel(), chatProvider, chatModel: process.env.AGENT_SNAPSHOTS_RAG_MODEL || (chatProvider === "deepseek" ? "deepseek-flash" : "qwen3:4b") };
}

async function ollamaJson(route: string, body: unknown, config: Config, signal?: AbortSignal) {
  const response = await fetch(`${config.baseUrl}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]) }).catch((error) => {
    signal?.throwIfAborted();
    throw new Error(`无法连接 Ollama 或请求超时，请确认服务已启动。${error instanceof Error ? error.message : ""}`);
  });
  const payload = await response.json().catch(() => { throw new Error("Ollama 返回了不完整的响应，请检查可用内存后重试。"); });
  if (!response.ok || payload.error) throw new Error(payload.error || `Ollama HTTP ${response.status}`);
  return payload;
}

export function ollamaEmbedder(config = ragConfig()): RagEmbedder {
  return async (texts, signal) => {
    // Release after each batch on memory-constrained laptops. Users with spare
    // RAM/VRAM can opt into residency to trade memory for lower latency.
    const gpu = Number(process.env.AGENT_SNAPSHOTS_RAG_EMBED_GPU || "-1");
    const payload = await ollamaJson("/api/embed", { model: config.embeddingModel, input: texts, truncate: false, keep_alive: process.env.AGENT_SNAPSHOTS_RAG_KEEP_ALIVE || 0, options: { num_gpu: Number.isFinite(gpu) ? gpu : -1 } }, config, signal);
    validateVectors(payload.embeddings, texts.length);
    return payload.embeddings;
  };
}

export async function generateRagAnswer(query: string, evidence: RagEvidence[], signal?: AbortSignal, config = ragConfig()) {
  if (config.chatProvider === "deepseek") return generateDeepseekAnswer(query, evidence, signal, config);
  const payload = await ollamaJson("/api/chat", {
    model: config.chatModel,
    stream: false,
    think: false,
    keep_alive: process.env.AGENT_SNAPSHOTS_RAG_KEEP_ALIVE || 0,
    format: { type: "object", properties: { insufficient: { type: "boolean" }, reason: { type: "string" }, claims: { type: "array", items: { type: "object", properties: { text: { type: "string" }, citations: { type: "array", items: { type: "integer" } } }, required: ["text", "citations"], additionalProperties: false } } }, required: ["insufficient", "reason", "claims"], additionalProperties: false },
    options: { temperature: 0, num_ctx: 8192, num_predict: 1200 },
    messages: [{ role: "system", content: RAG_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify({ evidence, question: query }) }],
  }, config, signal);
  if (payload.done_reason === "length") throw new Error("答案超出生成长度，未展示不完整结论，请缩小提问范围。");
  return { ...validateRagAnswer(String(payload.message?.content || ""), evidence), model: config.chatModel, inputTokens: payload.prompt_eval_count || 0, outputTokens: payload.eval_count || 0 };
}

async function generateDeepseekAnswer(query: string, evidence: RagEvidence[], signal: AbortSignal | undefined, config: Config) {
  const key = deepseekApiKey();
  if (!key) throw new Error("未配置 DeepSeek API Key。");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: config.chatModel, stream: false, thinking: { type: "disabled" }, temperature: 0, max_tokens: 2400,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: RAG_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify({ evidence, question: query }) }],
    }),
    signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]),
  }).catch(() => { signal?.throwIfAborted(); throw new Error("无法连接 DeepSeek 或请求超时，请稍后重试。"); });
  // Never forward provider response bodies, credentials or request headers into UI/logs.
  if (!response.ok) {
    const reason = response.status === 401 ? "API Key 无效" : response.status === 402 ? "账户余额不足" : response.status === 429 ? "请求过于频繁" : "服务请求失败";
    throw new Error(`DeepSeek ${reason}（HTTP ${response.status}）。`);
  }
  const payload = await response.json().catch(() => { throw new Error("DeepSeek 返回了无效响应。"); });
  const choice = payload.choices?.[0];
  if (choice?.finish_reason !== "stop") throw new Error("DeepSeek 未完成答案生成，请缩小提问范围后重试。");
  let answer;
  try { answer = validateRagAnswer(String(choice.message?.content || ""), evidence); }
  catch { throw new Error("DeepSeek 答案格式或引用无效，未展示不完整结论，请重试。"); }
  return { ...answer, model: config.chatModel, provider: "deepseek", inputTokens: payload.usage?.prompt_tokens || 0, cacheHitTokens: payload.usage?.prompt_cache_hit_tokens || 0, outputTokens: payload.usage?.completion_tokens || 0 };
}

export async function ragModelStatus() {
  const config = ragConfig();
  const required = config.chatProvider === "deepseek" ? [config.embeddingModel] : [config.embeddingModel, config.chatModel];
  const keyError = config.chatProvider === "deepseek" && !deepseekApiKey() ? "未配置 DeepSeek API Key" : "";
  try {
    const response = await fetch(`${config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const models = (payload.models || []).map((model: { name: string }) => model.name);
    const missing = required.filter((model) => !models.includes(model));
    return { ...config, available: missing.length === 0 && !keyError, models, missing, error: keyError };
  } catch { return { ...config, available: false, models: [], missing: required, error: [keyError, "Ollama 未运行或无法访问，向量检索暂不可用"].filter(Boolean).join("；") }; }
}

export function createRagService(deps: RagDependencies, overrides: { indexPath?: string; embed?: RagEmbedder; generate?: typeof generateRagAnswer; config?: Config } = {}) {
  let busy = false;
  const config = overrides.config || ragConfig();
  const configKey = `${config.baseUrl}\0${config.embeddingModel}`;
  const embed = overrides.embed || ollamaEmbedder(config);
  async function run(options: RagOptions, emit: (event: RagEvent) => void, signal?: AbortSignal, prewarm = false) {
    if (busy) throw new Error("RAG 正在处理其他请求，请稍后重试。");
    busy = true;
    const start = performance.now();
    let index: Awaited<ReturnType<typeof openRagIndex>> | undefined;
    try {
      index = await openRagIndex(overrides.indexPath);
      emit({ type: "status", message: "正在同步历史会话片段…" });
      const sync = await index.sync(deps, signal, 10, options);
      emit({ type: "index", ...sync, lexicalBackend: index.lexicalBackend });
      signal?.throwIfAborted();
      const syncMs = performance.now() - start;
      let semanticError = "";
      if (options.mode !== "keyword") {
        emit({ type: "status", message: "正在增量计算语义索引…" });
        try { await index.embedPending(options, configKey, embed, signal, prewarm ? 256 : 96); }
        catch (error) { signal?.throwIfAborted(); semanticError = error instanceof Error ? error.message : String(error); }
      }
      const vectors = index.vectorStatus(options, configKey);
      const warnings = [sync.pending ? `还有 ${sync.pending} 个会话未完成索引，本次检索覆盖不完整。` : "", vectors.pending && options.mode !== "keyword" ? `还有 ${vectors.pending} 个片段未生成向量，可继续建立索引；关键词检索仍可用。` : "", semanticError ? `语义检索暂不可用，已降级到关键词检索：${semanticError}` : ""].filter(Boolean);
      if (prewarm) {
        const result = { sync, vectors, warnings, complete: sync.pending === 0 && vectors.pending === 0 && !semanticError };
        emit({ type: "complete", ...result });
        return result;
      }
      emit({ type: "status", message: "正在检索证据并补齐上下文…" });
      const keyword = options.mode === "vector" ? [] : index.keyword(options.query, options);
      let vector: ReturnType<typeof index.vector> = [];
      if (options.mode !== "keyword" && !semanticError && vectors.ready) {
        try {
          const [query] = await embed([options.query], signal);
          vector = index.vector(query, options, configKey).filter((hit) => hit.score >= 0.3);
        } catch (error) { signal?.throwIfAborted(); warnings.push(`向量查询失败：${error instanceof Error ? error.message : String(error)}`); }
      }
      const hits = selectRagEvidenceHits(fuseRagRanks([keyword, vector]), keyword, vector);
      const evidenceBudget = ragEvidenceBudget(options.query);
      if (evidenceBudget < 500) throw new Error("问题过长，无法为历史证据保留上下文，请缩短问题。");
      const evidence = packRagEvidence(hits, (hit) => index!.parents(hit), { expand: options.expand !== false, budget: evidenceBudget });
      const retrievalMs = performance.now() - start - syncMs;
      emit({ type: "evidence", evidence, warnings, sync, vectors });
      if (!evidence.length) {
        const result = { insufficient: true, reason: "没有检索到足以回答问题的历史记录。可以换一种说法，或先完成索引。", claims: [], evidence, warnings, metrics: { syncMs, retrievalMs, generationMs: 0, totalMs: performance.now() - start, keywordHits: keyword.length, vectorHits: vector.length } };
        emit({ type: "answer", ...result });
        return result;
      }
      emit({ type: "status", message: "正在依据原文生成答案并校验引用…" });
      const genStart = performance.now();
      const answer = await (overrides.generate || generateRagAnswer)(options.query, evidence, signal, config);
      const result = { ...answer, evidence, warnings, metrics: { syncMs, retrievalMs, generationMs: performance.now() - genStart, totalMs: performance.now() - start, keywordHits: keyword.length, vectorHits: vector.length, evidenceCount: evidence.length } };
      emit({ type: "answer", ...result });
      return result;
    } finally { index?.close(); busy = false; }
  }
  return { run, isBusy: () => busy };
}
