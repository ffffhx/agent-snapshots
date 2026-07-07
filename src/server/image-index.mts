// @ts-nocheck

import path from "node:path";
import os from "node:os";
import { mkdir, stat } from "node:fs/promises";

const MAX_SCAN_SESSIONS = 300;
const DEFAULT_IMAGE_LIMIT = 36;
const MAX_IMAGE_LIMIT = 120;
const MAX_IMAGE_REF_CHARS = 8192;
const IMAGE_HEADER_BYTES = 64 * 1024;
const IMAGE_INDEX_TABLE = "image_index_v1";
const PAGE_CACHE_MS = 15_000;
const INLINE_IMAGE_RE = /^data:(image\/(?:png|jpe?g|gif|webp));base64,([\s\S]+)$/i;

const sessionImageCache = new Map();
const imagePageCache = new Map();
let dbPromise = null;
let staleSweepPromise = null;
let lastStaleSweepAt = 0;

export function imageIndexPath() {
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(cacheHome, "agent-snapshots", "search-index.v2.db");
}

async function getDb() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = (async () => {
    const dbFile = imageIndexPath();
    await mkdir(path.dirname(dbFile), { recursive: true });
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbFile);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(`CREATE TABLE IF NOT EXISTS ${IMAGE_INDEX_TABLE} (
      cache_key TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      mtime TEXT NOT NULL,
      mtime_ms REAL DEFAULT 0,
      size INTEGER DEFAULT 0,
      ref TEXT DEFAULT '',
      engine TEXT DEFAULT '',
      source TEXT DEFAULT '',
      entries_json TEXT NOT NULL,
      image_count INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS image_index_v1_file_path ON ${IMAGE_INDEX_TABLE}(file_path)`);
    db.exec(`CREATE INDEX IF NOT EXISTS image_index_v1_updated_at ON ${IMAGE_INDEX_TABLE}(updated_at)`);
    return db;
  })();
  return dbPromise;
}

export async function listImageEntries({
  codexHome,
  claudeHome,
  traeHome,
  traeAppHome,
  traeRecordingsDir,
  listSessions,
  loadSnapshot,
  source = "all",
  limit = DEFAULT_IMAGE_LIMIT,
  offset = 0,
}) {
  const pageLimit = clampPositive(limit, DEFAULT_IMAGE_LIMIT, MAX_IMAGE_LIMIT);
  const pageOffset = Math.max(0, Number(offset) || 0);
  const targetCount = pageOffset + pageLimit;
  const imageSource = normalizeSource(source);
  const pageCacheKey = imagePageCacheKey({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, source: imageSource, limit: pageLimit, offset: pageOffset });
  const cachedPage = imagePageCache.get(pageCacheKey);
  if (cachedPage && Date.now() - cachedPage.time < PAGE_CACHE_MS) {
    return cachedPage.result;
  }
  const sessions = await listSessions({
    codexHome,
    claudeHome,
    traeHome,
    traeAppHome,
    traeRecordingsDir,
    limit: MAX_SCAN_SESSIONS,
    cwd: "",
    includeArchived: true,
    source: imageSource,
    completeOnly: false,
  });

  const entries = [];
  let scanned = 0;
  let failed = 0;
  sweepMissingImageRowsInBackground();
  for (const session of sessions.slice(0, MAX_SCAN_SESSIONS)) {
    scanned += 1;
    try {
      const sessionResult = await readSessionImages(session, {
        codexHome,
        claudeHome,
        traeHome,
        traeAppHome,
        traeRecordingsDir,
        loadSnapshot,
      });
      entries.push(...sessionResult.entries);
      if (entries.length >= targetCount) {
        break;
      }
      if (!sessionResult.cached || scanned % 25 === 0) {
        await yieldToEventLoop();
      }
    } catch {
      failed += 1;
    }
  }

  const page = entries.slice(pageOffset, pageOffset + pageLimit).map(publicImageEntry);
  const result = {
    entries: page,
    limit: pageLimit,
    offset: pageOffset,
    scanned,
    failed,
    scanLimit: MAX_SCAN_SESSIONS,
    hasMore: entries.length > pageOffset + pageLimit || scanned < Math.min(sessions.length, MAX_SCAN_SESSIONS),
  };
  imagePageCache.set(pageCacheKey, { time: Date.now(), result });
  return result;
}

export async function readImageBytes({
  ref,
  codexHome,
  claudeHome,
  traeHome,
  traeAppHome,
  traeRecordingsDir,
  loadSnapshot,
}) {
  const target = decodeImageId(ref);
  if (!target) {
    return null;
  }
  let snapshot;
  try {
    snapshot = await loadSnapshot(target.sessionRef, {
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      includeTools: false,
      includeToolOutput: false,
      redact: false,
    });
  } catch {
    return null;
  }
  const turn = Array.isArray(snapshot?.turns) ? snapshot.turns[target.turnIndex] : null;
  const image = Array.isArray(turn?.images) ? turn.images[target.imageIndex] : null;
  const parsed = parseInlineImageSrc(image?.src);
  if (!parsed) {
    return null;
  }
  return parsed;
}

async function readSessionImages(session, options) {
  const ref = sessionRef(session);
  const fingerprint = sessionFingerprint(session);
  const cached = sessionImageCache.get(ref);
  if (cached?.fingerprint === fingerprint) {
    return { entries: cached.entries, cached: true };
  }

  const persisted = await readPersistedSessionImages(session);
  if (persisted) {
    sessionImageCache.set(ref, { fingerprint, entries: persisted });
    return { entries: persisted, cached: true };
  }

  const snapshot = await options.loadSnapshot(ref, {
    codexHome: options.codexHome,
    claudeHome: options.claudeHome,
    traeHome: options.traeHome,
    traeAppHome: options.traeAppHome,
    traeRecordingsDir: options.traeRecordingsDir,
    includeTools: false,
    includeToolOutput: false,
    redact: false,
  });
  const entries = extractSnapshotImages(snapshot, session, ref);
  sessionImageCache.set(ref, { fingerprint, entries });
  await writePersistedSessionImages(session, entries);
  return { entries, cached: false };
}

function extractSnapshotImages(snapshot, session, ref) {
  const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];
  const title = String(session?.title || snapshot?.title || ref);
  const project = String(session?.displayCwd || session?.cwd || snapshot?.displayCwd || snapshot?.cwd || "");
  const engine = normalizeSource(snapshot?.engine || session?.engine || ref.split(":")[0]);
  const engineLabel = String(snapshot?.engineLabel || session?.engineLabel || engineLabelFor(engine));
  const entries = [];

  turns.forEach((turn, turnIndex) => {
    const images = Array.isArray(turn?.images) ? turn.images : [];
    images.forEach((image, imageIndex) => {
      const parsed = parseInlineImageMeta(image?.src);
      if (!parsed) {
        return;
      }
      const turnNumber = positiveNumber(turn?.turn) || turnIndex + 1;
      entries.push({
        id: encodeImageId({ sessionRef: ref, turnIndex, imageIndex }),
        sessionRef: ref,
        sessionTitle: title,
        project,
        engine,
        engineLabel,
        turnIndex,
        turnNumber,
        timestamp: String(turn?.timestamp || snapshot?.mtime || session?.mtime || snapshot?.generatedAt || ""),
        mime: parsed.mime,
        width: parsed.width || 0,
        height: parsed.height || 0,
      });
    });
  });

  return entries;
}

function publicImageEntry(entry) {
  return {
    id: entry.id,
    sessionRef: entry.sessionRef,
    sessionTitle: entry.sessionTitle,
    project: entry.project,
    engine: entry.engine,
    engineLabel: entry.engineLabel,
    turnIndex: entry.turnIndex,
    turnNumber: entry.turnNumber,
    timestamp: entry.timestamp,
    mime: entry.mime,
    width: positiveNumber(entry.width) || undefined,
    height: positiveNumber(entry.height) || undefined,
  };
}

function parseInlineImageSrc(src) {
  return parseInlineImageMeta(src, { includeBytes: true });
}

function parseInlineImageMeta(src, options = {}) {
  const match = String(src || "").match(INLINE_IMAGE_RE);
  if (!match) {
    return null;
  }
  const mime = match[1].toLowerCase();
  const rawBase64 = match[2];
  const headerBytes = decodeBase64Prefix(rawBase64, IMAGE_HEADER_BYTES);
  if (!headerBytes.length) {
    return null;
  }
  const dimensions = imageDimensions(mime, headerBytes) || {};
  if (!options.includeBytes) {
    return { mime, width: dimensions.width || 0, height: dimensions.height || 0 };
  }
  const base64 = rawBase64.replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return null;
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) {
    return null;
  }
  return { mime, bytes, width: dimensions.width || 0, height: dimensions.height || 0 };
}

function decodeBase64Prefix(value, maxBytes) {
  const targetChars = Math.ceil(Math.max(1, maxBytes) / 3) * 4 + 16;
  const prefix = String(value || "")
    .slice(0, targetChars)
    .replace(/\s+/g, "");
  const usableLength = prefix.length - (prefix.length % 4);
  if (usableLength <= 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(prefix.slice(0, usableLength))) {
    return Buffer.alloc(0);
  }
  return Buffer.from(prefix.slice(0, usableLength), "base64");
}

function imageDimensions(mime, bytes) {
  if (mime === "image/png") {
    return pngDimensions(bytes);
  }
  if (mime === "image/jpeg" || mime === "image/jpg") {
    return jpegDimensions(bytes);
  }
  return null;
}

function pngDimensions(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24) {
    return null;
  }
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      return null;
    }
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return validDimensions(width, height);
}

function jpegDimensions(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 4 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) {
      return null;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      continue;
    }
    if (offset + 2 > bytes.length) {
      return null;
    }
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null;
    }
    if (isJpegSofMarker(marker)) {
      if (segmentLength < 7) {
        return null;
      }
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return validDimensions(width, height);
    }
    offset += segmentLength;
  }
  return null;
}

function isJpegSofMarker(marker) {
  return (marker >= 0xc0 && marker <= 0xc3)
    || (marker >= 0xc5 && marker <= 0xc7)
    || (marker >= 0xc9 && marker <= 0xcb)
    || (marker >= 0xcd && marker <= 0xcf);
}

function validDimensions(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return { width: Math.round(w), height: Math.round(h) };
}

function encodeImageId({ sessionRef, turnIndex, imageIndex }) {
  return Buffer.from(JSON.stringify({ v: 1, r: sessionRef, t: turnIndex, i: imageIndex }), "utf8").toString("base64url");
}

function decodeImageId(ref) {
  try {
    const text = String(ref || "");
    if (!text || text.length > MAX_IMAGE_REF_CHARS) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    const sessionRef = String(decoded?.r || "");
    const turnIndex = Number(decoded?.t);
    const imageIndex = Number(decoded?.i);
    if (!sessionRef || decoded?.v !== 1 || !Number.isInteger(turnIndex) || turnIndex < 0 || !Number.isInteger(imageIndex) || imageIndex < 0) {
      return null;
    }
    return { sessionRef, turnIndex, imageIndex };
  } catch {
    return null;
  }
}

function sessionRef(session) {
  const engine = normalizeSource(session?.engine || "codex");
  return String(session?.ref || `${engine}:${session?.id || ""}`);
}

function sessionFingerprint(session) {
  return [
    sessionRef(session),
    sessionFilePath(session),
    sessionMtimeKey(session),
    String(sessionSize(session)),
  ].join("\x1f");
}

function sessionFilePath(session) {
  const filePath = String(session?.filePath || "");
  return filePath ? normalizeFilePath(filePath) : "";
}

function sessionMtimeKey(session) {
  const mtimeMs = Number(session?.mtimeMs || 0);
  if (Number.isFinite(mtimeMs) && mtimeMs > 0) {
    return String(Math.round(mtimeMs));
  }
  return String(session?.mtime || "");
}

function sessionSize(session) {
  const size = Number(session?.size || session?.sizeBytes || 0);
  return Number.isFinite(size) && size > 0 ? Math.round(size) : 0;
}

function persistedCacheKey(session) {
  const filePath = sessionFilePath(session);
  const mtime = sessionMtimeKey(session);
  return filePath && mtime ? `${filePath}\x1f${mtime}` : "";
}

async function readPersistedSessionImages(session) {
  const cacheKey = persistedCacheKey(session);
  if (!cacheKey) {
    return null;
  }
  try {
    const db = await getDb();
    const row = db.prepare(`SELECT entries_json, mtime, size FROM ${IMAGE_INDEX_TABLE} WHERE cache_key = ?`).get(cacheKey);
    if (!row || String(row.mtime || "") !== sessionMtimeKey(session)) {
      return null;
    }
    const expectedSize = sessionSize(session);
    if (expectedSize && Number(row.size || 0) && Number(row.size || 0) !== expectedSize) {
      return null;
    }
    const entries = JSON.parse(row.entries_json || "[]");
    if (!Array.isArray(entries)) {
      return null;
    }
    return materializeCachedEntries(entries, session);
  } catch {
    return null;
  }
}

async function writePersistedSessionImages(session, entries) {
  const cacheKey = persistedCacheKey(session);
  const filePath = sessionFilePath(session);
  if (!cacheKey || !filePath) {
    return;
  }
  try {
    const db = await getDb();
    db.prepare(`INSERT INTO ${IMAGE_INDEX_TABLE}
      (cache_key, file_path, mtime, mtime_ms, size, ref, engine, source, entries_json, image_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        file_path=excluded.file_path,
        mtime=excluded.mtime,
        mtime_ms=excluded.mtime_ms,
        size=excluded.size,
        ref=excluded.ref,
        engine=excluded.engine,
        source=excluded.source,
        entries_json=excluded.entries_json,
        image_count=excluded.image_count,
        updated_at=excluded.updated_at`).run(
      cacheKey,
      filePath,
      sessionMtimeKey(session),
      Number(session?.mtimeMs || new Date(session?.mtime || 0).getTime() || 0),
      sessionSize(session),
      sessionRef(session),
      normalizeSource(session?.engine || "codex"),
      normalizeSource(session?.engine || "codex"),
      JSON.stringify((entries || []).map(cacheableImageEntry)),
      Array.isArray(entries) ? entries.length : 0,
      Date.now(),
    );
  } catch {
    // Persistence is an optimization; the in-process cache still serves this request.
  }
}

function cacheableImageEntry(entry) {
  return {
    turnIndex: Number(entry.turnIndex || 0),
    imageIndex: Number(decodeImageId(entry.id)?.imageIndex ?? entry.imageIndex ?? 0),
    turnNumber: Number(entry.turnNumber || 0),
    timestamp: String(entry.timestamp || ""),
    mime: String(entry.mime || ""),
    width: positiveNumber(entry.width),
    height: positiveNumber(entry.height),
  };
}

function materializeCachedEntries(entries, session) {
  const ref = sessionRef(session);
  const title = String(session?.title || ref);
  const project = String(session?.displayCwd || session?.cwd || "");
  const engine = normalizeSource(session?.engine || ref.split(":")[0]);
  const engineLabel = String(session?.engineLabel || engineLabelFor(engine));
  return entries.map((entry) => {
    const turnIndex = Math.max(0, Number(entry.turnIndex || 0));
    const imageIndex = Math.max(0, Number(entry.imageIndex || 0));
    return {
      id: encodeImageId({ sessionRef: ref, turnIndex, imageIndex }),
      sessionRef: ref,
      sessionTitle: title,
      project,
      engine,
      engineLabel,
      turnIndex,
      imageIndex,
      turnNumber: positiveNumber(entry.turnNumber) || turnIndex + 1,
      timestamp: String(entry.timestamp || session?.mtime || ""),
      mime: String(entry.mime || ""),
      width: positiveNumber(entry.width),
      height: positiveNumber(entry.height),
    };
  }).filter((entry) => entry.mime.startsWith("image/"));
}

function sweepMissingImageRowsInBackground() {
  const now = Date.now();
  if (staleSweepPromise || now - lastStaleSweepAt < 60_000) {
    return;
  }
  lastStaleSweepAt = now;
  staleSweepPromise = sweepMissingImageRows()
    .catch(() => {})
    .finally(() => {
      staleSweepPromise = null;
    });
}

async function sweepMissingImageRows() {
  const db = await getDb();
  const rows = db.prepare(`SELECT DISTINCT file_path FROM ${IMAGE_INDEX_TABLE}`).all();
  if (!rows.length) {
    return;
  }
  const del = db.prepare(`DELETE FROM ${IMAGE_INDEX_TABLE} WHERE file_path = ?`);
  let checked = 0;
  for (const row of rows) {
    const filePath = String(row.file_path || "");
    if (!filePath) {
      continue;
    }
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      del.run(filePath);
    }
    checked += 1;
    if (checked % 100 === 0) {
      await yieldToEventLoop();
    }
  }
}

function normalizeFilePath(value) {
  return path.resolve(String(value || "")).replace(/\\/g, "/");
}

function imagePageCacheKey({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, source, limit, offset }) {
  return [
    normalizeSource(source),
    String(limit),
    String(offset),
    codexHome || "",
    claudeHome || "",
    traeHome || "",
    traeAppHome || "",
    traeRecordingsDir || "",
  ].join("\x1f");
}

function normalizeSource(value) {
  const key = String(value || "all").toLowerCase();
  return key === "claude" || key === "trae" || key === "codex" ? key : "all";
}

function engineLabelFor(engine) {
  if (engine === "claude") return "Claude Code";
  if (engine === "trae") return "Trae";
  return "Codex";
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clampPositive(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(number), max);
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}
