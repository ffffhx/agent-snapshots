const DEFAULT_VIEWER_URL = "http://127.0.0.1:4321/";
const DEFAULT_API_URL = "http://127.0.0.1:8787";

const params = new URLSearchParams(window.location.search);
const config = window.CODEX_SNAPSHOTS_CONFIG || {};
const viewerUrl = normalizeViewerUrl(params.get("viewer") || DEFAULT_VIEWER_URL);
const apiUrl = resolveInitialApiUrl();

const viewerStatus = document.getElementById("viewer-status");
const apiStatus = document.getElementById("api-status");
const viewerLink = document.getElementById("open-local-viewer");
const viewerUrlLabel = document.getElementById("viewer-url-label");
const apiInput = document.getElementById("api-url");
const shareInput = document.getElementById("share-id");
const shareForm = document.getElementById("share-form");
const publicSessions = document.getElementById("public-sessions");
const publicSessionsRefresh = document.getElementById("public-sessions-refresh");
const copyButtons = document.querySelectorAll("[data-copy-command]");

viewerLink.href = viewerUrl;
viewerUrlLabel.textContent = viewerUrl;
apiInput.value = apiUrl;
shareInput.value = params.get("id") || "";

checkViewer(viewerUrl);
checkApi(apiUrl);
loadPublicSessions(apiUrl);

apiInput.addEventListener("change", () => {
  const nextApiUrl = normalizeApiUrl(apiInput.value);
  localStorage.setItem("codex-snapshots.api", nextApiUrl);
  checkApi(nextApiUrl);
  loadPublicSessions(nextApiUrl);
});

shareForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = shareInput.value.trim();
  const api = normalizeApiUrl(apiInput.value);

  if (!id) {
    shareInput.focus();
    return;
  }
  if (!api) {
    setStatus(apiStatus, "未配置", "error");
    apiInput.focus();
    return;
  }

  localStorage.setItem("codex-snapshots.api", api);
  const target = new URL("./share/index.html", window.location.href);
  target.searchParams.set("id", id);
  target.searchParams.set("api", api);
  window.location.href = target.toString();
});

publicSessionsRefresh.addEventListener("click", () => {
  loadPublicSessions(normalizeApiUrl(apiInput.value));
});

for (const button of copyButtons) {
  button.addEventListener("click", async () => {
    const command = button.dataset.copyCommand || "";
    if (!command) {
      return;
    }

    await navigator.clipboard?.writeText(command).catch(() => undefined);
    const original = button.textContent;
    button.textContent = "已复制";
    window.setTimeout(() => {
      button.textContent = original;
    }, 1400);
  });
}

async function checkViewer(url) {
  setStatus(viewerStatus, "检查中", "checking");

  try {
    await fetch(url, {
      cache: "no-store",
      mode: "no-cors",
      signal: AbortSignal.timeout(2500),
    });
    setStatus(viewerStatus, "已连接", "ready");
  } catch {
    setStatus(viewerStatus, "未启动", "error");
  }
}

async function checkApi(url) {
  if (!url) {
    setStatus(apiStatus, "未配置", "error");
    return;
  }

  setStatus(apiStatus, "检查中", "checking");

  try {
    const response = await fetch(`${url}/api/snapshots/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    setStatus(apiStatus, "已连接", "ready");
  } catch {
    setStatus(apiStatus, "可选", "error");
  }
}

async function loadPublicSessions(url) {
  if (!url) {
    renderPublicSessionState("公开分享 API 尚未配置。");
    return;
  }

  renderPublicSessionState("正在加载公开 Session...");

  try {
    const response = await fetch(`${url}/api/snapshots?limit=12`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }

    const shares = Array.isArray(payload.shares) ? payload.shares.filter((share) => share && share.id) : [];
    renderPublicSessions(shares, url);
  } catch {
    renderPublicSessionState("分享 API 暂不可用，稍后再试。");
  }
}

function renderPublicSessions(shares, api) {
  publicSessions.replaceChildren();

  if (!shares.length) {
    renderPublicSessionState("暂无公开 Session。");
    return;
  }

  for (const share of shares) {
    publicSessions.append(renderPublicSessionCard(share, api));
  }
}

function renderPublicSessionCard(share, api) {
  const card = document.createElement("a");
  card.className = "public-session-card";
  card.href = sharePageUrl(share.id, api);

  const top = document.createElement("div");
  top.className = "public-session-top";

  const engine = document.createElement("span");
  engine.className = "public-session-engine";
  engine.textContent = share.engineLabel || share.engine || "Codex";

  const date = document.createElement("time");
  date.dateTime = share.createdAt || "";
  date.textContent = formatDateLabel(share.createdAt || share.updatedAt);

  top.append(engine, date);

  const title = document.createElement("h3");
  title.textContent = share.title || share.id;

  const meta = document.createElement("p");
  meta.className = "public-session-meta";
  meta.textContent = [
    `${Number(share.turnCount || 0)} 条记录`,
    (share.redacted ?? true) ? "已脱敏" : "未脱敏",
  ].join(" · ");

  card.append(top, title, meta);
  return card;
}

function renderPublicSessionState(text) {
  publicSessions.replaceChildren();
  const state = document.createElement("div");
  state.className = "public-session-empty";
  state.textContent = text;
  publicSessions.append(state);
}

function sharePageUrl(id, api) {
  const target = new URL("./share/index.html", window.location.href);
  target.searchParams.set("id", id);
  target.searchParams.set("api", api);
  return target.toString();
}

function formatDateLabel(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function setStatus(element, text, state) {
  element.textContent = text;
  element.className = `status-pill ${state}`;
}

function normalizeViewerUrl(value) {
  const normalized = String(value || DEFAULT_VIEWER_URL).trim();
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeApiUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveInitialApiUrl() {
  const storedApiUrl = localStorage.getItem("codex-snapshots.api") || "";
  const resolved = params.get("api") || config.apiUrl || safeStoredApiUrl(storedApiUrl);
  return normalizeApiUrl(resolved || (isLocalPage() ? DEFAULT_API_URL : ""));
}

function safeStoredApiUrl(value) {
  const normalized = normalizeApiUrl(value);
  if (!normalized) {
    return "";
  }
  return isLocalPage() || !isLoopbackUrl(normalized) ? normalized : "";
}

function isLocalPage() {
  return isLoopbackHost(window.location.hostname);
}

function isLoopbackUrl(value) {
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}
