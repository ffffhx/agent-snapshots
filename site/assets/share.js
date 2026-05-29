const DEFAULT_API_URL = "http://127.0.0.1:8787";
const params = new URLSearchParams(window.location.search);
const config = window.CODEX_SNAPSHOTS_CONFIG || {};
const shareId = params.get("id") || "";
const apiUrl = resolveInitialApiUrl();

const title = document.getElementById("share-title");
const meta = document.getElementById("share-meta");
const content = document.getElementById("share-content");

content.addEventListener("click", handleContentLinkClick);

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
  if (!apiUrl) {
    title.textContent = "缺少分享 API";
    meta.textContent = "公开站点需要配置分享 API。";
    content.innerHTML = '<div class="empty">请使用带有 ?api=https://... 的分享链接，或先配置 CODEX_SNAPSHOTS_PUBLIC_API_URL。</div>';
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
    ? buildTranscriptItems(turns).map(renderTranscriptItem).join("")
    : '<div class="empty">这个快照没有可分享的对话记录。</div>';
  openContentLinksInNewTabs(content);
}

function buildTranscriptItems(turns) {
  const items = [];
  let index = 0;
  let previousUserTurn = null;
  while (index < turns.length) {
    const turn = turns[index];
    if (isUserMessageTurn(turn)) {
      items.push({ kind: "turn", turn });
      previousUserTurn = turn;
      index += 1;
      continue;
    }

    const segment = [];
    while (index < turns.length && !isUserMessageTurn(turns[index])) {
      segment.push(turns[index]);
      index += 1;
    }

    const finalIndex = segment.map(isAssistantMessageTurn).lastIndexOf(true);
    if (finalIndex === -1) {
      if (segment.length) {
        items.push({
          kind: "process",
          turns: segment,
          durationTurns: buildProcessDurationTurns(previousUserTurn, segment),
        });
      }
      continue;
    }
    if (finalIndex === segment.length - 1) {
      const processTurns = segment.slice(0, finalIndex);
      const finalTurn = segment[finalIndex];
      if (processTurns.length) {
        items.push({
          kind: "process",
          turns: processTurns,
          durationTurns: buildProcessDurationTurns(previousUserTurn, processTurns.concat(finalTurn)),
        });
      }
      items.push({ kind: "turn", turn: finalTurn });
      continue;
    }
    items.push({
      kind: "process",
      turns: segment,
      durationTurns: buildProcessDurationTurns(previousUserTurn, segment),
    });
  }
  return items;
}

function buildProcessDurationTurns(startTurn, turns) {
  return [startTurn, ...turns].filter(Boolean);
}

function isUserMessageTurn(turn) {
  return turn && turn.kind !== "tool" && turn.role === "user";
}

function isAssistantMessageTurn(turn) {
  return turn && turn.kind !== "tool" && turn.role === "assistant";
}

function renderTranscriptItem(item, index) {
  if (item.kind === "process") {
    return renderProcessGroup(item, index);
  }
  return renderTurn(item.turn);
}

function renderTurn(turn) {
  const role = turn.kind === "tool" ? "tool" : turn.role === "user" ? "user" : "assistant";
  return `<article class="turn ${escapeHtml(role)}"><div class="message-card"><div class="body">${sanitizeClientHtml(renderTurnBody(turn))}</div></div></article>`;
}

function renderProcessGroup(item, index) {
  const turns = item.turns || [];
  if (!turns.length) {
    return "";
  }
  return `<article class="turn process"><details class="process-details" data-process-index="${escapeHtml(index)}"><summary class="process-summary"><span>${escapeHtml(processLabel(item.durationTurns || turns))}</span></summary><div class="process-body">${turns.map(renderProcessEntry).join("")}</div></details></article>`;
}

function renderProcessEntry(turn) {
  const role = turn.kind === "tool" ? "tool" : turn.role === "user" ? "user" : "assistant";
  return `<section class="process-entry process-${escapeHtml(role)}"><div class="body">${sanitizeClientHtml(renderTurnBody(turn))}</div></section>`;
}

function renderTurnBody(turn) {
  if (turn.kind === "tool") {
    return `<details class="tool-details"><summary>工具${turn.name ? ` / ${escapeHtml(turn.name)}` : ""}</summary><pre>${escapeHtml(turn.text || "")}</pre></details>`;
  }
  return `${stripAppDirectiveHtml(turn.html || "") || renderPlainText(turn.text)}${renderImages(turn.images || [])}`;
}

function processLabel(turns) {
  const duration = processDurationLabel(turns);
  return duration ? `已处理 ${duration}` : "已处理";
}

function processDurationLabel(turns) {
  const times = turns.map((turn) => new Date(turn.timestamp || "").getTime()).filter(Number.isFinite);
  if (times.length < 2) {
    return "";
  }
  const seconds = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

function renderPlainText(value) {
  const visibleText = stripAppDirectives(value);
  if (!visibleText) {
    return "";
  }
  return visibleText
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function stripAppDirectives(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[^\n]*\}[ \t]*$/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripAppDirectiveHtml(value) {
  return String(value || "")
    .replace(/<p>\s*::(?:git-(?:stage|commit|push|create-branch|create-pr)|archive|code-comment)\{[\s\S]*?\}\s*<\/p>/g, "")
    .trim();
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

function handleContentLinkClick(event) {
  const link = event.target.closest?.("a[href]");
  if (!link) {
    return;
  }
  event.preventDefault();
  openInNewTab(link.href);
}

function openContentLinksInNewTabs(root) {
  for (const link of root.querySelectorAll?.("a[href]") || []) {
    link.target = "_blank";
    link.rel = mergeLinkRel(link.rel);
  }
}

function openInNewTab(url) {
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
    opened.focus?.();
    return;
  }
  window.location.href = url;
}

function mergeLinkRel(value) {
  const rel = new Set(String(value || "").split(/\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  return Array.from(rel).join(" ");
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
