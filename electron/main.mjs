// Electron main process for the Agent Snapshots desktop app.
//
// Strategy: reuse the existing local viewer server verbatim. We spawn the
// packaged CLI (`agent-snapshot serve`) as a child process using Electron's
// bundled Node runtime (ELECTRON_RUN_AS_NODE=1), wait for it to come up on a
// free localhost port, then point a native BrowserWindow at it. This keeps
// 100% of the web app's behaviour while giving it a real desktop window.

import { app, BrowserWindow, Menu, shell, dialog, nativeImage, Tray, globalShortcut, screen, Notification } from "electron";
import { spawn } from "node:child_process";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SettingsStore } from "./settings-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The app root holds both electron/ and dist/ as siblings, in dev and when
// packaged (resources/app/...). Deriving it from this file keeps the CLI path
// correct in both cases, unlike app.getAppPath() which varies by launch mode.
const APP_ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const PREFERRED_PORT = 4321;
const DEEP_LINK_PROTOCOL = "agent-snapshots";
const GLOBAL_SHORTCUT = "Alt+Space";
const POLL_INTERVAL_MS = 5000;
const DEFAULT_SETTINGS = {
  hideOnBlur: true,
  openAtLogin: false,
  launcherBounds: null,
};
// The app logo, so the dev-mode window/dock shows our mark instead of the
// default Electron atom (the packaged .app already embeds build/icon.icns).
const APP_ICON = nativeImage.createFromPath(path.join(APP_ROOT, "build", "icon.png"));

let serverProcess = null;
let serverPort = 0;
let startUrl = "";
let mainWindow = null;
let viewerWindow = null;
let tray = null;
let settings = null;
let quitting = false;
let launcherBoundsTimer = null;
let launcherDragUntil = 0;
let pollTimer = null;
let pollInFlight = false;
let hasPollBaseline = false;
let liveSessionIds = new Set();
let liveSessionById = new Map();
let unseenCompletionCount = 0;
const pendingDeepLinks = [];

/** Path to the built CLI entrypoint, resolved for both dev and packaged runs. */
function cliEntry() {
  return path.join(APP_ROOT, "dist", "cli", "agent-snapshot.mjs");
}

/** Return true when a TCP port can be bound on the loopback interface. */
function canBindPort(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(port, HOST, () => {
      probe.close(() => resolve(true));
    });
  });
}

/** Grab an available TCP port on the loopback interface, preferring 4321. */
async function findFreePort() {
  if (await canBindPort(PREFERRED_PORT)) {
    return PREFERRED_PORT;
  }
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Resolve once the local server answers an HTTP request (or reject on timeout). */
function waitForServer(port, timeoutMs = 20000) {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: HOST, port, path: "/favicon.svg", timeout: 1500 },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (performance.now() - started > timeoutMs) {
        reject(new Error("local viewer server did not start in time"));
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

/** Launch the local viewer server as a child process and wait until it's ready. */
async function startServer() {
  serverPort = await findFreePort();
  const args = [cliEntry(), "serve", "--host", HOST, "--port", String(serverPort)];
  serverProcess = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  serverProcess.on("exit", (code, signal) => {
    serverProcess = null;
    if (!quitting) {
      dialog.showErrorBox(
        "Agent Snapshots",
        `本地查看器服务意外停止（代码 ${code ?? "?"}，信号 ${signal ?? "none"}）。`,
      );
      app.quit();
    }
  });

  await waitForServer(serverPort);
  return `http://${HOST}:${serverPort}/`;
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

const isMac = process.platform === "darwin";

function setting(key) {
  return settings?.get(key, DEFAULT_SETTINGS[key]) ?? DEFAULT_SETTINGS[key];
}

function writeSetting(key, value) {
  try {
    settings?.set(key, value);
  } catch (error) {
    console.warn(`Failed to write setting ${key}:`, error);
  }
}

function appOrigin() {
  if (!startUrl) {
    return "";
  }
  try {
    return new URL(startUrl).origin;
  } catch {
    return "";
  }
}

function isAppUrl(url) {
  try {
    return new URL(url).origin === appOrigin();
  } catch {
    return false;
  }
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function rectIntersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function sanitizeBounds(rawBounds) {
  if (!rawBounds || typeof rawBounds !== "object") {
    return null;
  }
  const width = Math.round(Number(rawBounds.width));
  const height = Math.round(Number(rawBounds.height));
  const x = Math.round(Number(rawBounds.x));
  const y = Math.round(Number(rawBounds.y));
  if (![x, y, width, height].every(Number.isFinite) || width < 560 || height < 380) {
    return null;
  }
  const displays = screen.getAllDisplays();
  const matchingDisplay = displays.find((display) => rectIntersects({ x, y, width, height }, display.workArea))
    || screen.getPrimaryDisplay();
  const area = matchingDisplay.workArea;
  const nextWidth = Math.min(width, area.width);
  const nextHeight = Math.min(height, area.height);
  return {
    x: Math.max(area.x, Math.min(x, area.x + area.width - nextWidth)),
    y: Math.max(area.y, Math.min(y, area.y + area.height - nextHeight)),
    width: nextWidth,
    height: nextHeight,
  };
}

function saveLauncherBoundsNow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  writeSetting("launcherBounds", mainWindow.getBounds());
}

function scheduleLauncherBoundsSave() {
  if (launcherBoundsTimer) {
    clearTimeout(launcherBoundsTimer);
  }
  launcherBoundsTimer = setTimeout(() => {
    launcherBoundsTimer = null;
    saveLauncherBoundsNow();
  }, 250);
  launcherBoundsTimer.unref?.();
}

function centerWindowOnCursor(window) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const current = window.getBounds();
  const width = Math.min(Math.max(current.width, 560), area.width);
  const height = Math.min(Math.max(current.height, 380), area.height);
  window.setBounds({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
  });
  saveLauncherBoundsNow();
}

// The full reading view, opened in a larger window from the launcher.
function viewerWindowOptions() {
  return {
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#231d12",
    icon: APP_ICON,
    title: "Agent Snapshots",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  };
}

function launcherWindowOptions() {
  const bounds = sanitizeBounds(setting("launcherBounds"));
  return {
    ...(bounds || { width: 800, height: 560, center: true }),
    minWidth: 560,
    minHeight: 380,
    resizable: true,
    backgroundColor: isMac ? "#00000000" : "#1c150e",
    vibrancy: isMac ? "under-window" : undefined,
    visualEffectState: "active",
    icon: APP_ICON,
    title: "Agent Snapshots",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}

function configureWindowNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      openViewerUrl(url);
      return { action: "deny" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function createLauncherWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  // The app is a search + resume launcher first (Raycast/Spotlight style): a
  // small, focused window. The full transcript view opens in its own window.
  mainWindow = new BrowserWindow(launcherWindowOptions());

  mainWindow.loadURL(startUrl + "launcher");
  configureWindowNavigation(mainWindow);

  mainWindow.on("close", (event) => {
    saveLauncherBoundsNow();
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("blur", () => {
    setTimeout(() => {
      if (
        setting("hideOnBlur")
        && mainWindow
        && !mainWindow.isDestroyed()
        && mainWindow.isVisible()
        && !mainWindow.isFocused()
        && !mainWindow.webContents.isDevToolsOpened()
        && Date.now() > launcherDragUntil
      ) {
        saveLauncherBoundsNow();
        mainWindow.hide();
      }
    }, 160).unref?.();
  });

  mainWindow.on("will-move", () => {
    launcherDragUntil = Date.now() + 800;
  });
  mainWindow.on("move", () => {
    launcherDragUntil = Date.now() + 800;
    scheduleLauncherBoundsSave();
  });
  mainWindow.on("resize", scheduleLauncherBoundsSave);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createViewerWindow() {
  if (viewerWindow && !viewerWindow.isDestroyed()) {
    return viewerWindow;
  }
  viewerWindow = new BrowserWindow(viewerWindowOptions());
  configureWindowNavigation(viewerWindow);
  viewerWindow.on("closed", () => {
    viewerWindow = null;
  });
  return viewerWindow;
}

function openViewerUrl(url) {
  if (!startUrl) {
    pendingDeepLinks.push(url);
    return;
  }
  if (!isAppUrl(url)) {
    shell.openExternal(url);
    return;
  }
  const window = createViewerWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  window.loadURL(url);
  window.show();
  window.focus();
}

function openViewerForSession(ref = "") {
  if (!startUrl) {
    pendingDeepLinks.push(`${DEEP_LINK_PROTOCOL}://session/${encodeURIComponent(ref)}`);
    return;
  }
  const url = new URL(startUrl);
  if (ref) {
    url.searchParams.set("session", ref);
  }
  openViewerUrl(url.toString());
}

function showLauncherWindow({ centerOnCursor = true } = {}) {
  if (!app.isReady() || !startUrl) {
    pendingDeepLinks.push(`${DEEP_LINK_PROTOCOL}://launcher`);
    return;
  }
  const window = createLauncherWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  if (centerOnCursor) {
    centerWindowOnCursor(window);
  }
  window.show();
  if (isMac) {
    app.focus({ steal: true });
  }
  window.focus();
}

function toggleLauncherWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
    saveLauncherBoundsNow();
    mainWindow.hide();
    return;
  }
  showLauncherWindow({ centerOnCursor: true });
}

function setHideOnBlur(enabled) {
  writeSetting("hideOnBlur", Boolean(enabled));
  rebuildTrayMenu();
}

function setOpenAtLogin(enabled, { persist = true } = {}) {
  const openAtLogin = Boolean(enabled);
  try {
    app.setLoginItemSettings({ openAtLogin });
  } catch (error) {
    console.warn("Failed to update login item setting:", error);
  }
  if (persist) {
    writeSetting("openAtLogin", openAtLogin);
  }
  rebuildTrayMenu();
}

function createTray() {
  try {
    const trayIcon = APP_ICON.resize({ width: 18, height: 18 });
    if (isMac) {
      trayIcon.setTemplateImage(true);
    }
    tray = new Tray(trayIcon);
    tray.setToolTip("Agent Snapshots");
    tray.on("click", toggleLauncherWindow);
    rebuildTrayMenu();
  } catch (error) {
    tray = null;
    console.warn("Failed to create tray icon:", error);
  }
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示/隐藏启动器 (⌥Space)", click: toggleLauncherWindow },
    { label: "打开完整视图", click: () => openViewerForSession() },
    { label: "在浏览器打开", click: () => startUrl && shell.openExternal(startUrl) },
    { type: "separator" },
    {
      label: "失焦自动隐藏",
      type: "checkbox",
      checked: Boolean(setting("hideOnBlur")),
      click: (item) => setHideOnBlur(item.checked),
    },
    {
      label: "开机自启",
      type: "checkbox",
      checked: Boolean(setting("openAtLogin")),
      click: (item) => setOpenAtLogin(item.checked),
    },
    { type: "separator" },
    { label: "退出", click: requestQuit },
  ]));
}

function registerGlobalShortcut() {
  const registered = globalShortcut.register(GLOBAL_SHORTCUT, toggleLauncherWindow);
  if (!registered) {
    console.warn(`Failed to register global shortcut ${GLOBAL_SHORTCUT}`);
  }
}

function registerDeepLinkProtocol() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
    }
  } catch (error) {
    console.warn(`Failed to register ${DEEP_LINK_PROTOCOL} protocol:`, error);
  }
}

function findDeepLinkArg(argv) {
  return argv.find((arg) => typeof arg === "string" && arg.toLowerCase().startsWith(`${DEEP_LINK_PROTOCOL}://`));
}

function handleDeepLink(rawUrl) {
  if (!rawUrl) {
    return;
  }
  if (!startUrl) {
    pendingDeepLinks.push(rawUrl);
    return;
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== `${DEEP_LINK_PROTOCOL}:`) {
    return;
  }
  if (parsed.hostname === "launcher" || parsed.pathname === "/launcher") {
    showLauncherWindow({ centerOnCursor: true });
    return;
  }
  if (parsed.hostname === "session") {
    const ref = safeDecodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || parsed.searchParams.get("ref") || "";
    if (ref) {
      openViewerForSession(ref);
    } else {
      showLauncherWindow({ centerOnCursor: true });
    }
  }
}

function flushPendingDeepLinks() {
  while (pendingDeepLinks.length) {
    handleDeepLink(pendingDeepLinks.shift());
  }
}

function anyAppWindowFocused() {
  return BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused());
}

function updateDockBadge() {
  if (isMac && app.dock) {
    app.dock.setBadge(unseenCompletionCount > 0 ? String(unseenCompletionCount) : "");
  }
}

function clearUnseenCompletions() {
  if (unseenCompletionCount > 0) {
    unseenCompletionCount = 0;
    updateDockBadge();
  }
}

function sessionRef(session) {
  return session?.ref || (session?.engine && session?.id ? `${session.engine}:${session.id}` : String(session?.id || ""));
}

function isArchivedSessionSummary(session) {
  const filePath = String(session?.filePath || session?.displayFilePath || "");
  return /(^|[\\/])archived_sessions([\\/]|$)/.test(filePath);
}

function sessionProject(session) {
  const cwd = String(session?.displayCwd || session?.cwd || "").replace(/[\\/]+$/, "");
  const project = cwd.split(/[\\/]/).filter(Boolean).pop();
  return project || "无项目";
}

function notifySessionCompletion(session, ref) {
  if (anyAppWindowFocused()) {
    return;
  }
  unseenCompletionCount += 1;
  updateDockBadge();
  if (!Notification.isSupported()) {
    return;
  }
  const title = String(session?.title || ref || "未命名会话").trim() || "未命名会话";
  const notification = new Notification({
    title: "会话完成",
    body: `${title} · ${sessionProject(session)}`,
  });
  notification.on("click", () => openViewerForSession(ref));
  notification.show();
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: HOST, port: serverPort, path: pathname, timeout: 2500, headers: { accept: "application/json" } },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode ?? "?"}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 5_000_000) {
            req.destroy(new Error("response too large"));
          }
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

async function pollSessionCompletions() {
  if (!serverPort || pollInFlight) {
    return;
  }
  pollInFlight = true;
  try {
    const query = new URLSearchParams({
      liveOnly: "1",
      limit: "100",
      source: "all",
      completeOnly: "0",
    });
    const result = await getJson(`/api/sessions?${query.toString()}`);
    if (!Array.isArray(result)) {
      return;
    }
    const nextIds = new Set();
    const nextById = new Map();
    for (const session of result) {
      const ref = sessionRef(session);
      if (!ref || isArchivedSessionSummary(session)) {
        continue;
      }
      nextIds.add(ref);
      nextById.set(ref, session);
    }
    if (!hasPollBaseline) {
      liveSessionIds = nextIds;
      liveSessionById = nextById;
      hasPollBaseline = true;
      return;
    }
    for (const ref of liveSessionIds) {
      if (!nextIds.has(ref)) {
        notifySessionCompletion(liveSessionById.get(ref), ref);
      }
    }
    liveSessionIds = nextIds;
    liveSessionById = nextById;
  } catch {
    // The local server may restart while the app stays alive; try again later.
  } finally {
    pollInFlight = false;
  }
}

function startCompletionPoller() {
  stopCompletionPoller();
  pollSessionCompletions();
  pollTimer = setInterval(pollSessionCompletions, POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

function stopCompletionPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function requestQuit() {
  quitting = true;
  app.quit();
}

function buildMenu(getStartUrl) {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [{
        label: "Agent Snapshots",
        submenu: [
          { role: "about", label: "关于 Agent Snapshots" },
          { type: "separator" },
          { role: "services", label: "服务" },
          { type: "separator" },
          { role: "hide", label: "隐藏 Agent Snapshots" },
          { role: "hideOthers", label: "隐藏其他" },
          { role: "unhide", label: "全部显示" },
          { type: "separator" },
          { role: "quit", label: "退出 Agent Snapshots" },
        ],
      }]
      : []),
    {
      label: "文件",
      submenu: [
        {
          label: "在浏览器打开",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => shell.openExternal(getStartUrl()),
        },
        { type: "separator" },
        isMac ? { role: "close", label: "关闭窗口" } : { role: "quit", label: "退出" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        ...(isMac
          ? [
            { role: "pasteAndMatchStyle", label: "粘贴并匹配样式" },
            { role: "delete", label: "删除" },
            { role: "selectAll", label: "全选" },
          ]
          : [
            { role: "delete", label: "删除" },
            { type: "separator" },
            { role: "selectAll", label: "全选" },
          ]),
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "切换开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切换全屏" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        {
          label: "显示/隐藏启动器",
          accelerator: GLOBAL_SHORTCUT,
          click: toggleLauncherWindow,
        },
        {
          label: "打开完整视图",
          accelerator: "CmdOrCtrl+0",
          click: () => openViewerForSession(),
        },
        { type: "separator" },
        { role: "minimize", label: "最小化" },
        ...(isMac
          ? [
            { role: "zoom", label: "缩放" },
            { type: "separator" },
            { role: "front", label: "全部置于前台" },
          ]
          : [
            { role: "close", label: "关闭" },
          ]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrap() {
  settings = new SettingsStore(path.join(app.getPath("userData"), "settings.json"), DEFAULT_SETTINGS);
  if (setting("openAtLogin")) {
    setOpenAtLogin(true, { persist: false });
  }
  // macOS shows the dock icon from the .app bundle; in dev there is none, so
  // set it explicitly (also covers `electron .` runs).
  if (process.platform === "darwin" && app.dock && !APP_ICON.isEmpty()) {
    app.dock.setIcon(APP_ICON);
  }
  try {
    startUrl = await startServer();
  } catch (error) {
    dialog.showErrorBox(
      "Agent Snapshots",
      `本地查看器服务启动失败：\n\n${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
    return;
  }
  buildMenu(() => startUrl);
  createTray();
  registerGlobalShortcut();
  createLauncherWindow();
  startCompletionPoller();
  flushPendingDeepLinks();

  app.on("activate", () => {
    showLauncherWindow({ centerOnCursor: false });
  });
}

// Single-instance lock so we don't spawn multiple servers.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.agent-snapshots.viewer");
  }
  registerDeepLinkProtocol();
  const initialDeepLink = findDeepLinkArg(process.argv);
  if (initialDeepLink) {
    pendingDeepLinks.push(initialDeepLink);
  }
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
  app.on("second-instance", (_event, argv) => {
    const deepLink = findDeepLinkArg(argv);
    if (deepLink) {
      handleDeepLink(deepLink);
      return;
    }
    showLauncherWindow({ centerOnCursor: true });
  });
  app.on("browser-window-focus", clearUnseenCompletions);

  app.whenReady().then(bootstrap);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && !tray) {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopCompletionPoller();
    stopServer();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  process.on("exit", stopServer);
}
