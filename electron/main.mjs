// Electron main process for the Agent Snapshots desktop app.
//
// Strategy: reuse the existing local viewer server verbatim. We spawn the
// packaged CLI (`agent-snapshot serve`) as a child process using Electron's
// bundled Node runtime (ELECTRON_RUN_AS_NODE=1), wait for it to come up on a
// free localhost port, then point a native BrowserWindow at it. This keeps
// 100% of the web app's behaviour while giving it a real desktop window.

import {
  app,
  BrowserWindow,
  Menu,
  shell,
  dialog,
  nativeImage,
  Tray,
  globalShortcut,
  screen,
  Notification,
  powerSaveBlocker,
} from "electron";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createQuickLookController } from "./quicklook.mjs";
import { SettingsStore } from "./settings-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The app root holds both electron/ and dist/ as siblings, in dev and when
// packaged (resources/app/...). Deriving it from this file keeps the CLI path
// correct in both cases, unlike app.getAppPath() which varies by launch mode.
const APP_ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const PREFERRED_PORT = 4321;
const DEEP_LINK_PROTOCOL = "agent-snapshots";
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const supportsOpenAtLogin = isMac || isWindows;
const supportsNotificationSilent = isMac || isWindows;
const GLOBAL_SHORTCUT_SETTING_KEY = "globalShortcut";
const DEFAULT_GLOBAL_SHORTCUT = isMac ? "Alt+Space" : "Ctrl+Shift+Space";
const GLOBAL_SHORTCUT_DISABLED_LABEL = "快捷键禁用";
const GLOBAL_SHORTCUT_PRESETS = [
  ...(isMac ? [{ label: "⌥Space", accelerator: "Alt+Space" }] : []),
  { label: isMac ? "⌃⇧Space" : "Ctrl+Shift+Space", accelerator: "Ctrl+Shift+Space" },
  { label: isMac ? "⌘⇧K" : "Ctrl+Shift+K", accelerator: "CmdOrCtrl+Shift+K" },
  { label: "F19", accelerator: "F19" },
  { label: "禁用", accelerator: null },
];
const POLL_INTERVAL_MS = 5000;
const TRAY_RECENT_REFRESH_MS = 30000;
const DEFAULT_SETTINGS = {
  hideOnBlur: true,
  openAtLogin: false,
  completionSound: true,
  preventSleepWithLiveSessions: false,
  launcherBounds: null,
};
// The app logo, so the dev-mode window/dock shows our mark instead of the
// default Electron atom (the packaged .app already embeds build/icon.icns).
const APP_ICON = nativeImage.createFromPath(path.join(APP_ROOT, "build", "icon.png"));
const require = createRequire(import.meta.url);

let serverProcess = null;
let serverPort = 0;
let startUrl = "";
let mainWindow = null;
let viewerWindow = null;
let tray = null;
let trayMenu = null;
let quickLook = null;
let settings = null;
let quitting = false;
let launcherBoundsTimer = null;
let launcherDragUntil = 0;
let pollTimer = null;
let pollInFlight = false;
let recentTrayTimer = null;
let recentTrayRefreshInFlight = false;
let hasPollBaseline = false;
let liveSessionIds = new Set();
let liveSessionById = new Map();
let recentTraySessions = [];
let unseenCompletionCount = 0;
let sleepBlockerId = null;
let selectedGlobalShortcut = DEFAULT_GLOBAL_SHORTCUT;
let registeredGlobalShortcut = null;
let globalShortcutIneffective = false;
let updater = null;
let updaterConfigured = false;
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

function globalShortcutPreset(accelerator) {
  return GLOBAL_SHORTCUT_PRESETS.find((preset) => preset.accelerator === accelerator);
}

function isPresetGlobalShortcut(accelerator) {
  return Boolean(globalShortcutPreset(accelerator));
}

function normalizeGlobalShortcutSetting(value) {
  if (isPresetGlobalShortcut(value)) {
    return value;
  }
  if (value !== undefined) {
    console.warn(
      `Ignoring unsupported global shortcut setting ${JSON.stringify(value)}; using ${DEFAULT_GLOBAL_SHORTCUT}.`,
    );
  }
  return DEFAULT_GLOBAL_SHORTCUT;
}

function globalShortcutLabel(accelerator) {
  return globalShortcutPreset(accelerator)?.label || String(accelerator || "");
}

function globalShortcutRadioLabel(accelerator) {
  const label = globalShortcutLabel(accelerator);
  if (accelerator !== null && globalShortcutIneffective && selectedGlobalShortcut === accelerator) {
    return `${label} (未生效)`;
  }
  return label;
}

function selectedGlobalShortcutLabel() {
  if (selectedGlobalShortcut === null) {
    return GLOBAL_SHORTCUT_DISABLED_LABEL;
  }
  const label = globalShortcutLabel(selectedGlobalShortcut);
  return globalShortcutIneffective ? `${label} (未生效)` : label;
}

function activeGlobalShortcutAccelerator() {
  return globalShortcutIneffective ? null : selectedGlobalShortcut;
}

function refreshGlobalShortcutMenus() {
  rebuildTrayMenu();
  if (app.isReady()) {
    buildMenu(() => startUrl);
  }
}

function loadGlobalShortcutSetting() {
  selectedGlobalShortcut = normalizeGlobalShortcutSetting(settings?.get(GLOBAL_SHORTCUT_SETTING_KEY, undefined));
  registeredGlobalShortcut = null;
  globalShortcutIneffective = false;
}

function unregisterRegisteredGlobalShortcut() {
  if (!registeredGlobalShortcut) {
    return;
  }
  try {
    globalShortcut.unregister(registeredGlobalShortcut);
  } catch (error) {
    console.warn(`Failed to unregister global shortcut ${registeredGlobalShortcut}:`, error);
  }
  registeredGlobalShortcut = null;
}

function tryRegisterGlobalShortcut(accelerator) {
  try {
    return globalShortcut.register(accelerator, toggleLauncherWindow);
  } catch (error) {
    console.warn(`Failed to register global shortcut ${accelerator}:`, error);
    return false;
  }
}

function restoreGlobalShortcutAfterFailure(previousWorkingShortcut, previousSelectedShortcut, previousIneffective) {
  if (!previousWorkingShortcut) {
    selectedGlobalShortcut = previousIneffective ? previousSelectedShortcut : null;
    registeredGlobalShortcut = null;
    globalShortcutIneffective = selectedGlobalShortcut !== null;
    writeSetting(GLOBAL_SHORTCUT_SETTING_KEY, selectedGlobalShortcut);
    return;
  }
  if (tryRegisterGlobalShortcut(previousWorkingShortcut)) {
    selectedGlobalShortcut = previousWorkingShortcut;
    registeredGlobalShortcut = previousWorkingShortcut;
    globalShortcutIneffective = false;
    writeSetting(GLOBAL_SHORTCUT_SETTING_KEY, previousWorkingShortcut);
    return;
  }
  console.warn(`Failed to restore previous global shortcut ${previousWorkingShortcut}.`);
  selectedGlobalShortcut = previousSelectedShortcut;
  registeredGlobalShortcut = null;
  globalShortcutIneffective = selectedGlobalShortcut !== null;
  writeSetting(GLOBAL_SHORTCUT_SETTING_KEY, selectedGlobalShortcut);
}

async function setGlobalShortcutChoice(nextShortcut) {
  if (!isPresetGlobalShortcut(nextShortcut)) {
    console.warn(`Ignoring unsupported global shortcut selection ${JSON.stringify(nextShortcut)}.`);
    return;
  }

  if (
    nextShortcut === selectedGlobalShortcut
    && nextShortcut === registeredGlobalShortcut
    && !globalShortcutIneffective
  ) {
    writeSetting(GLOBAL_SHORTCUT_SETTING_KEY, nextShortcut);
    return;
  }

  const previousWorkingShortcut = registeredGlobalShortcut;
  const previousSelectedShortcut = selectedGlobalShortcut;
  const previousIneffective = globalShortcutIneffective;
  unregisterRegisteredGlobalShortcut();

  if (nextShortcut === null) {
    selectedGlobalShortcut = null;
    globalShortcutIneffective = false;
    writeSetting(GLOBAL_SHORTCUT_SETTING_KEY, null);
    refreshGlobalShortcutMenus();
    return;
  }

  if (tryRegisterGlobalShortcut(nextShortcut)) {
    selectedGlobalShortcut = nextShortcut;
    registeredGlobalShortcut = nextShortcut;
    globalShortcutIneffective = false;
    writeSetting(GLOBAL_SHORTCUT_SETTING_KEY, nextShortcut);
    refreshGlobalShortcutMenus();
    return;
  }

  console.warn(`Global shortcut ${nextShortcut} is unavailable; reverting.`);
  restoreGlobalShortcutAfterFailure(previousWorkingShortcut, previousSelectedShortcut, previousIneffective);
  refreshGlobalShortcutMenus();
  await dialog.showMessageBox({
    type: "warning",
    title: "全局快捷键",
    message: "快捷键被占用，已回退",
    buttons: ["好"],
  });
}

function getAutoUpdater() {
  if (!updater) {
    ({ autoUpdater: updater } = require("electron-updater"));
  }
  return updater;
}

function configureAutoUpdater() {
  const autoUpdater = getAutoUpdater();
  if (!updaterConfigured) {
    autoUpdater.logger = null;
    autoUpdater.autoDownload = true;
    autoUpdater.setFeedURL({ provider: "github", owner: "ffffhx", repo: "agent-snapshots" });
    autoUpdater.on("error", (error) => {
      console.warn("Auto update error:", compactErrorMessage(error));
    });
    updaterConfigured = true;
  }
  return autoUpdater;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function compactErrorMessage(error) {
  const message = errorMessage(error).split(/\r?\n/, 1)[0]?.trim() || "Unknown error";
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

function formatUpdateVersion(version) {
  const text = String(version || "").trim();
  if (!text) {
    return "";
  }
  return text.toLowerCase().startsWith("v") ? text : `v${text}`;
}

async function showUpdateDialog(options) {
  await dialog.showMessageBox({
    title: "检查更新",
    buttons: ["好"],
    ...options,
  });
}

async function checkForUpdatesManually() {
  if (!app.isPackaged) {
    await showUpdateDialog({ type: "info", message: "开发模式不支持检查更新。" });
    return;
  }
  try {
    const result = await configureAutoUpdater().checkForUpdates();
    if (!result?.isUpdateAvailable) {
      await showUpdateDialog({ type: "info", message: "已是最新版本。" });
      return;
    }
    const version = formatUpdateVersion(result.updateInfo?.version);
    await showUpdateDialog({ type: "info", message: `发现新版本${version ? ` ${version}` : ""} 正在下载。` });
  } catch (error) {
    const message = compactErrorMessage(error);
    console.warn("Manual update check failed:", message);
    await showUpdateDialog({ type: "error", message: `检查失败：${message}` });
  }
}

function startAutomaticUpdateCheck() {
  if (!app.isPackaged) {
    return;
  }
  try {
    configureAutoUpdater().checkForUpdatesAndNotify().catch(() => {});
  } catch (error) {
    console.warn("Automatic update check failed:", compactErrorMessage(error));
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

function truncateMenuText(value, maxLength = 40) {
  const text = String(value || "").replace(/\s+/g, " ").trim() || "未命名会话";
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join("")}…` : text;
}

function engineBadge(session) {
  const engine = String(session?.engine || "codex").toLowerCase();
  if (engine === "claude") {
    return "Claude";
  }
  if (engine === "trae") {
    return "Trae";
  }
  if (engine === "codex") {
    return "Codex";
  }
  return String(session?.engineLabel || session?.engine || "Codex").trim() || "Codex";
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
    ...(isMac ? { titleBarStyle: "hiddenInset" } : {}),
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
    ...(isMac
      ? { backgroundColor: "#00000000", titleBarStyle: "hiddenInset", vibrancy: "under-window", visualEffectState: "active" }
      : { backgroundColor: "#1c150e" }),
    icon: APP_ICON,
    title: "Agent Snapshots",
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

function setCompletionSound(enabled) {
  writeSetting("completionSound", Boolean(enabled));
  rebuildTrayMenu();
}

function setOpenAtLogin(enabled, { persist = true } = {}) {
  const openAtLogin = Boolean(enabled);
  if (!supportsOpenAtLogin) {
    if (openAtLogin) {
      console.warn("Open at login is not supported on this platform.");
    }
    if (persist) {
      writeSetting("openAtLogin", false);
    }
    rebuildTrayMenu();
    return;
  }
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

function releaseSleepBlocker() {
  if (sleepBlockerId === null) {
    return;
  }
  try {
    if (powerSaveBlocker.isStarted(sleepBlockerId)) {
      powerSaveBlocker.stop(sleepBlockerId);
    }
  } catch (error) {
    console.warn("Failed to stop power save blocker:", error);
  }
  sleepBlockerId = null;
}

function syncSleepBlocker(hasLiveSessions = liveSessionIds.size > 0) {
  if (!setting("preventSleepWithLiveSessions") || !hasLiveSessions) {
    releaseSleepBlocker();
    return;
  }
  try {
    if (sleepBlockerId === null || !powerSaveBlocker.isStarted(sleepBlockerId)) {
      sleepBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
  } catch (error) {
    console.warn("Failed to start power save blocker:", error);
    sleepBlockerId = null;
  }
}

function setPreventSleepWithLiveSessions(enabled) {
  writeSetting("preventSleepWithLiveSessions", Boolean(enabled));
  syncSleepBlocker();
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
    quickLook = createQuickLookController({
      getBaseUrl: () => startUrl,
      getTray: () => tray,
      isMac,
      onError: (...args) => console.warn(...args),
      openLauncher: () => showLauncherWindow({ centerOnCursor: true }),
      openSession: openViewerForSession,
      openViewer: () => openViewerForSession(),
      preloadPath: path.join(__dirname, "quicklook-preload.cjs"),
    });
    tray.on("click", async () => {
      if (!isMac) {
        showLauncherWindow({ centerOnCursor: false });
        return;
      }
      const shown = await quickLook?.toggle();
      if (!shown) {
        showTrayMenu();
      }
    });
    if (isMac) {
      tray.on("right-click", showTrayMenu);
    }
    rebuildTrayMenu();
    startRecentTrayRefresh();
  } catch (error) {
    tray = null;
    console.warn("Failed to create tray icon:", error);
  }
}

function recentTraySubmenu() {
  if (!recentTraySessions.length) {
    return [{ label: "暂无会话", enabled: false }];
  }
  return recentTraySessions.map((session) => {
    const ref = sessionRef(session);
    return {
      label: `${engineBadge(session)} ${truncateMenuText(session?.title)}`,
      enabled: Boolean(ref),
      click: () => openViewerForSession(ref),
    };
  });
}

function globalShortcutSubmenu() {
  return GLOBAL_SHORTCUT_PRESETS.map((preset) => ({
    label: globalShortcutRadioLabel(preset.accelerator),
    type: "radio",
    checked: selectedGlobalShortcut === preset.accelerator,
    click: () => {
      void setGlobalShortcutChoice(preset.accelerator);
    },
  }));
}

async function refreshRecentTraySessions() {
  if (!tray || !serverPort || recentTrayRefreshInFlight) {
    return;
  }
  recentTrayRefreshInFlight = true;
  try {
    const result = await getJson("/api/sessions?limit=8");
    if (Array.isArray(result)) {
      recentTraySessions = result;
      rebuildTrayMenu();
    }
  } catch {
    // Keep the current tray contents if the local server is temporarily busy.
  } finally {
    recentTrayRefreshInFlight = false;
  }
}

function startRecentTrayRefresh() {
  stopRecentTrayRefresh();
  refreshRecentTraySessions();
  recentTrayTimer = setInterval(refreshRecentTraySessions, TRAY_RECENT_REFRESH_MS);
  recentTrayTimer.unref?.();
}

function stopRecentTrayRefresh() {
  if (recentTrayTimer) {
    clearInterval(recentTrayTimer);
    recentTrayTimer = null;
  }
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }
  trayMenu = Menu.buildFromTemplate([
    { label: `显示/隐藏启动器 (${selectedGlobalShortcutLabel()})`, click: toggleLauncherWindow },
    { label: "打开完整视图", click: () => openViewerForSession() },
    { label: "在浏览器打开", click: () => startUrl && shell.openExternal(startUrl) },
    { label: "检查更新…", click: checkForUpdatesManually },
    { type: "separator" },
    { label: "最近会话", submenu: recentTraySubmenu() },
    { type: "separator" },
    { label: "全局快捷键", submenu: globalShortcutSubmenu() },
    { type: "separator" },
    {
      label: "失焦自动隐藏",
      type: "checkbox",
      checked: Boolean(setting("hideOnBlur")),
      click: (item) => setHideOnBlur(item.checked),
    },
    {
      label: "完成提示音",
      type: "checkbox",
      checked: Boolean(setting("completionSound")),
      click: (item) => setCompletionSound(item.checked),
    },
    {
      label: "有会话运行时防止休眠",
      type: "checkbox",
      checked: Boolean(setting("preventSleepWithLiveSessions")),
      click: (item) => setPreventSleepWithLiveSessions(item.checked),
    },
    ...(supportsOpenAtLogin
      ? [{
        label: "开机自启",
        type: "checkbox",
        checked: Boolean(setting("openAtLogin")),
        click: (item) => setOpenAtLogin(item.checked),
      }]
      : []),
    { type: "separator" },
    { label: "退出", click: requestQuit },
  ]);
  if (isMac) {
    tray.setContextMenu(null);
  } else {
    tray.setContextMenu(trayMenu);
  }
}

function showTrayMenu() {
  if (!tray || !trayMenu) {
    return;
  }
  if (!isMac) {
    return;
  }
  tray.popUpContextMenu(trayMenu);
}

function registerGlobalShortcut() {
  if (selectedGlobalShortcut === null) {
    registeredGlobalShortcut = null;
    globalShortcutIneffective = false;
    return;
  }
  if (tryRegisterGlobalShortcut(selectedGlobalShortcut)) {
    registeredGlobalShortcut = selectedGlobalShortcut;
    globalShortcutIneffective = false;
    return;
  }
  registeredGlobalShortcut = null;
  globalShortcutIneffective = true;
  console.warn(`Failed to register global shortcut ${selectedGlobalShortcut}`);
  refreshGlobalShortcutMenus();
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
  const notificationOptions = {
    title: "会话完成",
    body: `${title} · ${sessionProject(session)}`,
  };
  if (supportsNotificationSilent) {
    notificationOptions.silent = !Boolean(setting("completionSound"));
  }
  const notification = new Notification(notificationOptions);
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
      syncSleepBlocker(nextIds.size > 0);
      return;
    }
    for (const ref of liveSessionIds) {
      if (!nextIds.has(ref)) {
        notifySessionCompletion(liveSessionById.get(ref), ref);
      }
    }
    liveSessionIds = nextIds;
    liveSessionById = nextById;
    syncSleepBlocker(nextIds.size > 0);
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
  releaseSleepBlocker();
}

function requestQuit() {
  quitting = true;
  app.quit();
}

function buildMenu(getStartUrl) {
  const isMac = process.platform === "darwin";
  const launcherAccelerator = activeGlobalShortcutAccelerator();
  const launcherLabel = launcherAccelerator
    ? "显示/隐藏启动器"
    : `显示/隐藏启动器 (${selectedGlobalShortcutLabel()})`;
  const template = [
    ...(isMac
      ? [{
        label: "Agent Snapshots",
        submenu: [
          { role: "about", label: "关于 Agent Snapshots" },
          { label: "检查更新…", click: checkForUpdatesManually },
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
        ...(!isMac
          ? [
            { label: "检查更新…", click: checkForUpdatesManually },
            { type: "separator" },
          ]
          : []),
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
          label: launcherLabel,
          ...(launcherAccelerator ? { accelerator: launcherAccelerator } : {}),
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
  loadGlobalShortcutSetting();
  if (supportsOpenAtLogin && setting("openAtLogin")) {
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
  startAutomaticUpdateCheck();
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
    quickLook?.destroy();
    stopRecentTrayRefresh();
    stopCompletionPoller();
    stopServer();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  process.on("exit", stopServer);
}
