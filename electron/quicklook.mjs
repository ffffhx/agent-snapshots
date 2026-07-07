import { BrowserWindow, ipcMain, screen } from "electron";

const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT = 420;
const POPOVER_GAP = 8;
const POPOVER_PARTITION = "quicklook-popover";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function dataUrlForHtml(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function clamp(value, min, max) {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(value, max));
}

function isUsableTrayBounds(bounds) {
  return bounds
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
}

function workAreaForTray(bounds) {
  const point = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  return screen.getDisplayNearestPoint(point).workArea;
}

function popoverBoundsForTray(bounds) {
  const area = workAreaForTray(bounds);
  const width = Math.min(POPOVER_WIDTH, Math.max(240, area.width - POPOVER_GAP * 2));
  const height = Math.min(POPOVER_HEIGHT, Math.max(260, area.height - POPOVER_GAP * 2));
  const x = clamp(
    Math.round(bounds.x + bounds.width / 2 - width / 2),
    area.x + POPOVER_GAP,
    area.x + area.width - width - POPOVER_GAP,
  );
  const belowY = Math.round(bounds.y + bounds.height + POPOVER_GAP);
  const aboveY = Math.round(bounds.y - height - POPOVER_GAP);
  const y = belowY + height <= area.y + area.height - POPOVER_GAP
    ? belowY
    : clamp(aboveY, area.y + POPOVER_GAP, area.y + area.height - height - POPOVER_GAP);
  return { x, y, width, height };
}

function configurePopoverApiRequests(window, baseUrl) {
  let origin = "";
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return;
  }
  window.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: [`${origin}/api/*`] },
    (details, callback) => {
      if (details.webContentsId !== window.webContents.id) {
        callback({});
        return;
      }
      const requestHeaders = { ...details.requestHeaders };
      for (const key of Object.keys(requestHeaders)) {
        if (key.toLowerCase() === "origin") {
          delete requestHeaders[key];
        }
      }
      callback({ requestHeaders });
    },
  );
}

function renderQuickLookHtml(baseUrl) {
  const safeBase = String(baseUrl || "").replace(/\/+$/, "");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Snapshots Quick Look</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #1c150e;
      --panel: #251b11;
      --line: rgba(241, 222, 188, 0.12);
      --line-strong: rgba(241, 222, 188, 0.2);
      --text: #f4e7cc;
      --soft: #c7b38d;
      --faint: #8e7d61;
      --accent: #d7a247;
      --green: #83c77b;
      --warn: #d49b45;
      --danger: #d55c43;
      --shadow: rgba(0, 0, 0, 0.34);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      --sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      background: var(--bg);
      color: var(--text);
      font: 12px/1.35 var(--sans);
      letter-spacing: 0;
      user-select: none;
    }
    button {
      font: inherit;
      color: inherit;
    }
    .shell {
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(241, 222, 188, 0.16);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0) 30%),
        var(--bg);
      box-shadow: 0 18px 44px var(--shadow);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px 10px;
      border-bottom: 1px solid var(--line);
    }
    .brand {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .title {
      color: var(--text);
      font-weight: 800;
      font-size: 13px;
      line-height: 1.2;
    }
    .base {
      max-width: 190px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--faint);
      font: 10.5px/1.2 var(--mono);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      color: var(--soft);
      font: 11px/1.2 var(--mono);
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 0 0 3px rgba(131, 199, 123, 0.13);
    }
    .content {
      min-height: 0;
      flex: 1;
      overflow: auto;
      padding: 12px 12px 10px;
    }
    .section + .section {
      margin-top: 14px;
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 0 2px 8px;
      color: #dac79f;
      font-weight: 800;
      font-size: 11px;
    }
    .count {
      color: var(--faint);
      font: 10.5px/1 var(--mono);
    }
    .quota-grid {
      display: grid;
      gap: 9px;
    }
    .meter {
      display: grid;
      gap: 5px;
      padding: 9px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(255, 248, 231, 0.035);
    }
    .meter-top, .meter-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }
    .meter-label {
      color: var(--text);
      font-weight: 800;
    }
    .meter-value {
      color: var(--accent);
      font: 800 12px/1 var(--mono);
    }
    .meter-track {
      position: relative;
      height: 8px;
      overflow: hidden;
      border-radius: 99px;
      background: rgba(241, 222, 188, 0.12);
      box-shadow: inset 0 0 0 1px rgba(241, 222, 188, 0.06);
    }
    .meter-fill {
      display: block;
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: var(--green);
      transition: width 180ms ease;
    }
    .meter.warn .meter-fill { background: var(--warn); }
    .meter.danger .meter-fill { background: var(--danger); }
    .meter-meta {
      color: var(--faint);
      font: 10px/1.25 var(--mono);
    }
    .list {
      display: grid;
      gap: 6px;
    }
    .row {
      width: 100%;
      display: grid;
      grid-template-columns: 23px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      padding: 8px 9px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: rgba(255, 248, 231, 0.035);
      text-align: left;
      cursor: default;
    }
    .row:hover, .row:focus-visible {
      outline: none;
      border-color: var(--line-strong);
      background: rgba(215, 162, 71, 0.12);
    }
    .badge {
      width: 23px;
      height: 23px;
      display: grid;
      place-items: center;
      border-radius: 7px;
      color: #21180f;
      background: #d8c49b;
      font: 900 11px/1 var(--mono);
    }
    .badge.claude { background: #c58d5a; }
    .badge.trae { background: #7fb8b1; }
    .row-main {
      min-width: 0;
      display: grid;
      gap: 2px;
    }
    .row-title-line {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .live-dot {
      width: 7px;
      height: 7px;
      flex: 0 0 auto;
      border-radius: 999px;
      background: var(--green);
      box-shadow: 0 0 0 rgba(131, 199, 123, 0.28);
      animation: pulse 1.35s ease-out infinite;
    }
    .row-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text);
      font-weight: 750;
      font-size: 12px;
    }
    .row-sub {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--faint);
      font: 10.5px/1.25 var(--mono);
    }
    .empty, .service {
      display: grid;
      place-items: center;
      min-height: 44px;
      padding: 12px;
      color: var(--faint);
      border: 1px dashed var(--line);
      border-radius: 8px;
      text-align: center;
    }
    .service {
      min-height: 210px;
      gap: 6px;
      align-content: center;
    }
    .service-title {
      color: var(--text);
      font-weight: 800;
      font-size: 14px;
    }
    .service-copy {
      color: var(--faint);
      font-size: 11px;
    }
    .skeleton {
      position: relative;
      overflow: hidden;
      background: rgba(241, 222, 188, 0.07);
    }
    .skeleton::after {
      content: "";
      position: absolute;
      inset: 0;
      transform: translateX(-100%);
      background: linear-gradient(90deg, transparent, rgba(241, 222, 188, 0.08), transparent);
      animation: sweep 1.2s ease-in-out infinite;
    }
    .meter.skeleton { height: 61px; }
    .row.skeleton { height: 42px; border-color: transparent; }
    .foot {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      padding: 10px 12px 12px;
      border-top: 1px solid var(--line);
      background: rgba(18, 13, 8, 0.2);
    }
    .foot button {
      min-width: 0;
      height: 32px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: rgba(255, 248, 231, 0.05);
      color: var(--text);
      font-weight: 800;
      cursor: default;
    }
    .foot button:hover, .foot button:focus-visible {
      outline: none;
      background: rgba(215, 162, 71, 0.16);
      border-color: rgba(215, 162, 71, 0.42);
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(131, 199, 123, 0.28); }
      80%, 100% { box-shadow: 0 0 0 7px rgba(131, 199, 123, 0); }
    }
    @keyframes sweep {
      100% { transform: translateX(100%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .live-dot, .skeleton::after { animation: none; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="head">
      <div class="brand">
        <div class="title">快速查看</div>
        <div class="base">${escapeHtml(safeBase)}</div>
      </div>
      <div class="status"><span class="status-dot"></span><span id="stateText">载入中</span></div>
    </header>
    <main id="content" class="content" aria-live="polite">
      <section class="section">
        <div class="section-head"><span>配额</span><span class="count">Codex</span></div>
        <div class="quota-grid"><div class="meter skeleton"></div><div class="meter skeleton"></div></div>
      </section>
      <section class="section">
        <div class="section-head"><span>进行中</span><span class="count">--</span></div>
        <div class="list"><div class="row skeleton"></div><div class="row skeleton"></div></div>
      </section>
      <section class="section">
        <div class="section-head"><span>最近</span><span class="count">--</span></div>
        <div class="list"><div class="row skeleton"></div><div class="row skeleton"></div><div class="row skeleton"></div></div>
      </section>
    </main>
    <footer class="foot">
      <button type="button" data-action="launcher">打开启动器</button>
      <button type="button" data-action="viewer">完整视图</button>
    </footer>
  </div>
  <script>
    window.__QUICKLOOK_BASE__ = ${JSON.stringify(safeBase)};
    (function () {
      const base = window.__QUICKLOOK_BASE__;
      const content = document.getElementById("content");
      const stateText = document.getElementById("stateText");

      function esc(value) {
        return String(value == null ? "" : value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function api(path) {
        return base + path;
      }

      async function fetchJson(path) {
        const response = await fetch(api(path), { headers: { accept: "application/json" }, cache: "no-store" });
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      }

      function normalizePercent(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
          return NaN;
        }
        const percent = number >= 0 && number <= 1 ? number * 100 : number;
        return Math.max(0, Math.min(100, percent));
      }

      function formatWindow(minutes) {
        const value = Number(minutes || 0);
        if (!Number.isFinite(value) || value <= 0) {
          return "窗口未知";
        }
        if (value >= 60 * 24 * 6) {
          return "周窗口";
        }
        if (value >= 60) {
          return Math.round(value / 60) + "h 窗口";
        }
        return Math.round(value) + "m 窗口";
      }

      function resetText(value) {
        if (!value) {
          return "重置未知";
        }
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) {
          return "重置未知";
        }
        return new Intl.DateTimeFormat("zh-CN", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
          .format(date)
          .replace(/^24:/, "00:");
      }

      function relTime(value) {
        if (!value) {
          return "";
        }
        const date = new Date(value);
        const time = date.getTime();
        if (!Number.isFinite(time)) {
          return "";
        }
        const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
        if (seconds < 60) return "刚刚";
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return minutes + "分钟前";
        const hours = Math.round(minutes / 60);
        if (hours < 24) return hours + "小时前";
        const days = Math.round(hours / 24);
        if (days < 10) return days + "天前";
        return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
      }

      function engineKey(item) {
        const value = String(item && item.engine || "").toLowerCase();
        return value === "claude" || value === "trae" ? value : "codex";
      }

      function engineLabel(item) {
        const key = engineKey(item);
        if (key === "claude") return "C";
        if (key === "trae") return "T";
        return "X";
      }

      function sessionRef(item) {
        if (!item) return "";
        const ref = String(item.ref || "").trim();
        if (ref) return ref;
        const id = String(item.id || "").trim();
        return id ? engineKey(item) + ":" + id : "";
      }

      function sessionProject(item) {
        const value = String(item && (item.displayCwd || item.cwd) || "").replace(/[\\\\/]+$/, "");
        const parts = value.split(/[\\\\/]/).filter(Boolean);
        return parts.pop() || "无项目";
      }

      function sessionTitle(item) {
        return String(item && (item.title || item.ref || item.id) || "").trim() || "未命名会话";
      }

      function quotaMeter(label, part) {
        const pct = normalizePercent(part && part.usedPercent);
        const shown = Number.isFinite(pct) ? Math.round(pct) : 0;
        const level = shown > 85 ? "danger" : shown > 60 ? "warn" : "ok";
        const metaLeft = part ? resetText(part.resetsAt) : "暂无数据";
        const metaRight = part ? formatWindow(part.windowMinutes) : "--";
        return "<div class='meter " + level + "'>" +
          "<div class='meter-top'><span class='meter-label'>" + esc(label) + "</span><span class='meter-value'>" + esc(String(shown)) + "%</span></div>" +
          "<div class='meter-track'><span class='meter-fill' style='width:" + esc(String(shown)) + "%'></span></div>" +
          "<div class='meter-meta'><span>" + esc(metaLeft) + "</span><span>" + esc(metaRight) + "</span></div>" +
        "</div>";
      }

      function renderQuota(quota) {
        const enabled = quota && quota.available !== false;
        return "<section class='section'>" +
          "<div class='section-head'><span>配额</span><span class='count'>" + esc(enabled && quota.planType ? quota.planType : "Codex") + "</span></div>" +
          "<div class='quota-grid'>" +
            quotaMeter("5h", enabled ? quota.primary : null) +
            quotaMeter("周", enabled ? quota.secondary : null) +
          "</div>" +
        "</section>";
      }

      function renderRows(rows, live) {
        if (!rows.length) {
          return "<div class='empty'>" + (live ? "暂无进行中的会话" : "暂无最近会话") + "</div>";
        }
        return "<div class='list'>" + rows.map(function (item) {
          const ref = sessionRef(item);
          const title = sessionTitle(item);
          const project = sessionProject(item);
          const age = relTime(item.mtime || item.updatedAt || item.createdAt);
          const sub = [project, age].filter(Boolean).join(" · ");
          const dot = live ? "<span class='live-dot' aria-hidden='true'></span>" : "";
          const disabled = ref ? "" : " disabled";
          return "<button type='button' class='row' data-ref='" + esc(ref) + "'" + disabled + " title='" + esc(title) + "'>" +
            "<span class='badge " + esc(engineKey(item)) + "'>" + esc(engineLabel(item)) + "</span>" +
            "<span class='row-main'>" +
              "<span class='row-title-line'>" + dot + "<span class='row-title'>" + esc(title) + "</span></span>" +
              "<span class='row-sub'>" + esc(sub || project) + "</span>" +
            "</span>" +
          "</button>";
        }).join("") + "</div>";
      }

      function renderListSection(title, rows, live) {
        return "<section class='section'>" +
          "<div class='section-head'><span>" + esc(title) + "</span><span class='count'>" + esc(String(rows.length)) + "</span></div>" +
          renderRows(rows, live) +
        "</section>";
      }

      function renderServiceDown() {
        stateText.textContent = "未就绪";
        content.innerHTML = "<div class='service'>" +
          "<div class='service-title'>服务未就绪</div>" +
          "<div class='service-copy'>本地查看器启动后会自动可用</div>" +
        "</div>";
      }

      async function load() {
        try {
          const livePath = "/api/sessions?liveOnly=1&completeOnly=0&source=all&limit=8";
          const recentPath = "/api/sessions?limit=5&source=all";
          const results = await Promise.all([
            fetchJson("/api/quota"),
            fetchJson(livePath),
            fetchJson(recentPath),
          ]);
          const liveRows = Array.isArray(results[1]) ? results[1].filter(function (item) { return !!sessionRef(item); }) : [];
          const recentRows = Array.isArray(results[2]) ? results[2].filter(function (item) { return !!sessionRef(item); }).slice(0, 5) : [];
          stateText.textContent = "已更新";
          content.innerHTML = [
            renderQuota(results[0]),
            renderListSection("进行中", liveRows, true),
            renderListSection("最近", recentRows, false),
          ].join("");
        } catch (error) {
          renderServiceDown();
        }
      }

      document.addEventListener("click", function (event) {
        const target = event.target && event.target.closest ? event.target : null;
        if (!target) {
          return;
        }
        const action = target.closest("[data-action]");
        if (action) {
          if (action.dataset.action === "launcher" && window.quicklook) window.quicklook.openLauncher();
          if (action.dataset.action === "viewer" && window.quicklook) window.quicklook.openViewer();
          return;
        }
        const row = target.closest("[data-ref]");
        if (row && row.dataset.ref && window.quicklook) {
          window.quicklook.openSession(row.dataset.ref);
        }
      });

      load();
    }());
  </script>
</body>
</html>`;
}

export function createQuickLookController({
  getBaseUrl,
  getTray,
  isMac = process.platform === "darwin",
  onError = console.warn,
  openLauncher,
  openSession,
  openViewer,
  preloadPath,
} = {}) {
  let popoverWindow = null;
  let ipcRegistered = false;

  function ownsEvent(event) {
    return popoverWindow
      && !popoverWindow.isDestroyed()
      && event.sender.id === popoverWindow.webContents.id;
  }

  function registerIpc() {
    if (ipcRegistered) {
      return;
    }
    ipcRegistered = true;
    ipcMain.handle("quicklook:open-session", (event, ref) => {
      if (!ownsEvent(event)) {
        return false;
      }
      hide();
      openSession?.(String(ref || ""));
      return true;
    });
    ipcMain.handle("quicklook:open-launcher", (event) => {
      if (!ownsEvent(event)) {
        return false;
      }
      hide();
      openLauncher?.();
      return true;
    });
    ipcMain.handle("quicklook:open-viewer", (event) => {
      if (!ownsEvent(event)) {
        return false;
      }
      hide();
      openViewer?.();
      return true;
    });
  }

  function createWindow(baseUrl) {
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      return popoverWindow;
    }
    registerIpc();
    popoverWindow = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: POPOVER_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      backgroundColor: "#1c150e",
      title: "Agent Snapshots Quick Look",
      ...(isMac ? { acceptFirstMouse: true, type: "panel" } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: POPOVER_PARTITION,
        preload: preloadPath,
      },
    });
    popoverWindow.setMenuBarVisibility(false);
    configurePopoverApiRequests(popoverWindow, baseUrl);
    popoverWindow.on("blur", () => hide());
    popoverWindow.on("closed", () => {
      popoverWindow = null;
    });
    popoverWindow.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        event.preventDefault();
        hide();
      }
    });
    return popoverWindow;
  }

  function hide() {
    if (popoverWindow && !popoverWindow.isDestroyed() && popoverWindow.isVisible()) {
      popoverWindow.hide();
    }
  }

  async function show() {
    const tray = getTray?.();
    const trayBounds = tray?.getBounds?.();
    if (!isUsableTrayBounds(trayBounds)) {
      return false;
    }
    const baseUrl = getBaseUrl?.();
    if (!baseUrl) {
      return false;
    }
    try {
      const window = createWindow(baseUrl);
      window.setBounds(popoverBoundsForTray(trayBounds), false);
      await window.loadURL(dataUrlForHtml(renderQuickLookHtml(baseUrl)), { baseURLForDataURL: baseUrl });
      window.show();
      window.focus();
      return true;
    } catch (error) {
      onError?.("Failed to show quick-look popover:", error);
      return false;
    }
  }

  async function toggle() {
    if (popoverWindow && !popoverWindow.isDestroyed() && popoverWindow.isVisible()) {
      hide();
      return true;
    }
    return show();
  }

  function destroy() {
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      popoverWindow.destroy();
    }
    popoverWindow = null;
  }

  return {
    destroy,
    hide,
    show,
    toggle,
  };
}
