// @ts-nocheck

import { MUTATION_CSRF_HEADER } from "../../local-security.js";

export const sharingActionsJs = `function openContentLinksInNewTabs(root) {
  for (const link of root.querySelectorAll("a[href]")) {
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
  const rel = new Set(String(value || "").split(/\\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  return Array.from(rel).join(" ");
}

function shareApiBaseUrl() {
  return String(shareConfig.apiUrl || "").replace(/\\/+$/, "");
}

function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatFetchError(error) {
  if (error?.name === "AbortError") {
    return "请求超时，请检查分享 API 是否可访问。";
  }
  const message = messageFromError(error);
  if (message === "Failed to fetch") {
    return "网络请求失败，可能是分享 API 不可访问、CORS 未放行，或浏览器插件/代理拦截。";
  }
  return message;
}

async function fetchJsonRequest(url, options, label) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 12000) : 0;
  let response;
  try {
    response = await fetch(url, controller ? { ...(options || {}), signal: controller.signal } : options);
  } catch (error) {
    throw new Error(label + "失败：" + formatFetchError(error));
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response || typeof response.text !== "function") {
    throw new Error(label + "失败：浏览器没有返回有效响应，请检查插件或代理是否改写了 fetch。");
  }

  const text = await response.text();
  let payload = {};
  if (String(text || "").trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!response.ok) {
        payload = { error: String(text).trim().slice(0, 240) };
      } else {
        throw new Error(label + "失败：服务返回的不是 JSON。");
      }
    }
  }

  return { response, payload };
}

async function fetchShareAuth(apiUrl) {
  const { response, payload } = await fetchJsonRequest(apiUrl + "/api/auth/me?returnTo=" + encodeURIComponent(window.location.href), {
    cache: "no-store",
    credentials: "include",
  }, "检查 GitHub 登录");
  if (!response.ok) {
    throw new Error(payload.error || "检查 GitHub 登录失败：HTTP " + response.status);
  }
  return payload;
}

function redirectToShareLogin(apiUrl, auth) {
  const loginUrl = auth?.loginUrl || apiUrl + "/api/auth/github/start?returnTo=" + encodeURIComponent(window.location.href);
  window.location.href = loginUrl;
}

async function copyShareUrlToClipboard(url) {
  return copyTextToClipboard(url);
}

async function copyTextToClipboard(value) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {}
  }
  return copyTextWithSelection(text);
}

async function copyFilePath(path) {
  const copied = await copyTextToClipboard(path);
  showToast(copied ? "已复制路径" : "复制路径失败", !copied);
}

async function revealFilePath(path) {
  const targetPath = String(path || "").trim();
  if (!targetPath) {
    return;
  }
  showToast("正在打开文件位置...", false);
  try {
    const params = new URLSearchParams({ path: targetPath });
    const response = await fetch("/api/reveal-in-file?" + params.toString(), {
      method: "POST",
      headers: { "${MUTATION_CSRF_HEADER}": csrfToken },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.ok) {
      showToast(data.message || "已打开文件位置", false);
    } else {
      showToast(data.error || (response.status === 404 ? "路径不存在" : "打开文件位置失败"), true);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
}

function handleFilePathAction(target, event) {
  const path = target?.dataset?.filePath || "";
  if (!path) {
    return;
  }
  if (event?.metaKey) {
    revealFilePath(path);
  } else {
    copyFilePath(path);
  }
}

function copyTextWithSelection(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    try {
      textarea.focus({ preventScroll: true });
    } catch (_error) {
      textarea.focus();
    }
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy") === true;
  } catch (_error) {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

let toastTimer = 0;
function showToast(message, isError) {
  const el = $("toast");
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.toggle("error", !!isError);
  el.hidden = false;
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

async function resumeInOrca(ref, cwd, title) {
  if (!ref || !(ref.startsWith("codex:") || ref.startsWith("claude:"))) {
    showToast("该会话无法在 Orca 中恢复（仅支持 Codex / Claude）", true);
    return;
  }
  showToast("正在唤起 Orca...", false);
  try {
    const params = new URLSearchParams({ id: ref, cwd: cwd || "", title: title || "" });
    const response = await fetch("/api/resume-in-orca?" + params.toString(), {
      method: "POST",
      headers: { "${MUTATION_CSRF_HEADER}": csrfToken },
    });
    const data = await response.json();
    if (response.ok && data.ok) {
      showToast(data.via === "terminal" ? "Orca 不可用，已在 " + (data.app || "Terminal") + " 打开" : "已在 Orca 继续", false);
    } else {
      showToast(data.error || "恢复失败", true);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
}

async function publishSelectedSession() {
  if (!state.selected) {
    return;
  }
  const status = $("publishStatus");
  const button = document.querySelector("[data-publish-cloud]");
  if (button) button.disabled = true;
  if (status) {
    status.textContent = shareConfig.apiUrl ? "正在检查 GitHub 登录..." : "正在发布...";
    status.classList.remove("error", "warning");
  }
  try {
    const apiUrl = shareApiBaseUrl();
    if (!apiUrl) {
      throw new Error("分享 API 尚未配置。");
    }
    const auth = await fetchShareAuth(apiUrl);
    if (!auth.configured) {
      throw new Error("分享 API 尚未配置 GitHub 登录。");
    }
    if (!auth.user) {
      if (status) {
        status.textContent = "请先登录 GitHub，登录后会回到这里继续发布。";
      }
      redirectToShareLogin(apiUrl, auth);
      return;
    }
    if (status) {
      status.textContent = "正在发布到 " + apiUrl + "...";
    }
    const options = activeOptions();
    options.set("redact", "1");
    const payloadResult = await fetchJsonRequest("/api/share-payload?" + options.toString(), {
      method: "POST",
      headers: { "${MUTATION_CSRF_HEADER}": csrfToken },
    }, "生成分享内容");
    const payload = payloadResult.payload;
    if (!payloadResult.response.ok) {
      throw new Error(payload.error || "生成分享内容失败：HTTP " + payloadResult.response.status);
    }
    const publishResult = await fetchJsonRequest(String(payload.apiUrl || apiUrl).replace(/\\/+$/, "") + "/api/snapshots", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload.body || {}),
    }, "发布快照");
    const response = publishResult.response;
    const result = publishResult.payload;
    if (!response.ok) {
      if (response.status === 401) {
        redirectToShareLogin(apiUrl, auth);
        return;
      }
      throw new Error(result.error || "发布快照失败：HTTP " + response.status);
    }
    const shareUrl = String(result.url || "");
    if (!shareUrl) {
      throw new Error("发布响应未返回分享链接。");
    }
    const copied = await copyShareUrlToClipboard(shareUrl);
    if (status) {
      status.classList.toggle("warning", !copied);
      status.innerHTML = (copied ? "已复制到剪切板：" : "已发布，复制失败，请手动复制：") +
        " <a href='" + esc(shareUrl) + "' target='_blank' rel='noopener noreferrer'>" + esc(shareUrl) + "</a>";
    }
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.classList.add("error");
      status.classList.remove("warning");
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function gistPublishToastMessage(code, fallback) {
  if (code === "gh_not_installed") {
    return "未找到 GitHub CLI（gh），请先安装后重试";
  }
  if (code === "gh_not_authenticated") {
    return "GitHub CLI 未登录，请先运行 gh auth login";
  }
  if (code === "network_failure") {
    return "网络连接失败，Gist 发布未完成";
  }
  return fallback || "Gist 发布失败";
}

async function publishSelectedSessionGist() {
  if (!state.selected) {
    return;
  }
  const status = $("publishStatus");
  const button = document.querySelector("[data-publish-gist]");
  if (button) button.disabled = true;
  if (status) {
    status.textContent = "正在发布 Gist...";
    status.classList.remove("error", "warning");
  }
  try {
    const { response, payload } = await fetchJsonRequest("/api/publish-gist", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "${MUTATION_CSRF_HEADER}": csrfToken,
      },
      body: JSON.stringify({ id: state.selected }),
    }, "发布 Gist");
    if (!response.ok || !payload.ok) {
      const message = gistPublishToastMessage(payload.code, payload.error || "Gist 发布失败：HTTP " + response.status);
      if (status) {
        status.textContent = message;
        status.classList.add("error");
        status.classList.remove("warning");
      }
      showToast(message, true);
      return;
    }
    const gistUrl = String(payload.url || "");
    if (!gistUrl) {
      throw new Error("Gist 发布响应未返回链接。");
    }
    const copied = await copyShareUrlToClipboard(gistUrl);
    if (status) {
      status.classList.toggle("warning", !copied);
      status.classList.remove("error");
      status.innerHTML = (copied ? "Gist 已发布，链接已复制：" : "Gist 已发布，复制失败，请手动复制：") +
        " <a href='" + esc(gistUrl) + "' target='_blank' rel='noopener noreferrer'>" + esc(gistUrl) + "</a>";
    }
    showToast(copied ? "Gist 已发布，链接已复制" : "Gist 已发布，复制链接失败", !copied);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (status) {
      status.textContent = message;
      status.classList.add("error");
      status.classList.remove("warning");
    }
    showToast(message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

function formatRiskTurns(risk) {
  const turns = Array.isArray(risk.turns) ? risk.turns : [];
  const visibleTurns = turns.slice(0, 18).join(", ");
  const hiddenCount = Math.max(0, turns.length - 18);
  const suffix = hiddenCount ? ", +" + hiddenCount + " more" : "";
  return risk.count + " match(es)" + (turns.length ? ", turns " + visibleTurns + suffix : "");
}

`;
