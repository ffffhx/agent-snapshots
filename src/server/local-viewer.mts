// @ts-nocheck

import http from "node:http";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { send, sendJson } from "./http.js";
import { createGitHubGist, isGitHubGistPublishError } from "./gist-publish.mjs";
import { redactText } from "../core/privacy.js";
import {
  allowMutationRequest,
  createMutationCsrfToken,
  isAllowedSnapshotServerRequest,
  setSnapshotServerCorsHeaders,
} from "./local-security.js";
import { renderServerApp } from "./local-viewer-app.mjs";
import { renderLauncherApp } from "./launcher-app.mjs";
import { prewarmSemanticIndex, semanticSearchSessions } from "./semantic-index.mjs";
import { semanticSearchSnapshot } from "./semantic-search.mjs";
import { searchIndexed, syncSearchIndexInBackground, searchIndexStats, indexRowCount } from "./search-index.mjs";
import { listSessionsWithCache, sessionListCacheStatus, reconcileSessionListCacheInBackground } from "./session-list-cache.mjs";
import { resumeSessionInOrca } from "./orca-bridge.mjs";
import { readClaudeBlockUsageEstimate, readCodexQuotaSnapshot } from "./quota-meter.mjs";
import { buildUsageAnalytics } from "./usage-analytics.mjs";
import { buildWeeklyDigest } from "./weekly-digest.mjs";
import { listImageEntries, readImageBytes } from "./image-index.mjs";
import { readLauncherPrefs, recordLauncherAccess, setLauncherSessionPinned } from "./launcher-prefs.mjs";

const execFileAsync = promisify(execFile);

export async function serveLocalViewer({
  codexHome,
  claudeHome,
  traeHome,
  traeAppHome,
  traeRecordingsDir,
  host,
  port,
  defaultServerLimit,
  snapshotLogoSvg,
  shareConfig,
  listSessions,
  loadSnapshot,
  searchSessions,
  applySafetyChecksOption,
  snapshotApiResponse,
  publishAllSnapshots,
  publishSnapshot,
  createShareRequestPayload,
  stableSnapshotShareId,
  renderMarkdown,
  renderHtml,
  readPositiveInteger,
  readNonNegativeInteger,
  safeFileName,
}) {
  const csrfToken = createMutationCsrfToken();
  const sessionHeadCache = new Map();
  const server = http.createServer(async (request, response) => {
    try {
      setSnapshotServerCorsHeaders(request, response);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (!isAllowedSnapshotServerRequest(request)) {
        sendJson(response, { error: "origin is not allowed to access this local snapshot server" }, 403);
        return;
      }
      const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      if (url.pathname === "/") {
        send(response, 200, "text/html; charset=utf-8", renderServerApp(csrfToken, shareConfig));
        return;
      }
      if (url.pathname === "/launcher") {
        send(response, 200, "text/html; charset=utf-8", renderLauncherApp(csrfToken));
        return;
      }
      if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
        send(response, 200, "image/svg+xml; charset=utf-8", snapshotLogoSvg);
        return;
      }
      if (url.pathname === "/api/sessions") {
        const limit = url.searchParams.get("all") === "1"
          ? Number.POSITIVE_INFINITY
          : readPositiveInteger(url.searchParams.get("limit") || String(defaultServerLimit), "limit");
        const offset = readNonNegativeInteger(url.searchParams.get("offset") || "0", "offset");
        const sessions = await listSessionsWithCache({
          listSessions,
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          limit,
          offset,
          cwd: url.searchParams.get("cwd") || "",
          includeArchived: url.searchParams.get("liveOnly") !== "1",
          liveOnly: url.searchParams.get("liveOnly") === "1",
          source: url.searchParams.get("source") || "codex",
          completeOnly: url.searchParams.get("completeOnly") !== "0",
        });
        sendJson(response, sessions);
        return;
      }
      if (url.pathname === "/api/search") {
        const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
        const limit = readPositiveInteger(url.searchParams.get("limit") || "20", "limit");
        const scanLimit = readPositiveInteger(url.searchParams.get("scanLimit") || "600", "scanLimit");
        const cwd = url.searchParams.get("cwd") || "";
        const includeArchived = url.searchParams.get("liveOnly") !== "1";
        const source = url.searchParams.get("source") || "all";
        const completeOnly = url.searchParams.get("completeOnly") !== "0";
        const includeTools = url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1";
        const includeToolOutput = url.searchParams.get("includeToolOutput") === "1";
        // Keep the persistent index fresh in the background for future searches.
        // One overlap-guarded full pass warms the whole corpus (~30s) so later
        // searches are instant; the live fallback below covers the cold window.
        syncSearchIndexInBackground({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          source: "all",
          includeArchived,
          completeOnly,
          scanLimit: 20000,
          updateLimit: 20000,
          includeTools: true,
          includeToolOutput,
        });
        let result;
        // Serve from the fast index once it holds anything; otherwise do a live
        // disk scan for this query while the index warms up in the background.
        const indexReady = url.searchParams.get("noIndex") !== "1" && (await indexRowCount()) > 0;
        if (indexReady) {
          result = await searchIndexed({ query, source, cwd, limit });
        } else {
          result = await searchSessions({
            codexHome,
            claudeHome,
            traeHome,
            traeAppHome,
            traeRecordingsDir,
            query,
            limit,
            scanLimit,
            cwd,
            includeArchived,
            source,
            completeOnly,
            includeTools,
            includeToolOutput,
          });
        }
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/api/search-stats") {
        reconcileSessionListCacheInBackground({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
        });
        syncSearchIndexInBackground({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          source: "all",
          scanLimit: 20000,
          updateLimit: 20000,
        });
        const stats = await searchIndexStats({
          pricePerMTokIn: Number(url.searchParams.get("priceIn") || "0") || 0,
          pricePerMTokOut: Number(url.searchParams.get("priceOut") || "0") || 0,
        });
        sendJson(response, { ...stats, sessionListCache: await sessionListCacheStatus() });
        return;
      }
      if (url.pathname === "/api/sessions-cache-status") {
        sendJson(response, await sessionListCacheStatus());
        return;
      }
      if (url.pathname === "/api/quota") {
        const [quota, claude] = await Promise.all([
          readCodexQuotaSnapshot({ codexHome }),
          readClaudeBlockUsageEstimate({ claudeHome }),
        ]);
        sendJson(response, { ...quota, claude });
        return;
      }
      if (url.pathname === "/api/activity") {
        syncSearchIndexInBackground({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          source: "all",
          scanLimit: 20000,
          updateLimit: 20000,
        });
        const limit = readPositiveInteger(url.searchParams.get("limit") || "20000", "limit");
        const analytics = await buildUsageAnalytics({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          listSessions,
          limit,
        });
        sendJson(response, analytics);
        return;
      }
      if (url.pathname === "/api/weekly-digest") {
        syncSearchIndexInBackground({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          source: "all",
          scanLimit: 20000,
          updateLimit: 20000,
        });
        const digest = await buildWeeklyDigest({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          listSessions: (options) => listSessionsWithCache({ ...options, listSessions }),
          weeks: readPositiveInteger(url.searchParams.get("weeks") || "1", "weeks"),
          limit: readPositiveInteger(url.searchParams.get("limit") || "20000", "limit"),
        });
        sendJson(response, digest);
        return;
      }
      if (url.pathname === "/api/images") {
        const result = await listImageEntries({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          listSessions,
          loadSnapshot,
          source: url.searchParams.get("source") || "all",
          limit: readPositiveInteger(url.searchParams.get("limit") || "36", "limit"),
          offset: readNonNegativeInteger(url.searchParams.get("offset") || "0", "offset"),
        });
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/api/image") {
        const ref = url.searchParams.get("ref") || "";
        if (!ref) {
          sendJson(response, { error: "missing ref" }, 400);
          return;
        }
        const image = await readImageBytes({
          ref,
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          loadSnapshot,
        });
        if (!image) {
          sendJson(response, { error: "image not found" }, 404);
          return;
        }
        response.writeHead(200, {
          "content-type": image.mime,
          "content-length": String(image.bytes.length),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(image.bytes);
        return;
      }
      if (url.pathname === "/api/session-commits") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(response, { error: "missing id" }, 400);
          return;
        }
        const snapshot = await loadSnapshot(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          includeTools: false,
          includeToolOutput: false,
          redact: false,
        });
        const commits = await readSessionCommits(snapshot);
        sendJson(response, { commits });
        return;
      }
      if (url.pathname === "/api/session-head") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(response, { error: "missing id" }, 400);
          return;
        }
        const head = await readSessionHead(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          loadSnapshot,
          cache: sessionHeadCache,
        });
        sendJson(response, head);
        return;
      }
      if (url.pathname === "/api/session-peek") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(response, { error: "missing id" }, 400);
          return;
        }
        const turnLimit = Math.min(20, readPositiveInteger(url.searchParams.get("turns") || "6", "turns"));
        const peek = await readSessionPeek(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          loadSnapshot,
          cache: sessionHeadCache,
          turnLimit,
        });
        sendJson(response, peek);
        return;
      }
      if (url.pathname === "/api/resume-in-orca") {
        if (!allowMutationRequest(request, response, csrfToken)) {
          return;
        }
        const id = url.searchParams.get("id") || "";
        const cwd = url.searchParams.get("cwd") || "";
        const refMatch = /^(codex|claude):(.+)$/.exec(id);
        if (!refMatch) {
          sendJson(response, { ok: false, error: "该会话无法在 Orca 中恢复（仅支持 Codex / Claude）" }, 400);
          return;
        }
        const result = await resumeSessionInOrca({ engine: refMatch[1], sessionId: refMatch[2], cwd, title: url.searchParams.get("title") || "" });
        if (result.ok) {
          await recordLauncherAccess({ ref: id, cwd });
        }
        sendJson(response, result, result.ok ? 200 : 400);
        return;
      }
      if (url.pathname === "/api/launcher-prefs") {
        if (request.method !== "GET") {
          sendJson(response, { error: "method not allowed" }, 405);
          return;
        }
        sendJson(response, await readLauncherPrefs());
        return;
      }
      if (url.pathname === "/api/launcher-prefs/pin") {
        if (!allowMutationRequest(request, response, csrfToken)) {
          return;
        }
        let body;
        try {
          body = await readJsonRequestBody(request);
        } catch (error) {
          sendJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
          return;
        }
        const result = await setLauncherSessionPinned(body);
        sendJson(response, result, result.ok ? 200 : 400);
        return;
      }
      if (url.pathname === "/api/launcher-prefs/touch") {
        if (!allowMutationRequest(request, response, csrfToken)) {
          return;
        }
        let body;
        try {
          body = await readJsonRequestBody(request);
        } catch (error) {
          sendJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
          return;
        }
        const result = await recordLauncherAccess(body);
        sendJson(response, result, result.ok ? 200 : 400);
        return;
      }
      if (url.pathname === "/api/reveal-in-file") {
        if (!allowMutationRequest(request, response, csrfToken)) {
          return;
        }
        const targetPath = String(url.searchParams.get("path") || "").trim();
        if (!targetPath) {
          sendJson(response, { ok: false, error: "缺少路径" }, 400);
          return;
        }
        if (!isAbsolute(targetPath)) {
          sendJson(response, { ok: false, error: "路径必须是绝对路径" }, 400);
          return;
        }
        const pathInfo = await stat(targetPath).catch(() => null);
        if (!pathInfo) {
          sendJson(response, { ok: false, error: "路径不存在" }, 404);
          return;
        }
        const result = await revealPathInFileManager(targetPath, pathInfo.isDirectory());
        sendJson(response, result, result.ok ? 200 : 500);
        return;
      }
      if (url.pathname === "/api/semantic-search") {
        const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
        const limit = readPositiveInteger(url.searchParams.get("limit") || "20", "limit");
        const scanLimit = readPositiveInteger(url.searchParams.get("scanLimit") || "600", "scanLimit");
        const updateLimit = readNonNegativeInteger(url.searchParams.get("updateLimit") || "24", "updateLimit");
        const result = await semanticSearchSessions({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          listSessions,
          loadSnapshot,
          query,
          limit,
          scanLimit,
          updateLimit,
          cwd: url.searchParams.get("cwd") || "",
          includeArchived: url.searchParams.get("liveOnly") !== "1",
          source: url.searchParams.get("source") || "all",
          completeOnly: url.searchParams.get("completeOnly") !== "0",
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          model: url.searchParams.get("model") || undefined,
        });
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/api/semantic-index/prewarm") {
        if (!allowMutationRequest(request, response, csrfToken)) {
          return;
        }
        const scanLimit = readPositiveInteger(url.searchParams.get("scanLimit") || "1200", "scanLimit");
        const updateLimit = readNonNegativeInteger(url.searchParams.get("updateLimit") || "120", "updateLimit");
        const result = await prewarmSemanticIndex({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          listSessions,
          loadSnapshot,
          scanLimit,
          updateLimit,
          cwd: url.searchParams.get("cwd") || "",
          includeArchived: url.searchParams.get("liveOnly") !== "1",
          source: url.searchParams.get("source") || "all",
          completeOnly: url.searchParams.get("completeOnly") !== "0",
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          model: url.searchParams.get("model") || undefined,
        });
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/api/snapshot") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(response, { error: "missing id" }, 400);
          return;
        }
        const snapshot = await loadSnapshot(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          redact: url.searchParams.get("redact") !== "0",
        });
        await rememberSessionHead(id, snapshot, sessionHeadCache);
        applySafetyChecksOption(snapshot, url.searchParams.get("safety") !== "0");
        sendJson(response, snapshotApiResponse(snapshot));
        return;
      }
      if (url.pathname === "/api/session-search") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(response, { error: "missing id" }, 400);
          return;
        }
        const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
        const snapshot = await loadSnapshot(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          redact: url.searchParams.get("redact") !== "0",
        });
        const result = await semanticSearchSnapshot(snapshot, {
          query,
          limit: readPositiveInteger(url.searchParams.get("limit") || "8", "limit"),
          model: url.searchParams.get("model") || undefined,
        });
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/api/publish-all") {
        if (!allowMutationRequest(request, response, csrfToken)) {
          return;
        }
        if (url.searchParams.get("redact") === "0") {
          sendJson(response, { error: "Cloud publish requires Redact enabled in the local viewer." }, 400);
          return;
        }
        const result = await publishAllSnapshots({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          cwd: url.searchParams.get("cwd") || "",
          includeArchived: url.searchParams.get("liveOnly") !== "1",
          source: "all",
          completeOnly: url.searchParams.get("completeOnly") !== "0",
          limit: url.searchParams.get("limit")
            ? readPositiveInteger(url.searchParams.get("limit"), "limit")
            : Number.POSITIVE_INFINITY,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          safety: url.searchParams.get("safety") === "1",
        });
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/api/publish") {
        if (!allowMutationRequest(request, response, csrfToken)) {
          return;
        }
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(response, { error: "missing id" }, 400);
          return;
        }
        if (url.searchParams.get("redact") === "0") {
          sendJson(response, { error: "Cloud publish requires Redact enabled in the local viewer." }, 400);
          return;
        }
        const snapshot = await loadSnapshot(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          redact: true,
        });
        applySafetyChecksOption(snapshot, url.searchParams.get("safety") === "1");
        const result = await publishSnapshot(snapshot, {
          apiUrl: "",
          token: "",
          siteUrl: "",
          expiresInDays: 0,
          shareId: stableSnapshotShareId(snapshot),
        });
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/api/publish-gist") {
        if (!allowMutationRequest(request, response, csrfToken)) {
          return;
        }
        let body;
        try {
          body = await readJsonRequestBody(request);
        } catch (error) {
          sendJson(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
          return;
        }
        const id = String(body?.id || "").trim();
        if (!id) {
          sendJson(response, { ok: false, error: "missing id" }, 400);
          return;
        }
        try {
          const snapshot = await loadSnapshot(id, {
            codexHome,
            claudeHome,
            traeHome,
            traeAppHome,
            traeRecordingsDir,
            includeTools: false,
            includeToolOutput: false,
            redact: true,
          });
          const result = await createGitHubGist(renderHtml(snapshot), { publicGist: false });
          sendJson(response, { ok: true, url: result.gistUrl });
        } catch (error) {
          if (isGitHubGistPublishError(error)) {
            const status = error.code === "gh_not_authenticated"
              ? 401
              : error.code === "gh_not_installed"
                ? 503
                : error.code === "network_failure"
                  ? 502
                  : 500;
            sendJson(response, { ok: false, code: error.code, error: error.message }, status);
            return;
          }
          throw error;
        }
        return;
      }
      if (url.pathname === "/api/share-payload") {
        if (!allowMutationRequest(request, response, csrfToken)) {
          return;
        }
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(response, { error: "missing id" }, 400);
          return;
        }
        if (url.searchParams.get("redact") === "0") {
          sendJson(response, { error: "Cloud publish requires Redact enabled in the local viewer." }, 400);
          return;
        }
        const snapshot = await loadSnapshot(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          redact: true,
        });
        applySafetyChecksOption(snapshot, url.searchParams.get("safety") === "1");
        const result = createShareRequestPayload(snapshot, {
          apiUrl: "",
          siteUrl: "",
          expiresInDays: 0,
          shareId: stableSnapshotShareId(snapshot),
        });
        sendJson(response, result);
        return;
      }
      if (url.pathname === "/export") {
        const id = url.searchParams.get("id");
        const format = url.searchParams.get("format") === "md" ? "md" : "html";
        if (!id) {
          send(response, 400, "text/plain; charset=utf-8", "missing id");
          return;
        }
        const snapshot = await loadSnapshot(id, {
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
          redact: url.searchParams.get("redact") !== "0",
        });
        applySafetyChecksOption(snapshot, url.searchParams.get("safety") !== "0");
        const body = format === "md" ? renderMarkdown(snapshot) : renderHtml(snapshot);
        const fileName = `${safeFileName(snapshot.title || snapshot.id)}.${format === "md" ? "md" : "html"}`;
        response.writeHead(200, {
          "content-type": format === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="${fileName}"`,
          "cache-control": "no-store",
        });
        response.end(body);
        return;
      }
      send(response, 404, "text/plain; charset=utf-8", "not found");
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const url = `http://${host}:${port}`;
  console.log(`Codex Snapshot is running at ${url}`);
  console.log(`Codex home: ${codexHome}`);
  console.log(`Claude Code home: ${claudeHome}`);
  console.log(`Trae home: ${traeHome}`);
  console.log(`Trae app home: ${traeAppHome}`);
  console.log(`Trae recordings: ${traeRecordingsDir}`);
}

async function readJsonRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

async function readSessionHead(id, { codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, loadSnapshot, cache }) {
  const cached = cache.get(id);
  if (cached?.filePath) {
    const fileInfo = await stat(cached.filePath).catch(() => null);
    if (fileInfo && fileInfo.mtimeMs === cached.mtimeMs && fileInfo.size === cached.size) {
      return cached.head;
    }
  }

  const snapshot = await loadSnapshot(id, {
    codexHome,
    claudeHome,
    traeHome,
    traeAppHome,
    traeRecordingsDir,
    includeTools: false,
    includeToolOutput: false,
    redact: false,
  });
  return rememberSessionHead(id, snapshot, cache);
}

async function rememberSessionHead(id, snapshot, cache) {
  const filePath = typeof snapshot?.filePath === "string" ? snapshot.filePath : "";
  const fileInfo = filePath ? await stat(filePath).catch(() => null) : null;
  const head = {
    complete: isSnapshotComplete(snapshot),
    turnCount: Array.isArray(snapshot?.turns) ? snapshot.turns.length : Number(snapshot?.turnCount || 0) || 0,
    lastEventAt: sessionLastEventAt(snapshot, fileInfo),
  };
  cache.set(id, {
    filePath,
    mtimeMs: fileInfo?.mtimeMs || Number(snapshot?.mtimeMs || 0) || 0,
    size: fileInfo?.size || Number(snapshot?.size || 0) || 0,
    head,
  });
  return head;
}

async function readSessionPeek(id, { codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, loadSnapshot, cache, turnLimit }) {
  const snapshot = await loadSnapshot(id, {
    codexHome,
    claudeHome,
    traeHome,
    traeAppHome,
    traeRecordingsDir,
    includeTools: false,
    includeToolOutput: false,
    redact: true,
  });
  if (cache) {
    await rememberSessionHead(id, snapshot, cache);
  }
  const filePath = typeof snapshot?.filePath === "string" ? snapshot.filePath : "";
  const fileInfo = filePath ? await stat(filePath).catch(() => null) : null;
  return {
    title: redactText(snapshot?.title || snapshot?.id || id),
    project: snapshotProjectName(snapshot),
    mtime: sessionLastEventAt(snapshot, fileInfo),
    turns: sessionPeekTurns(snapshot?.turns || [], turnLimit),
  };
}

function snapshotProjectName(snapshot) {
  const raw = String(snapshot?.displayCwd || snapshot?.cwd || "").trim();
  if (!raw) {
    return "";
  }
  const normalized = normalizeSessionPath(raw).replace(/\/+$/, "");
  const leaf = normalized.split("/").filter(Boolean).pop() || raw;
  return redactText(leaf);
}

function sessionPeekTurns(turns, turnLimit) {
  const limit = Math.max(1, Math.min(20, Number(turnLimit) || 6));
  return (Array.isArray(turns) ? turns : [])
    .filter((turn) => {
      const role = String(turn?.role || "").toLowerCase();
      return turn?.kind !== "tool" && (role === "user" || role === "assistant") && String(turn?.text || "").trim();
    })
    .slice(-limit)
    .map((turn) => ({
      role: String(turn.role).toLowerCase() === "user" ? "user" : "assistant",
      text: peekSnippetText(turn.text),
    }));
}

function peekSnippetText(value) {
  return redactText(String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n")).slice(0, 400);
}

function isSnapshotComplete(snapshot) {
  if (snapshot?.complete === true) {
    return true;
  }
  if (snapshot?.complete === false || snapshot?.live === true) {
    return false;
  }
  const engine = String(snapshot?.engine || "").toLowerCase();
  if (engine === "trae") {
    return true;
  }
  if (engine === "codex") {
    const filePath = normalizeSessionPath(snapshot?.filePath || snapshot?.displayFilePath || "");
    if (filePath.includes("/archived_sessions/")) {
      return true;
    }
    if (filePath.includes("/sessions/")) {
      return false;
    }
    return true;
  }
  if (engine === "claude") {
    return snapshot?.sourceKind ? snapshot.sourceKind === "transcript" : true;
  }
  return true;
}

function normalizeSessionPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sessionLastEventAt(snapshot, fileInfo) {
  let latest = fileInfo?.mtimeMs || new Date(snapshot?.mtime || snapshot?.generatedAt || 0).getTime();
  for (const turn of snapshot?.turns || []) {
    const time = new Date(turn?.timestamp || 0).getTime();
    if (Number.isFinite(time)) {
      latest = Math.max(latest || 0, time);
    }
  }
  return Number.isFinite(latest) && latest > 0 ? new Date(latest).toISOString() : "";
}

async function readSessionCommits(snapshot) {
  const cwd = typeof snapshot?.cwd === "string" ? snapshot.cwd.trim() : "";
  if (!cwd) {
    return [];
  }
  const range = sessionTurnTimeRange(snapshot?.turns || []);
  if (!range) {
    return [];
  }
  const cwdInfo = await stat(cwd).catch(() => null);
  if (!cwdInfo?.isDirectory()) {
    return [];
  }
  try {
    const repoCheck = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
    if (String(repoCheck.stdout || "").trim() !== "true") {
      return [];
    }
    const result = await execFileAsync("git", [
      "log",
      "--since",
      range.start.toISOString(),
      "--until",
      range.end.toISOString(),
      "--pretty=format:%H%x09%cI%x09%s",
    ], { cwd });
    return parseGitLogCommits(result.stdout || "");
  } catch {
    return [];
  }
}

async function revealPathInFileManager(targetPath, isDirectory) {
  if (process.platform === "darwin") {
    await execFileAsync("open", ["-R", targetPath]);
    return { ok: true, message: "已在 Finder 中显示" };
  }

  const directory = isDirectory ? targetPath : dirname(targetPath);
  if (process.platform === "win32") {
    await execFileAsync("explorer.exe", [directory]);
    return { ok: true, message: "已打开所在目录" };
  }

  await execFileAsync("xdg-open", [directory]);
  return { ok: true, message: "已打开所在目录" };
}

function sessionTurnTimeRange(turns) {
  const first = firstValidTurnDate(turns);
  const last = firstValidTurnDate((turns || []).slice().reverse());
  if (!first || !last) {
    return null;
  }
  const startMs = first.getTime();
  const endMs = last.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  return {
    start: new Date(Math.min(startMs, endMs)),
    end: new Date(Math.max(startMs, endMs) + 10 * 60 * 1000),
  };
}

function firstValidTurnDate(turns) {
  for (const turn of turns || []) {
    const timestamp = String(turn?.timestamp || "").trim();
    if (!timestamp) {
      continue;
    }
    const date = new Date(timestamp);
    if (Number.isFinite(date.getTime())) {
      return date;
    }
  }
  return null;
}

function parseGitLogCommits(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) {
        return null;
      }
      const sha = String(parts.shift() || "").trim();
      const timestamp = String(parts.shift() || "").trim();
      const subject = redactText(parts.join("\t").trim());
      if (!sha || !timestamp || !subject) {
        return null;
      }
      return { sha, timestamp, subject };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
