import { createHash } from "node:crypto";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_EMBEDDING_MODEL = "qwen3-embedding:0.6b";
const DEFAULT_RESULT_LIMIT = 8;
const MAX_RESULT_LIMIT = 24;
const MAX_SEARCH_CHUNKS = 140;
const MAX_CHUNK_CHARS = 1800;
const CHUNK_OVERLAP_CHARS = 180;
const EMBED_BATCH_SIZE = 32;
const EMBED_TIMEOUT_MS = 120000;
const DOCUMENT_CACHE_LIMIT = 12;

const documentEmbeddingCache = new Map<string, CachedDocumentEmbeddings>();

export type SnapshotLike = {
  id?: string;
  ref?: string;
  title?: string;
  engineLabel?: string;
  redacted?: boolean;
  turns?: SnapshotTurnLike[];
  subagents?: Array<{
    label?: string;
    turns?: SnapshotTurnLike[];
  }>;
};

type SnapshotTurnLike = {
  kind?: string;
  role?: string;
  name?: string;
  turn?: number;
  text?: string;
  timestamp?: string;
};

export type SearchChunk = {
  id: string;
  turn: number;
  role: string;
  label: string;
  text: string;
  snippet: string;
  timestamp: string;
  sourceLabel: string;
};

type CachedDocumentEmbeddings = {
  chunks: SearchChunk[];
  embeddings: number[][];
};

export async function semanticSearchSnapshot(
  snapshot: SnapshotLike,
  {
    query,
    limit = DEFAULT_RESULT_LIMIT,
    model = defaultEmbeddingModel(),
    baseUrl = defaultOllamaBaseUrl(),
  }: {
    query: string;
    limit?: number;
    model?: string;
    baseUrl?: string;
  },
) {
  const cleanQuery = String(query || "").trim();
  const resultLimit = clampInteger(limit, 1, MAX_RESULT_LIMIT, DEFAULT_RESULT_LIMIT);
  const embeddingModel = String(model || DEFAULT_EMBEDDING_MODEL).trim() || DEFAULT_EMBEDDING_MODEL;
  const ollamaBaseUrl = normalizeOllamaBaseUrl(baseUrl);

  if (!cleanQuery) {
    return {
      query: cleanQuery,
      model: embeddingModel,
      provider: "ollama",
      baseUrl: ollamaBaseUrl,
      chunkCount: 0,
      results: [],
    };
  }

  const chunks = buildSearchChunks(snapshot);
  if (!chunks.length) {
    return {
      query: cleanQuery,
      model: embeddingModel,
      provider: "ollama",
      baseUrl: ollamaBaseUrl,
      chunkCount: 0,
      results: [],
    };
  }

  const cacheKey = documentCacheKey(snapshot, chunks, embeddingModel, ollamaBaseUrl);
  const cached = await getDocumentEmbeddings(cacheKey, chunks, { model: embeddingModel, baseUrl: ollamaBaseUrl });
  const [queryEmbedding] = await embedTexts([cleanQuery], { model: embeddingModel, baseUrl: ollamaBaseUrl });

  const scored = cached.chunks
    .map((chunk, index) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, cached.embeddings[index] || []),
    }))
    .sort((a, b) => b.score - a.score);

  const seenTurns = new Set<string>();
  const results = [];
  for (const item of scored) {
    const key = `${item.sourceLabel}:${item.turn}:${item.role}`;
    if (seenTurns.has(key)) {
      continue;
    }
    seenTurns.add(key);
    results.push(item);
    if (results.length >= resultLimit) {
      break;
    }
  }

  return {
    query: cleanQuery,
    model: embeddingModel,
    provider: "ollama",
    baseUrl: ollamaBaseUrl,
    chunkCount: chunks.length,
    results,
  };
}

export function defaultEmbeddingModel() {
  return String(process.env.SNAPSHOT_EMBEDDING_MODEL || process.env.CODEX_SNAPSHOTS_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim();
}

export function defaultOllamaBaseUrl() {
  return String(process.env.SNAPSHOT_OLLAMA_URL || process.env.CODEX_SNAPSHOTS_OLLAMA_URL || process.env.OLLAMA_HOST || DEFAULT_OLLAMA_BASE_URL).trim();
}

export function normalizeOllamaBaseUrl(value: string) {
  const clean = String(value || DEFAULT_OLLAMA_BASE_URL).trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(clean) ? clean : `http://${clean}`;
}

export function buildSearchChunks(snapshot: SnapshotLike, { maxChunks = MAX_SEARCH_CHUNKS }: { maxChunks?: number } = {}): SearchChunk[] {
  const chunks: SearchChunk[] = [];
  const chunkLimit = clampInteger(maxChunks, 1, MAX_SEARCH_CHUNKS, MAX_SEARCH_CHUNKS);
  pushTurnChunks(chunks, snapshot.turns || [], "Session", chunkLimit);
  for (const subagent of snapshot.subagents || []) {
    pushTurnChunks(chunks, subagent.turns || [], subagent.label ? `Subagent / ${subagent.label}` : "Subagent", chunkLimit);
  }
  return chunks.slice(0, chunkLimit);
}

function pushTurnChunks(chunks: SearchChunk[], turns: SnapshotTurnLike[], sourceLabel: string, maxChunks: number) {
  for (const [index, turn] of turns.entries()) {
    if (chunks.length >= maxChunks) {
      return;
    }
    const text = turnSearchText(turn);
    if (!text) {
      continue;
    }
    const turnNumber = positiveTurnNumber(turn.turn) || index + 1;
    const role = turnRole(turn);
    const label = turnLabel(turn, role);
    const parts = splitForEmbedding(text);
    for (const [partIndex, part] of parts.entries()) {
      if (chunks.length >= maxChunks) {
        return;
      }
      chunks.push({
        id: `${sourceLabel}:${turnNumber}:${role}:${partIndex}`,
        turn: turnNumber,
        role,
        label,
        text: part,
        snippet: snippetText(part),
        timestamp: String(turn.timestamp || ""),
        sourceLabel,
      });
    }
  }
}

function turnSearchText(turn: SnapshotTurnLike) {
  const text = String(turn.text || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (turn.kind === "tool") {
    return [turn.name ? `Tool ${turn.name}` : "Tool", text].join(" ").trim();
  }
  return text;
}

function splitForEmbedding(text: string) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return [];
  }
  if (clean.length <= MAX_CHUNK_CHARS) {
    return [clean];
  }
  const chunks = [];
  let cursor = 0;
  while (cursor < clean.length) {
    const hardEnd = Math.min(clean.length, cursor + MAX_CHUNK_CHARS);
    let end = hardEnd;
    const softBreak = clean.lastIndexOf("。", hardEnd);
    if (softBreak > cursor + Math.floor(MAX_CHUNK_CHARS * 0.55)) {
      end = softBreak + 1;
    }
    chunks.push(clean.slice(cursor, end).trim());
    if (end >= clean.length) {
      break;
    }
    cursor = Math.max(end - CHUNK_OVERLAP_CHARS, cursor + 1);
  }
  return chunks.filter(Boolean);
}

function snippetText(text: string) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > 360 ? `${clean.slice(0, 360)}...` : clean;
}

function positiveTurnNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function turnRole(turn: SnapshotTurnLike) {
  if (turn.kind === "tool") {
    return "tool";
  }
  return turn.role === "user" ? "user" : turn.role === "assistant" ? "assistant" : "message";
}

function turnLabel(turn: SnapshotTurnLike, role: string) {
  if (role === "tool") {
    return turn.name ? `Tool / ${turn.name}` : "Tool";
  }
  if (role === "user") {
    return "User";
  }
  if (role === "assistant") {
    return "Assistant";
  }
  return "Message";
}

function documentCacheKey(snapshot: SnapshotLike, chunks: SearchChunk[], model: string, baseUrl: string) {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(chunks.map((chunk) => [chunk.id, chunk.text])))
    .digest("hex");
  return [
    "v1",
    baseUrl,
    model,
    snapshot.ref || snapshot.id || "",
    snapshot.redacted ? "redacted" : "raw",
    fingerprint,
  ].join("\0");
}

async function getDocumentEmbeddings(
  cacheKey: string,
  chunks: SearchChunk[],
  options: { model: string; baseUrl: string },
): Promise<CachedDocumentEmbeddings> {
  const cached = documentEmbeddingCache.get(cacheKey);
  if (cached) {
    documentEmbeddingCache.delete(cacheKey);
    documentEmbeddingCache.set(cacheKey, cached);
    return cached;
  }

  const embeddings = [];
  for (let index = 0; index < chunks.length; index += EMBED_BATCH_SIZE) {
    embeddings.push(...await embedTexts(chunks.slice(index, index + EMBED_BATCH_SIZE).map((chunk) => chunk.text), options));
  }

  const value = { chunks, embeddings };
  documentEmbeddingCache.set(cacheKey, value);
  while (documentEmbeddingCache.size > DOCUMENT_CACHE_LIMIT) {
    const oldest = documentEmbeddingCache.keys().next().value;
    if (!oldest) {
      break;
    }
    documentEmbeddingCache.delete(oldest);
  }
  return value;
}

export async function embedTexts(texts: string[], { model, baseUrl }: { model: string; baseUrl: string }) {
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  }).catch((error) => {
    throw new Error(`Ollama embedding service is not available at ${baseUrl}: ${messageFromError(error)}`);
  });

  const text = await response.text();
  let payload: { embeddings?: unknown; error?: string } = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Ollama embedding response was not JSON: ${text.slice(0, 240)}`);
  }

  if (!response.ok) {
    throw new Error(payload.error || `Ollama embedding request failed: HTTP ${response.status}`);
  }

  if (!Array.isArray(payload.embeddings)) {
    throw new Error("Ollama embedding response did not include embeddings.");
  }

  return payload.embeddings.map((embedding, index) => {
    if (!Array.isArray(embedding)) {
      throw new Error(`Ollama embedding ${index + 1} was not a vector.`);
    }
    return normalizeVector(embedding.map(Number));
  });
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
  if (!magnitude) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

export function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
