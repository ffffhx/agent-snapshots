import { DatabaseSync } from "node:sqlite";
import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRagDocument, hash, ragTerms, sessionKey, type RagSession, type RagHit, type RagParent } from "./rag-core.mjs";
import type { SnapshotLike } from "./semantic-search.mjs";

export type RagDependencies = {
  listSessions: (options: Record<string, unknown>) => Promise<RagSession[]>;
  loadSnapshot: (ref: string, options: Record<string, unknown>) => Promise<SnapshotLike>;
  codexHome?: string;
  claudeHome?: string;
};
export type RagScope = { cwd?: string; source?: string };
export type RagEmbedder = (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
type Row = Record<string, any>;

export function defaultRagIndexPath() {
  return process.env.AGENT_SNAPSHOTS_RAG_INDEX || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "agent-snapshots", "rag-index.v1.db");
}

export class RagIndex {
  private db: DatabaseSync;
  readonly lexicalBackend: "fts5" | "bm25-scan";
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, summary TEXT NOT NULL, cwd TEXT NOT NULL, source TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS parents (id TEXT PRIMARY KEY, session_key TEXT REFERENCES sessions(key) ON DELETE CASCADE, ordinal INTEGER, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, session_key TEXT REFERENCES sessions(key) ON DELETE CASCADE, parent_id TEXT REFERENCES parents(id) ON DELETE CASCADE, tokens TEXT NOT NULL, hash TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chunks_session ON chunks(session_key);
      CREATE INDEX IF NOT EXISTS parents_session ON parents(session_key, ordinal);
      CREATE TABLE IF NOT EXISTS vectors (hash TEXT NOT NULL, config TEXT NOT NULL, vector TEXT NOT NULL, PRIMARY KEY(hash, config));
      CREATE TABLE IF NOT EXISTS rag_meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT OR IGNORE INTO rag_meta VALUES('fts_dirty','1');`);
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(tokens, content='chunks', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunk_fts(chunk_fts, rowid, tokens) VALUES('delete', old.rowid, old.tokens);
      END;`);
      // A DB built by a runtime without FTS may later be opened in Electron.
      if ((this.db.prepare("SELECT value FROM rag_meta WHERE key='fts_dirty'").get() as Row).value === "1") {
        this.db.exec("INSERT INTO chunk_fts(chunk_fts) VALUES('rebuild'); UPDATE rag_meta SET value='0' WHERE key='fts_dirty'");
      }
      this.lexicalBackend = "fts5";
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("no such module: fts5")) throw error;
      this.db.exec("DROP TRIGGER IF EXISTS chunks_ad");
      this.db.exec("UPDATE rag_meta SET value='1' WHERE key='fts_dirty'");
      this.lexicalBackend = "bm25-scan";
    }
  }
  close() { this.db.close(); }

  async sync(deps: RagDependencies, signal?: AbortSignal, updateLimit = 30, scope: RagScope = {}) {
    // Enumerate all summaries before deleting anything: a limited/project query
    // must never erase other projects. Failed enumeration leaves the DB untouched.
    const listed = await deps.listSessions({ codexHome: deps.codexHome, claudeHome: deps.claudeHome, source: "all", includeArchived: true, completeOnly: false, limit: Number.POSITIVE_INFINITY });
    const sessions = await Promise.all(listed.map(async (session) => {
      if (!session.filePath) return session;
      const info = await stat(session.filePath).catch(() => null);
      return { ...session, fileMtimeMs: info?.mtimeMs ?? -1, size: info?.size ?? -1 };
    }));
    signal?.throwIfAborted();
    const known = new Map<string, Row>((this.db.prepare("SELECT key, fingerprint FROM sessions").all() as Row[]).map((r) => [r.key, r]));
    const current = new Set(sessions.map(sessionKey));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("UPDATE sessions SET active=0");
      for (const key of known.keys()) if (!current.has(key)) this.db.prepare("DELETE FROM sessions WHERE key=?").run(key);
      for (const session of sessions) {
        const key = sessionKey(session);
        if (known.get(key)?.fingerprint === fingerprint(session)) this.db.prepare("UPDATE sessions SET active=1 WHERE key=?").run(key);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    let updated = 0, failed = 0, attempted = 0;
    const priority = (s: RagSession) => (!scope.cwd || s.cwd === scope.cwd) && (!scope.source || scope.source === "all" || s.engine === scope.source) ? 0 : 1;
    for (const session of [...sessions].sort((a, b) => priority(a) - priority(b))) {
      signal?.throwIfAborted();
      const key = sessionKey(session);
      if (known.get(key)?.fingerprint === fingerprint(session)) continue;
      if (attempted >= updateLimit) continue;
      attempted++;
      try {
        const snapshot = await deps.loadSnapshot(session.ref, { codexHome: deps.codexHome, claudeHome: deps.claudeHome, includeTools: true, includeToolOutput: true, redact: true });
        signal?.throwIfAborted();
        const doc = buildRagDocument(snapshot, key);
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("DELETE FROM sessions WHERE key=?").run(key);
          this.db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,1)").run(key, fingerprint(session), JSON.stringify(session), session.cwd || "", session.engine || "codex");
          doc.parents.forEach((parent, ordinal) => this.db.prepare("INSERT INTO parents VALUES(?,?,?,?)").run(parent.id, key, ordinal, JSON.stringify(parent)));
          for (const chunk of doc.chunks) {
            const tokens = ragTerms(chunk.text, false).join(" ");
            const row = this.db.prepare("INSERT INTO chunks VALUES(?,?,?,?,?,?)").run(chunk.id, key, chunk.parentId, tokens, chunk.hash, JSON.stringify(chunk));
            if (this.lexicalBackend === "fts5") this.db.prepare("INSERT INTO chunk_fts(rowid,tokens) VALUES(?,?)").run(row.lastInsertRowid, tokens);
          }
          this.db.exec("COMMIT");
        } catch (error) { this.db.exec("ROLLBACK"); throw error; }
        updated++;
      } catch (error) { signal?.throwIfAborted(); failed++; }
    }
    this.db.prepare("DELETE FROM vectors WHERE hash NOT IN (SELECT hash FROM chunks)").run();
    const indexed = Number((this.db.prepare("SELECT count(*) AS n FROM sessions WHERE active=1").get() as Row).n);
    return { scanned: sessions.length, indexed, updated, failed, pending: sessions.length - indexed, chunks: Number((this.db.prepare("SELECT count(*) AS n FROM chunks c JOIN sessions s ON s.key=c.session_key WHERE s.active=1").get() as Row).n) };
  }

  keyword(query: string, scope: RagScope = {}, limit = 40): RagHit[] {
    const rawTerms = ragTerms(query);
    // ICU can split 银行卡 into 银行 + 卡. In a longer query the isolated
    // character must not retrieve 卡顿 and supply unrelated debugging evidence.
    // Explicit one-character searches still work when no longer terms exist.
    const meaningful = rawTerms.filter((term) => !/^\p{Script=Han}$/u.test(term));
    const terms = (meaningful.length ? meaningful : rawTerms).slice(0, 32);
    if (!terms.length) return [];
    const { where, params } = scopeSql(scope);
    if (this.lexicalBackend === "bm25-scan") {
      const docs = (this.db.prepare(`SELECT c.tokens,c.data,s.summary FROM chunks c JOIN sessions s ON s.key=c.session_key WHERE ${where}`).all(...params) as Row[]).map((row) => ({ row, tokens: row.tokens.split(" ") as string[] }));
      const average = docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / Math.max(1, docs.length);
      const dfs = terms.map((term) => docs.filter((doc) => doc.tokens.includes(term)).length);
      return docs.map(({ row, tokens }) => {
        const score = terms.reduce((sum, term, i) => {
          const tf = tokens.filter((token) => token === term).length;
          const idf = Math.log(1 + (docs.length - dfs[i] + 0.5) / (dfs[i] + 0.5));
          return sum + idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * tokens.length / Math.max(1, average)));
        }, 0);
        return { ...JSON.parse(row.data), session: JSON.parse(row.summary), score } as RagHit;
      }).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
    }
    const rows = this.db.prepare(`SELECT c.data,s.summary,bm25(chunk_fts) AS rank FROM chunk_fts JOIN chunks c ON c.rowid=chunk_fts.rowid JOIN sessions s ON s.key=c.session_key WHERE chunk_fts MATCH ? AND ${where} ORDER BY rank LIMIT ?`).all(terms.map((term) => '"' + term.replace(/"/g, '""') + '"').join(" OR "), ...params, limit) as Row[];
    return rows.map((row) => ({ ...JSON.parse(row.data), session: JSON.parse(row.summary), score: -row.rank }));
  }

  async embedPending(scope: RagScope, config: string, embed: RagEmbedder, signal?: AbortSignal, limit = 96) {
    const { where, params } = scopeSql(scope);
    const rows = this.db.prepare(`SELECT c.hash, min(c.data) AS data FROM chunks c JOIN sessions s ON s.key=c.session_key LEFT JOIN vectors v ON v.hash=c.hash AND v.config=? WHERE ${where} AND v.hash IS NULL GROUP BY c.hash ORDER BY c.rowid LIMIT ?`).all(config, ...params, limit) as Row[];
    let embedded = 0;
    for (let start = 0; start < rows.length; start += 16) {
      signal?.throwIfAborted();
      const batch = rows.slice(start, start + 16);
      const vectors = await embed(batch.map((row) => JSON.parse(row.data).text), signal);
      validateVectors(vectors, batch.length);
      for (const [i, row] of batch.entries()) this.db.prepare("INSERT OR REPLACE INTO vectors VALUES(?,?,?)").run(row.hash, config, JSON.stringify(normalize(vectors[i])));
      embedded += batch.length;
    }
    return { embedded, ...this.vectorStatus(scope, config) };
  }

  vectorStatus(scope: RagScope, config: string) {
    const { where, params } = scopeSql(scope);
    const row = this.db.prepare(`SELECT count(*) AS total, count(v.hash) AS ready FROM chunks c JOIN sessions s ON s.key=c.session_key LEFT JOIN vectors v ON v.hash=c.hash AND v.config=? WHERE ${where}`).get(config, ...params) as Row;
    return { total: Number(row.total), ready: Number(row.ready), pending: Number(row.total) - Number(row.ready) };
  }

  vector(query: number[], scope: RagScope, config: string, limit = 40): RagHit[] {
    validateVectors([query], 1);
    const unit = normalize(query);
    const { where, params } = scopeSql(scope);
    const hits: RagHit[] = [];
    // Exact cosine scan is intentionally a baseline for a personal corpus;
    // bounded top-K memory, no unmeasured ANN infrastructure claim.
    const statement = this.db.prepare(`SELECT c.rowid AS cursor,c.data,s.summary,v.vector FROM chunks c JOIN sessions s ON s.key=c.session_key JOIN vectors v ON v.hash=c.hash AND v.config=? WHERE ${where} AND c.rowid>? ORDER BY c.rowid LIMIT 128`);
    let cursor = 0;
    while (true) {
      // Paged all() also avoids early node:sqlite iterate() text-lifetime bugs.
      const rows = statement.all(config, ...params, cursor) as Row[];
      if (!rows.length) break;
      for (const row of rows) {
        cursor = Number(row.cursor);
        const vector = JSON.parse(row.vector) as number[];
        if (vector.length !== unit.length) throw new Error("向量维度变化，请更换索引配置或重新建立 RAG 索引。");
        const score = unit.reduce((sum, value, i) => sum + value * vector[i], 0);
        hits.push({ ...JSON.parse(row.data), session: JSON.parse(row.summary), score });
        hits.sort((a, b) => b.score - a.score);
        if (hits.length > limit) hits.pop();
      }
    }
    return hits;
  }

  parents(hit: RagHit): RagParent[] {
    const row = this.db.prepare("SELECT ordinal, session_key FROM parents WHERE id=?").get(hit.parentId) as Row | undefined;
    if (!row) return [];
    return (this.db.prepare("SELECT data FROM parents WHERE session_key=? AND ordinal BETWEEN ? AND ? ORDER BY ordinal").all(row.session_key, row.ordinal, row.ordinal + 1) as Row[])
      .map((r) => JSON.parse(r.data) as RagParent).filter((p) => p.source === hit.source);
  }
}

export async function openRagIndex(file = defaultRagIndexPath()) {
  await mkdir(path.dirname(file), { recursive: true });
  return new RagIndex(file);
}

function fingerprint(session: RagSession) { return hash(JSON.stringify(["turn-chunks-v2", session.ref, session.codexHomeKey, session.mtime, session.title, session.cwd, session.filePath, session.fileMtimeMs, session.size])); }
function scopeSql(scope: RagScope) {
  let where = "s.active=1";
  const params: string[] = [];
  if (scope.cwd) { where += " AND s.cwd=?"; params.push(scope.cwd); }
  if (scope.source && scope.source !== "all") { where += " AND s.source=?"; params.push(scope.source); }
  return { where, params };
}
export function validateVectors(vectors: number[][], count: number) {
  if (!Array.isArray(vectors) || vectors.length !== count || vectors.some((v) => !Array.isArray(v) || !v.length || v.some((n) => !Number.isFinite(n)) || !v.some((n) => n !== 0) || v.length !== vectors[0].length)) throw new Error("Embedding 服务返回了无效向量。");
}
function normalize(vector: number[]) { const length = Math.hypot(...vector); return vector.map((v) => v / length); }
