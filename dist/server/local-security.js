import { randomBytes } from "node:crypto";
import { sendJson } from "./http.js";
export const MUTATION_CSRF_HEADER = "x-agent-snapshot-csrf";
export function createMutationCsrfToken() {
    return randomBytes(32).toString("base64url");
}
export function setSnapshotServerCorsHeaders(request, response) {
    const origin = request.headers.origin || "";
    if (!origin) {
        response.setHeader("access-control-allow-origin", "*");
    }
    else if (isAllowedSnapshotOrigin(origin)) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "Origin");
    }
    response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    response.setHeader("access-control-allow-headers", `content-type,${MUTATION_CSRF_HEADER}`);
    response.setHeader("access-control-max-age", "86400");
}
export function isAllowedSnapshotServerRequest(request) {
    const origin = request.headers.origin || "";
    return !origin || isAllowedSnapshotOrigin(origin);
}
export function isAllowedSnapshotOrigin(origin) {
    const text = Array.isArray(origin) ? origin[0] || "" : origin;
    const configuredOrigins = String(process.env.SNAPSHOT_VIEWER_ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const allowedOrigins = new Set([
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        ...configuredOrigins,
    ]);
    if (allowedOrigins.has(text)) {
        return true;
    }
    try {
        const url = new URL(text);
        return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    }
    catch {
        return false;
    }
}
export function allowMutationRequest(request, response, csrfToken) {
    if (request.method !== "POST") {
        sendJson(response, { error: "method not allowed" }, 405);
        return false;
    }
    const origin = String(request.headers.origin || "");
    if (!origin) {
        sendJson(response, { error: "origin is required for local mutation requests" }, 403);
        return false;
    }
    if (!isAllowedSnapshotOrigin(origin)) {
        sendJson(response, { error: "origin is not allowed to mutate this local snapshot server" }, 403);
        return false;
    }
    const token = String(request.headers[MUTATION_CSRF_HEADER] || "");
    if (!token || token !== csrfToken) {
        sendJson(response, { error: "invalid csrf token" }, 403);
        return false;
    }
    return true;
}
