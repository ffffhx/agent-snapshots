const DEFAULT_API_URL = "http://127.0.0.1:8787";
const params = new URLSearchParams(window.location.search);
const shareId = params.get("id") || "";
const apiUrl = normalizeApiUrl(params.get("api") || localStorage.getItem("codex-snapshots.api") || DEFAULT_API_URL);

const title = document.getElementById("share-title");
const meta = document.getElementById("share-meta");
const content = document.getElementById("share-content");

loadShare().catch((error) => {
  title.textContent = "快照暂不可用";
  meta.textContent = apiUrl;
  content.innerHTML = `<div class="empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
});

async function loadShare() {
  if (!shareId) {
    title.textContent = "缺少分享 ID";
    meta.textContent = "请打开带有 ?id=snap_... 的链接。";
    content.innerHTML = '<div class="empty">没有提供分享 ID。</div>';
    return;
  }

  localStorage.setItem("codex-snapshots.api", apiUrl);

  const response = await fetch(`${apiUrl}/api/snapshots/${encodeURIComponent(shareId)}`, {
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `无法从 ${apiUrl} 加载快照`);
  }

  renderSnapshot(payload);
}

function renderSnapshot(payload) {
  const snapshot = payload.snapshot || {};
  const share = payload.share || {};
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];

  title.textContent = share.title || snapshot.title || "快照";
  meta.textContent = [
    share.engineLabel || snapshot.engineLabel || "Codex",
    share.id || snapshot.id || "未知",
    `${share.turnCount ?? turns.length} 条记录`,
    `已脱敏：${(share.redacted ?? snapshot.redacted) ? "是" : "否"}`,
    apiUrl,
  ].join(" | ");

  content.innerHTML = turns.length
    ? turns.map(renderTurn).join("")
    : '<div class="empty">这个快照没有可分享的对话记录。</div>';
}

function renderTurn(turn) {
  const role = turn.kind === "tool" ? "tool" : turn.role === "user" ? "user" : "assistant";
  const body = turn.kind === "tool"
    ? `<details class="tool-details" open><summary>工具${turn.name ? ` / ${escapeHtml(turn.name)}` : ""}</summary><pre>${escapeHtml(turn.text || "")}</pre></details>`
    : `${turn.html || renderPlainText(turn.text)}${renderImages(turn.images || [])}`;

  return `<article class="turn ${escapeHtml(role)}"><div class="message-card"><div class="body">${sanitizeClientHtml(body)}</div></div></article>`;
}

function renderPlainText(value) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderImages(images) {
  if (!Array.isArray(images) || !images.length) {
    return "";
  }

  return `<div class="attachment-grid">${images.map((image, index) => {
    const label = `${image.mimeType || "image"}${image.size ? ` / ${image.size}` : ""}`;
    if (!image.src) {
      return `<figure class="image-attachment image-unavailable"><div>${escapeHtml(image.unavailableReason || "图片暂不可用")}</div><figcaption>${escapeHtml(label)}</figcaption></figure>`;
    }
    return `<figure class="image-attachment"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || `图片附件 ${index + 1}`)}" decoding="async"><figcaption>${escapeHtml(label)}</figcaption></figure>`;
  }).join("")}</div>`;
}

function sanitizeClientHtml(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed)>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeApiUrl(value) {
  return String(value || DEFAULT_API_URL).trim().replace(/\/+$/, "");
}
