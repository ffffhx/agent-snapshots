import type { SiteConfig } from "./types";

export const DEFAULT_VIEWER_URL = "http://127.0.0.1:4321/";
export const DEFAULT_API_URL = "http://127.0.0.1:8787";

export function config(): SiteConfig {
  return window.CODEX_SNAPSHOTS_CONFIG || {};
}

export function normalizeViewerUrl(value: string | null | undefined): string {
  const normalized = String(value || DEFAULT_VIEWER_URL).trim();
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function normalizeApiUrl(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function resolveInitialApiUrl(params: URLSearchParams): string {
  const storedApiUrl = safeLocalStorageGet("codex-snapshots.api");
  const resolved = params.get("api") || config().apiUrl || safeStoredApiUrl(storedApiUrl);
  return normalizeApiUrl(resolved || (isLocalPage() ? DEFAULT_API_URL : ""));
}

export function safeStoredApiUrl(value: string | null): string {
  const normalized = normalizeApiUrl(value);
  if (!normalized) {
    return "";
  }
  return isLocalPage() || !isLoopbackUrl(normalized) ? normalized : "";
}

export function isLocalPage(): boolean {
  return isLoopbackHost(window.location.hostname);
}

export function isLoopbackUrl(value: string): boolean {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function safeLocalStorageGet(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Local storage can be disabled on locked-down browsers; the page still works without persistence.
  }
}

export function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}

export function openInNewTab(url: string): void {
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
    opened.focus?.();
    return;
  }
  window.location.href = url;
}

export function mergeLinkRel(value: string): string {
  const rel = new Set(String(value || "").split(/\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  return Array.from(rel).join(" ");
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
