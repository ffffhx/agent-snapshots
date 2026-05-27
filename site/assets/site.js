const DEFAULT_VIEWER_URL = "http://127.0.0.1:4321/";
const DEFAULT_API_URL = "http://127.0.0.1:8787";

const params = new URLSearchParams(window.location.search);
const viewerUrl = normalizeViewerUrl(params.get("viewer") || DEFAULT_VIEWER_URL);
const apiUrl = normalizeApiUrl(params.get("api") || localStorage.getItem("codex-snapshots.api") || DEFAULT_API_URL);

const viewerStatus = document.getElementById("viewer-status");
const apiStatus = document.getElementById("api-status");
const viewerLink = document.getElementById("open-local-viewer");
const viewerUrlLabel = document.getElementById("viewer-url-label");
const apiInput = document.getElementById("api-url");
const shareInput = document.getElementById("share-id");
const shareForm = document.getElementById("share-form");

viewerLink.href = viewerUrl;
viewerUrlLabel.textContent = viewerUrl;
apiInput.value = apiUrl;
shareInput.value = params.get("id") || "";

checkViewer(viewerUrl);
checkApi(apiUrl);

apiInput.addEventListener("change", () => {
  localStorage.setItem("codex-snapshots.api", normalizeApiUrl(apiInput.value));
  checkApi(normalizeApiUrl(apiInput.value));
});

shareForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = shareInput.value.trim();
  const api = normalizeApiUrl(apiInput.value);

  if (!id) {
    shareInput.focus();
    return;
  }

  localStorage.setItem("codex-snapshots.api", api);
  const target = new URL("./share/index.html", window.location.href);
  target.searchParams.set("id", id);
  target.searchParams.set("api", api);
  window.location.href = target.toString();
});

async function checkViewer(url) {
  setStatus(viewerStatus, "Checking", "checking");

  try {
    await fetch(url, {
      cache: "no-store",
      mode: "no-cors",
      signal: AbortSignal.timeout(2500),
    });
    setStatus(viewerStatus, "Connected", "ready");
  } catch {
    setStatus(viewerStatus, "Offline", "error");
  }
}

async function checkApi(url) {
  setStatus(apiStatus, "Checking", "checking");

  try {
    const response = await fetch(`${url}/api/snapshots/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    setStatus(apiStatus, "Connected", "ready");
  } catch {
    setStatus(apiStatus, "Optional", "error");
  }
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
  return String(value || DEFAULT_API_URL).trim().replace(/\/+$/, "");
}
