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
  ipcMain,
} from "electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createQuickLookController } from "./quicklook.mjs";
import { SettingsStore } from "./settings-store.mjs";
import {
  installDevLoginLaunchAgent,
  uninstallDevLoginLaunchAgent,
} from "./dev-login-launch-agent.mjs";
import {
  excludeLiveRecoverySessions,
  mergeRecoverySessions,
  normalizeRecoverySession,
  readSessionRecoveryState,
  storedSessionRecoveryState,
} from "./session-recovery.mjs";
import { listActiveOrcaSessionSummaries } from "./orca-live-sessions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The app root holds both electron/ and dist/ as siblings, in dev and when
// packaged (resources/app/...). Deriving it from this file keeps the CLI path
// correct in both cases, unlike app.getAppPath() which varies by launch mode.
const APP_ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
const PREFERRED_PORT = 4321;
const DEEP_LINK_PROTOCOL = "agent-snapshots";
const MAX_SESSION_REF_LENGTH = 4096;
const SETTINGS_VERSION = 1;
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const supportsOpenAtLogin = isMac || isWindows;
const supportsNotificationSilent = isMac || isWindows;
const GLOBAL_SHORTCUT_SETTING_KEY = "globalShortcut";
const SESSION_RECOVERY_SETTING_KEY = "sessionRecovery";
const SESSION_RECOVERY_GET_CHANNEL = "session-recovery:get";
const SESSION_RECOVERY_RESTORE_CHANNEL = "session-recovery:restore";
const SESSION_RECOVERY_CHANGED_CHANNEL = "session-recovery:changed";
const DEFAULT_GLOBAL_SHORTCUT = isMac ? "Alt+Space" : "Ctrl+Shift+Space";
const GLOBAL_SHORTCUT_DISABLED_LABEL = "快捷键禁用";
const GLOBAL_SHORTCUT_PRESETS = [
  ...(isMac ? [{ label: "⌥Space", accelerator: "Alt+Space" }] : []),
  { label: isMac ? "⌃⇧Space" : "Ctrl+Shift+Space", accelerator: "Ctrl+Shift+Space" },
  { label: isMac ? "⌘⇧K" : "Ctrl+Shift+K", accelerator: "CmdOrCtrl+Shift+K" },
  { label: "F19", accelerator: "F19" },
  { label: "禁用", accelerator: null },
];
// Minted once per app run and handed to every server child: watchdog restarts
// reuse the port so already-loaded windows keep working, which also requires
// the mutation CSRF token those pages hold to stay valid across restarts.
const MUTATION_CSRF_TOKEN = randomBytes(32).toString("base64url");
// Start with the launcher window hidden (tray/shortcut still summon it):
// lets scripts and agents boot or debug the app without stealing focus.
const START_HIDDEN = process.env.AGENT_SNAPSHOT_START_HIDDEN === "1" || process.argv.includes("--hidden");
const ENABLE_OPEN_AT_LOGIN = process.env.AGENT_SNAPSHOT_OPEN_AT_LOGIN === "1";
const POLL_INTERVAL_MS = 5000;
const TRAY_RECENT_REFRESH_MS = 30000;
const DEFAULT_SETTINGS = {
  settingsVersion: SETTINGS_VERSION,
  openAtLogin: false,
  completionSound: true,
  preventSleepWithLiveSessions: false,
  launcherBounds: null,
  sessionRecovery: {
    version: 1,
    monitoring: false,
    liveSessions: [],
    recoverableSessions: [],
  },
};
// The app logo, so the dev-mode window/dock shows our mark instead of the
// default Electron atom (the packaged .app already embeds build/icon.icns).
const APP_ICON = nativeImage.createFromPath(path.join(APP_ROOT, "build", "icon.png"));
const require = createRequire(import.meta.url);

// Development launches otherwise inherit Electron's generic app name and
// userData directory. Use the product name in both dev and packaged builds so
// settings (including login-item and recovery state) have one stable home.
app.setName("Agent Snapshots");

let serverProcess = null;
let serverPort = 0;
let serverRestarting = false;
let serverHealthTimer = null;
let serverHealthFailures = 0;
let startUrl = "";
let mainWindow = null;
let viewerWindow = null;
let tray = null;
let trayMenu = null;
let quickLook = null;
let settings = null;
let quitting = false;
let launcherBoundsTimer = null;
let pollTimer = null;
let pollInFlight = false;
let recentTrayTimer = null;
let recentTrayRefreshInFlight = false;
let hasPollBaseline = false;
let liveSessionIds = new Set();
let liveSessionById = new Map();
let recoveryLiveSessionById = new Map();
let recentTraySessions = [];
let unseenCompletionCount = 0;
let sleepBlockerId = null;
let recoverableSessions = [];
let recoveryInFlight = false;
let recoveryIpcRegistered = false;
let lastRecoveryStorageFingerprint = "";
let selectedGlobalShortcut = DEFAULT_GLOBAL_SHORTCUT;
let registeredGlobalShortcut = null;
let globalShortcutIneffective = false;
let updater = null;
let updaterConfigured = false;
const pendingDeepLinks = [];
const appTimeouts = new Set();
const appIntervals = new Set();

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
      setTrackedTimeout(attempt, 250);
    };
    attempt();
  });
}

function setTrackedTimeout(callback, delayMs) {
  let handle = null;
  handle = setTimeout(() => {
    appTimeouts.delete(handle);
    callback();
  }, delayMs);
  appTimeouts.add(handle);
  handle.unref?.();
  return handle;
}

function clearTrackedTimeout(handle) {
  if (!handle) {
    return;
  }
  clearTimeout(handle);
  appTimeouts.delete(handle);
}

function setTrackedInterval(callback, delayMs) {
  const handle = setInterval(callback, delayMs);
  appIntervals.add(handle);
  handle.unref?.();
  return handle;
}

function clearTrackedInterval(handle) {
  if (!handle) {
    return;
  }
  clearInterval(handle);
  appIntervals.delete(handle);
}

function clearTrackedTimers() {
  for (const handle of appTimeouts) {
    clearTimeout(handle);
  }
  appTimeouts.clear();
  for (const handle of appIntervals) {
    clearInterval(handle);
  }
  appIntervals.clear();
  launcherBoundsTimer = null;
  recentTrayTimer = null;
  pollTimer = null;
}

/** Launch the local viewer server as a child process and wait until it's ready. */
async function startServer() {
  // Reuse the previous port across watchdog restarts so already-loaded
  // windows keep pointing at a valid origin.
  serverPort = serverPort || (await findFreePort());
  const args = [cliEntry(), "serve", "--host", HOST, "--port", String(serverPort)];
  serverProcess = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    // The Electron-as-node runtime has been observed to permanently wedge its
    // libuv threadpool under bursty fs load (idle workers stop picking up
    // queued fs requests). A larger pool reduces the burst pressure; the
    // health watchdog below recovers the process when it wedges anyway.
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "16",
      AGENT_SNAPSHOT_MUTATION_CSRF_TOKEN: MUTATION_CSRF_TOKEN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  serverProcess.on("exit", (code, signal) => {
    serverProcess = null;
    if (quitting || serverRestarting) {
      return;
    }
    restartServer(`server exited unexpectedly (code ${code ?? "?"}, signal ${signal ?? "none"})`).catch(() => {
      dialog.showErrorBox(
        "Agent Snapshots",
        `本地查看器服务意外停止（代码 ${code ?? "?"}，信号 ${signal ?? "none"}），且自动重启失败。`,
      );
      app.quit();
    });
  });

  await waitForServer(serverPort);
  startServerHealthWatchdog();
  return `http://${HOST}:${serverPort}/`;
}

/** Poll /api/health (a threadpool-exercising fs stat) and restart the server
 * child when it stops answering: a wedged libuv threadpool keeps cached
 * endpoints alive while every fs-backed route hangs forever. */
function startServerHealthWatchdog() {
  clearInterval(serverHealthTimer);
  serverHealthFailures = 0;
  serverHealthTimer = setInterval(async () => {
    if (quitting || serverRestarting || !serverProcess) {
      return;
    }
    try {
      const res = await fetch(`http://${HOST}:${serverPort}/api/health?timeoutMs=4000`, {
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        serverHealthFailures = 0;
        return;
      }
      serverHealthFailures += 1;
    } catch {
      serverHealthFailures += 1;
    }
    if (serverHealthFailures >= 3) {
      serverHealthFailures = 0;
      await restartServer("health probe failed 3 times").catch((error) => {
        console.error("[server] watchdog restart failed:", error);
      });
    }
  }, 30_000);
}

async function restartServer(reason) {
  if (serverRestarting || quitting) {
    return;
  }
  serverRestarting = true;
  console.warn(`[server] restarting embedded server: ${reason}`);
  try {
    const dying = serverProcess;
    serverProcess = null;
    if (dying) {
      // The typical restart cause is a wedged process; SIGKILL is the only
      // signal guaranteed to take it down.
      dying.kill("SIGKILL");
      await new Promise((resolve) => {
        dying.once("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
    await startServer();
  } finally {
    serverRestarting = false;
  }
}

function stopServer() {
  clearInterval(serverHealthTimer);
  serverHealthTimer = null;
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

function setting(key) {
  const value = settings?.get(key, DEFAULT_SETTINGS[key]) ?? DEFAULT_SETTINGS[key];
  if (typeof DEFAULT_SETTINGS[key] === "boolean" && typeof value !== "boolean") {
    return DEFAULT_SETTINGS[key];
  }
  return value;
}

function writeSetting(key, value) {
  try {
    settings?.set(key, value);
  } catch (error) {
    console.warn(`Failed to write setting ${key}:`, error);
  }
}

function migrateLegacyDevelopmentSettings() {
  if (!process.defaultApp) {
    return;
  }
  const nextPath = path.join(app.getPath("userData"), "settings.json");
  const legacyPath = path.join(app.getPath("appData"), "Electron", "settings.json");
  if (existsSync(nextPath) || !existsSync(legacyPath)) {
    return;
  }
  try {
    const legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
    if (!legacy || typeof legacy !== "object" || Number(legacy.settingsVersion || 0) < 1) {
      return;
    }
    mkdirSync(path.dirname(nextPath), { recursive: true });
    copyFileSync(legacyPath, nextPath);
  } catch (error) {
    console.warn("Failed to migrate legacy Electron development settings:", error);
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

function normalizeSessionRef(value) {
  const text = String(value || "").trim();
  if (!text || text.length > MAX_SESSION_REF_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) {
    return "";
  }
  const match = /^(codex|claude):(.+)$/i.exec(text);
  if (!match) {
    return /^[A-Za-z0-9._-]+$/.test(text) ? `codex:${text}` : "";
  }
  const engine = match[1].toLowerCase();
  const id = String(match[2] || "").trim();
  if (!id || engine.length + 1 + id.length > MAX_SESSION_REF_LENGTH) {
    return "";
  }
  return `${engine}:${id}`;
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
    clearTrackedTimeout(launcherBoundsTimer);
  }
  launcherBoundsTimer = setTrackedTimeout(() => {
    launcherBoundsTimer = null;
    saveLauncherBoundsNow();
  }, 250);
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
    show: !START_HIDDEN,
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
      preload: path.join(__dirname, "launcher-preload.cjs"),
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

  mainWindow.on("move", () => {
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
  if (quitting) {
    return;
  }
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
  void window.loadURL(url).catch((error) => {
    if (!quitting) {
      console.warn("Failed to load viewer URL:", error);
    }
  });
  window.show();
  window.focus();
  clearUnseenCompletions();
}

function openViewerForSession(ref = "") {
  if (quitting) {
    return;
  }
  const normalizedRef = normalizeSessionRef(ref);
  if (String(ref || "").trim() && !normalizedRef) {
    console.warn("Ignoring invalid session ref.");
    return;
  }
  if (!startUrl) {
    pendingDeepLinks.push(
      normalizedRef
        ? `${DEEP_LINK_PROTOCOL}://session/${encodeURIComponent(normalizedRef)}`
        : `${DEEP_LINK_PROTOCOL}://launcher`,
    );
    return;
  }
  const url = new URL(startUrl);
  if (normalizedRef) {
    url.searchParams.set("session", normalizedRef);
  }
  openViewerUrl(url.toString());
}

function showLauncherWindow({ centerOnCursor = true } = {}) {
  if (quitting) {
    return;
  }
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
  clearUnseenCompletions();
}

function toggleLauncherWindow() {
  if (quitting) {
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
    saveLauncherBoundsNow();
    mainWindow.hide();
    return;
  }
  showLauncherWindow({ centerOnCursor: true });
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
    if (isMac && process.defaultApp) {
      removeLegacyDevelopmentLoginItem();
      if (openAtLogin) {
        installDevLoginLaunchAgent({ appRoot: APP_ROOT });
      } else {
        uninstallDevLoginLaunchAgent();
      }
    } else {
      app.setLoginItemSettings({ openAtLogin });
    }
  } catch (error) {
    console.warn("Failed to update login item setting:", error);
  }
  if (persist) {
    writeSetting("openAtLogin", openAtLogin);
  }
  rebuildTrayMenu();
}

function removeLegacyDevelopmentLoginItem() {
  try {
    app.setLoginItemSettings({ openAtLogin: false });
  } catch (error) {
    console.warn("Failed to remove legacy Electron login item:", error);
  }
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
      normalizeSessionRef,
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
  recentTrayTimer = setTrackedInterval(refreshRecentTraySessions, TRAY_RECENT_REFRESH_MS);
}

function stopRecentTrayRefresh() {
  if (recentTrayTimer) {
    clearTrackedInterval(recentTrayTimer);
    recentTrayTimer = null;
  }
}

function rebuildTrayMenu() {
  if (!tray) {
    return;
  }
  trayMenu = Menu.buildFromTemplate([
    { label: `显示/隐藏启动器 (${selectedGlobalShortcutLabel()})`, click: toggleLauncherWindow },
    ...(recoverableSessions.length
      ? [{
        label: recoveryInFlight
          ? `正在恢复中断的会话 (${recoverableSessions.length})…`
          : `恢复上次中断的会话 (${recoverableSessions.length})`,
        enabled: !recoveryInFlight,
        click: () => {
          void restoreInterruptedSessions({ showResultDialog: true });
        },
      }]
      : []),
    { label: "打开完整视图", click: () => openViewerForSession() },
    { label: "在浏览器打开", click: () => startUrl && shell.openExternal(startUrl) },
    { label: "检查更新…", click: checkForUpdatesManually },
    { type: "separator" },
    { label: "最近会话", submenu: recentTraySubmenu() },
    { type: "separator" },
    { label: "全局快捷键", submenu: globalShortcutSubmenu() },
    { type: "separator" },
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
    const rawRef = safeDecodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || parsed.searchParams.get("ref") || "";
    const ref = normalizeSessionRef(rawRef);
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
  unseenCompletionCount = Math.max(0, unseenCompletionCount);
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
  const rawRef = session?.ref
    || (session?.engine && session?.id ? `${session.engine}:${session.id}` : `codex:${session?.id || ""}`);
  return normalizeSessionRef(rawRef);
}

function recoverySessionFromSummary(session) {
  return normalizeRecoverySession({
    ref: sessionRef(session),
    cwd: session?.cwd || session?.displayCwd || "",
    title: session?.title || "",
    observedAt: session?.mtime || session?.updatedAt || new Date().toISOString(),
  });
}

function recoveryLiveSessions(sessions = recoveryLiveSessionById.values()) {
  const normalized = [];
  for (const session of sessions) {
    const recoverySession = recoverySessionFromSummary(session);
    if (recoverySession) {
      normalized.push(recoverySession);
    }
  }
  return mergeRecoverySessions(normalized);
}

function persistSessionRecovery({ monitoring = true, liveSessions = recoveryLiveSessions() } = {}) {
  const next = storedSessionRecoveryState({
    monitoring,
    liveSessions,
    recoverableSessions,
  });
  const fingerprint = JSON.stringify({
    monitoring: next.monitoring,
    liveSessions: next.liveSessions,
    recoverableSessions: next.recoverableSessions,
  });
  if (fingerprint === lastRecoveryStorageFingerprint) {
    return;
  }
  lastRecoveryStorageFingerprint = fingerprint;
  writeSetting(SESSION_RECOVERY_SETTING_KEY, next);
}

function sessionRecoveryPublicState() {
  return {
    count: recoverableSessions.length,
    restoring: recoveryInFlight,
  };
}

function broadcastSessionRecoveryState() {
  const state = sessionRecoveryPublicState();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(SESSION_RECOVERY_CHANGED_CHANNEL, state);
  }
  rebuildTrayMenu();
}

function initializeSessionRecovery() {
  const previous = readSessionRecoveryState(setting(SESSION_RECOVERY_SETTING_KEY));
  recoverableSessions = previous.recoverableSessions;
  // Mark the monitor active before the first poll. The pending list is written
  // separately so another crash during startup cannot discard the older run.
  persistSessionRecovery({ monitoring: true, liveSessions: [] });
}

function markSessionRecoveryCleanShutdown() {
  if (!settings) {
    return;
  }
  // A deliberate Agent Snapshots quit is not evidence that Orca died. Pending
  // recovery entries remain, but currently live sessions are not promoted on
  // the next launch unless this process itself terminates unexpectedly.
  persistSessionRecovery({ monitoring: false });
}

function isTrustedRecoveryIpc(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return false;
  }
  return isAppUrl(event.senderFrame?.url || event.sender.getURL());
}

function registerSessionRecoveryIpc() {
  if (recoveryIpcRegistered) {
    return;
  }
  recoveryIpcRegistered = true;
  ipcMain.handle(SESSION_RECOVERY_GET_CHANNEL, (event) => {
    if (!isTrustedRecoveryIpc(event)) {
      throw new Error("untrusted session recovery request");
    }
    return sessionRecoveryPublicState();
  });
  ipcMain.handle(SESSION_RECOVERY_RESTORE_CHANNEL, async (event) => {
    if (!isTrustedRecoveryIpc(event)) {
      throw new Error("untrusted session recovery request");
    }
    return restoreInterruptedSessions();
  });
}

async function resumeRecoverySession(session) {
  const params = new URLSearchParams({
    id: session.ref,
    cwd: session.cwd,
    title: session.title || "",
  });
  const result = await postLocalJson(`/api/resume-in-orca?${params.toString()}`);
  if (!result.ok) {
    throw new Error(result.error || "恢复失败");
  }
  return result;
}

async function restoreInterruptedSessions({ showResultDialog = false } = {}) {
  if (recoveryInFlight) {
    return {
      ok: false,
      restored: 0,
      failed: 0,
      remaining: recoverableSessions.length,
      error: "正在恢复中",
    };
  }
  const queue = [...recoverableSessions];
  if (!queue.length) {
    return { ok: true, restored: 0, failed: 0, remaining: 0 };
  }

  recoveryInFlight = true;
  broadcastSessionRecoveryState();
  let restored = 0;
  const failures = [];
  for (const session of queue) {
    try {
      await resumeRecoverySession(session);
      recoverableSessions = recoverableSessions.filter((item) => item.ref !== session.ref);
      restored += 1;
      persistSessionRecovery();
      broadcastSessionRecoveryState();
    } catch (error) {
      failures.push({
        ref: session.ref,
        error: compactErrorMessage(error),
      });
    }
  }
  recoveryInFlight = false;
  persistSessionRecovery();
  broadcastSessionRecoveryState();

  const result = {
    ok: failures.length === 0,
    restored,
    failed: failures.length,
    remaining: recoverableSessions.length,
    failures,
  };
  if (showResultDialog) {
    const detail = failures.length
      ? failures.map((failure) => `${failure.ref}\n${failure.error}`).join("\n\n")
      : "";
    await dialog.showMessageBox({
      type: failures.length ? "warning" : "info",
      title: "恢复中断的会话",
      message: failures.length
        ? `已恢复 ${restored} 个，${failures.length} 个失败`
        : `已恢复 ${restored} 个会话`,
      ...(detail ? { detail } : {}),
      buttons: ["好"],
    });
  }
  return result;
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

function postLocalJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port: serverPort,
        path: pathname,
        method: "POST",
        timeout: 30000,
        headers: {
          accept: "application/json",
          origin: appOrigin(),
          "x-agent-snapshot-csrf": MUTATION_CSRF_TOKEN,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) {
            req.destroy(new Error("response too large"));
          }
        });
        res.on("end", () => {
          let payload;
          try {
            payload = JSON.parse(body);
          } catch (error) {
            reject(error);
            return;
          }
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(payload?.error || `HTTP ${res.statusCode ?? "?"}`));
            return;
          }
          resolve(payload);
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("恢复请求超时")));
    req.end();
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
      limit: "500",
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
    const activeOrcaSessions = await listActiveOrcaSessionSummaries(result);
    const nextRecoveryById = new Map();
    for (const session of activeOrcaSessions) {
      const ref = sessionRef(session);
      if (ref && !isArchivedSessionSummary(session)) {
        nextRecoveryById.set(ref, session);
      }
    }
    if (!hasPollBaseline) {
      liveSessionIds = nextIds;
      liveSessionById = nextById;
      recoveryLiveSessionById = nextRecoveryById;
      hasPollBaseline = true;
      recoverableSessions = excludeLiveRecoverySessions(
        recoverableSessions,
        recoveryLiveSessions(nextRecoveryById.values()),
      );
      persistSessionRecovery();
      broadcastSessionRecoveryState();
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
    recoveryLiveSessionById = nextRecoveryById;
    persistSessionRecovery();
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
  pollTimer = setTrackedInterval(pollSessionCompletions, POLL_INTERVAL_MS);
}

function stopCompletionPoller() {
  if (pollTimer) {
    clearTrackedInterval(pollTimer);
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
  migrateLegacyDevelopmentSettings();
  settings = new SettingsStore(path.join(app.getPath("userData"), "settings.json"), DEFAULT_SETTINGS);
  initializeSessionRecovery();
  registerSessionRecoveryIpc();
  loadGlobalShortcutSetting();
  if (supportsOpenAtLogin && (ENABLE_OPEN_AT_LOGIN || setting("openAtLogin"))) {
    setOpenAtLogin(true, { persist: ENABLE_OPEN_AT_LOGIN });
  } else if (isMac && process.defaultApp) {
    setOpenAtLogin(false, { persist: false });
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
    saveLauncherBoundsNow();
    markSessionRecoveryCleanShutdown();
    quickLook?.destroy();
    stopRecentTrayRefresh();
    stopCompletionPoller();
    clearTrackedTimers();
    stopServer();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  process.on("exit", stopServer);
}
