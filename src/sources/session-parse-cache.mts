// @ts-nocheck
import { stat } from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";

// Consumer-owned, in-memory cache. The core parser stays synchronous/stateless
// across calls. Always stat on access: correctness does not depend on fs.watch.
export class SessionParseCache {
  constructor({ maxEntries = 64, maxBytes = 32 * 1024 * 1024, idleMs = 30000 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.idleMs = idleMs;
    this.cache = new Map();
    this.inflight = new Map();
    this.jobs = new Map();
    this.bytes = 0;
    this.sequence = 0;
    this.closed = false;
    this.counters = { parses: 0, hits: 0, coalesced: 0, evictions: 0, retries: 0 };
  }

  stats() { return { ...this.counters, entries: this.cache.size, bytes: this.bytes, pending: this.inflight.size }; }

  async load(file, { maxLines = 0 } = {}) {
    if (this.closed) throw new Error("Session parser cache is closed");
    const resolved = { ...file, path: path.resolve(file.path) };
    const key = JSON.stringify([resolved.path, resolved.engine || "", maxLines]);
    // One pipeline per file/mode, including stat and post-parse validation.
    let pending = this.inflight.get(key);
    if (pending) this.counters.coalesced++;
    else {
      pending = this.readStable(key, resolved, maxLines);
      this.inflight.set(key, pending);
      void pending.finally(() => this.inflight.delete(key)).catch(() => {});
    }
    const session = await pending;
    // Downstream redaction/directive stripping must never mutate cached raw data
    // or another concurrent caller's result.
    return session ? structuredClone(session) : null;
  }

  async readStable(key, file, maxLines) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.closed) throw new Error("Session parser cache is closed");
      const before = await stat(file.path).catch((error) => {
        if (error.code === "ENOENT") { this.remove(key); return null; }
        throw error;
      });
      if (!before?.isFile()) { this.remove(key); return null; }
      const fingerprint = stamp(before);
      const cached = this.cache.get(key);
      if (cached?.fingerprint === fingerprint) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        this.counters.hits++;
        return cached.session;
      }
      this.remove(key);
      const result = await this.parse({ ...file, mtimeMs: before.mtimeMs, sizeBytes: before.size }, maxLines);
      const after = await stat(file.path).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!after) return null;
      if (stamp(after) !== fingerprint) { this.counters.retries++; continue; }
      if (!this.closed && result.session && result.bytes <= this.maxBytes && this.maxEntries > 0) {
        this.cache.set(key, { ...result, fingerprint });
        this.bytes += result.bytes;
        while (this.cache.size > this.maxEntries || this.bytes > this.maxBytes) {
          this.remove(this.cache.keys().next().value);
          this.counters.evictions++;
        }
      }
      return result.session;
    }
    // Never publish a mixed read as a fresh stable cache entry. The next request
    // can retry after the writer has settled; no synchronous fallback on HTTP.
    throw new Error("Session log is changing continuously; retry shortly");
  }

  remove(key) {
    const old = this.cache.get(key);
    if (old) { this.bytes -= old.bytes; this.cache.delete(key); }
  }

  parse(file, maxLines) {
    if (this.closed) return Promise.reject(new Error("Session parser cache is closed"));
    if (this.jobs.size >= 128) return Promise.reject(new Error("Session parser queue is full; retry shortly"));
    clearTimeout(this.idleTimer);
    if (!this.worker) {
      const worker = new Worker(new URL("./session-parse-worker.mjs", import.meta.url));
      this.worker = worker;
      worker.on("message", (message) => {
        const job = this.jobs.get(message.id);
        if (!job) return;
        this.jobs.delete(message.id);
        message.error ? job.reject(new Error(message.error)) : job.resolve(message);
        if (!this.jobs.size) {
          worker.unref();
          this.idleTimer = setTimeout(() => {
            if (this.worker === worker) { this.worker = null; void worker.terminate(); }
          }, this.idleMs);
          this.idleTimer.unref();
        }
      });
      const fail = (error) => {
        if (this.worker !== worker) return;
        this.worker = null;
        clearTimeout(this.idleTimer);
        for (const job of this.jobs.values()) job.reject(error);
        this.jobs.clear();
        void worker.terminate();
      };
      worker.on("error", fail);
      worker.on("exit", (code) => fail(new Error(`Session parser worker exited (${code})`)));
    }
    this.worker.ref();
    const id = ++this.sequence;
    this.counters.parses++;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ id, file, maxLines });
    });
  }

  async close() {
    this.closed = true;
    clearTimeout(this.idleTimer);
    const worker = this.worker;
    this.worker = null;
    for (const job of this.jobs.values()) job.reject(new Error("Session parser cache is closed"));
    this.jobs.clear();
    this.cache.clear();
    this.bytes = 0;
    await worker?.terminate();
    await Promise.allSettled([...this.inflight.values()]);
  }
}

function stamp(info) {
  return JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
}

let shared;
export function loadCachedSession(file, options) {
  shared ??= new SessionParseCache();
  return shared.load(file, options);
}
export async function closeSessionParseCache() {
  const old = shared;
  shared = null;
  await old?.close();
}
