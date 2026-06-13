// @ts-nocheck

import http from "node:http";
import { send, sendJson } from "./http.js";
import {
  allowMutationRequest,
  createMutationCsrfToken,
  isAllowedSnapshotServerRequest,
  setSnapshotServerCorsHeaders,
} from "./local-security.js";
import { renderServerApp } from "./local-viewer-app.mjs";

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
      if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
        send(response, 200, "image/svg+xml; charset=utf-8", snapshotLogoSvg);
        return;
      }
      if (url.pathname === "/api/sessions") {
        const limit = url.searchParams.get("all") === "1"
          ? Number.POSITIVE_INFINITY
          : readPositiveInteger(url.searchParams.get("limit") || String(defaultServerLimit), "limit");
        const offset = readNonNegativeInteger(url.searchParams.get("offset") || "0", "offset");
        const scanLimit = Number.isFinite(limit) ? limit + offset : Number.POSITIVE_INFINITY;
        const sessions = await listSessions({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          limit: scanLimit,
          cwd: url.searchParams.get("cwd") || "",
          includeArchived: url.searchParams.get("liveOnly") !== "1",
          source: url.searchParams.get("source") || "codex",
          completeOnly: url.searchParams.get("completeOnly") !== "0",
        });
        sendJson(response, Number.isFinite(limit) ? sessions.slice(offset, offset + limit) : sessions.slice(offset));
        return;
      }
      if (url.pathname === "/api/search") {
        const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
        const limit = readPositiveInteger(url.searchParams.get("limit") || "20", "limit");
        const scanLimit = readPositiveInteger(url.searchParams.get("scanLimit") || "600", "scanLimit");
        const result = await searchSessions({
          codexHome,
          claudeHome,
          traeHome,
          traeAppHome,
          traeRecordingsDir,
          query,
          limit,
          scanLimit,
          cwd: url.searchParams.get("cwd") || "",
          includeArchived: url.searchParams.get("liveOnly") !== "1",
          source: url.searchParams.get("source") || "all",
          completeOnly: url.searchParams.get("completeOnly") !== "0",
          includeTools: url.searchParams.get("includeTools") === "1" || url.searchParams.get("includeToolOutput") === "1",
          includeToolOutput: url.searchParams.get("includeToolOutput") === "1",
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
        applySafetyChecksOption(snapshot, url.searchParams.get("safety") !== "0");
        sendJson(response, snapshotApiResponse(snapshot));
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
