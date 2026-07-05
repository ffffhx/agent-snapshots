// Electron main process for the Codex Snapshots desktop app.
//
// Strategy: reuse the existing local viewer server verbatim. We spawn the
// packaged CLI (`codex-snapshot serve`) as a child process using Electron's
// bundled Node runtime (ELECTRON_RUN_AS_NODE=1), wait for it to come up on a
// free localhost port, then point a native BrowserWindow at it. This keeps
// 100% of the web app's behaviour while giving it a real desktop window.

import { app, BrowserWindow, Menu, shell, dialog, nativeImage } from "electron";
import { spawn } from "node:child_process";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The app root holds both electron/ and dist/ as siblings, in dev and when
// packaged (resources/app/...). Deriving it from this file keeps the CLI path
// correct in both cases, unlike app.getAppPath() which varies by launch mode.
const APP_ROOT = path.resolve(__dirname, "..");
const HOST = "127.0.0.1";
// The app logo, so the dev-mode window/dock shows our mark instead of the
// default Electron atom (the packaged .app already embeds build/icon.icns).
const APP_ICON = nativeImage.createFromPath(path.join(APP_ROOT, "build", "icon.png"));

let serverProcess = null;
let serverPort = 0;
let mainWindow = null;
let quitting = false;

/** Path to the built CLI entrypoint, resolved for both dev and packaged runs. */
function cliEntry() {
  return path.join(APP_ROOT, "dist", "cli", "codex-snapshot.mjs");
}

/** Grab an available TCP port on the loopback interface. */
function findFreePort() {
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
        "Codex Snapshots",
        `The local viewer server stopped unexpectedly (code ${code ?? "?"}, signal ${signal ?? "none"}).`,
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

function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#231d12",
    icon: APP_ICON,
    title: "Codex Snapshots",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(startUrl);

  // Open external links (share URLs, docs) in the user's real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://${HOST}:${serverPort}`)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://${HOST}:${serverPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu(getStartUrl) {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open in Browser",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => shell.openExternal(getStartUrl()),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrap() {
  // macOS shows the dock icon from the .app bundle; in dev there is none, so
  // set it explicitly (also covers `electron .` runs).
  if (process.platform === "darwin" && app.dock && !APP_ICON.isEmpty()) {
    app.dock.setIcon(APP_ICON);
  }
  let startUrl;
  try {
    startUrl = await startServer();
  } catch (error) {
    dialog.showErrorBox(
      "Codex Snapshots",
      `Failed to start the local viewer server:\n\n${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
    return;
  }
  buildMenu(() => startUrl);
  createWindow(startUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(startUrl);
    }
  });
}

// Single-instance lock so we don't spawn multiple servers.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(bootstrap);

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });

  process.on("exit", stopServer);
}
