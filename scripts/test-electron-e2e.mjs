#!/usr/bin/env node

// This smoke test intentionally stays out of the default `test` chain because
// Playwright's Electron launcher needs a GUI-capable environment.

import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const LAUNCH_TIMEOUT_MS = 30_000;
const PROCESS_EXIT_TIMEOUT_MS = 15_000;
const PORT_CLOSE_TIMEOUT_MS = 7_500;
const PREVIEW_END_MARKER = "END_OF_COMPLETE_PREVIEW_MESSAGE";
const LONG_PREVIEW_TEXT = Array.from({ length: 36 }, (_, index) => (
  `Preview line ${String(index + 1).padStart(2, "0")}: this text verifies that the launcher preview keeps every line visible.`
)).join("\n") + `\n${PREVIEW_END_MARKER}`;

process.chdir(ROOT_DIR);

const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-snapshots-electron-e2e-"));
let electronApp = null;
let appProcess = null;
let serverPort = 0;
let explicitQuitStarted = false;
const appOutput = [];
const pageErrors = [];
const wiredPages = new WeakSet();

try {
  const clean = await createCleanEnv(tempDir);

  step("launching Electron app");
  electronApp = await electron.launch({
    args: ["electron/main.mjs"],
    env: clean,
  });
  appProcess = electronApp.process();
  collectProcessOutput(appProcess, appOutput);
  electronApp.on("window", wirePage);

  await electronApp.evaluate(({ app }) => {
    if (!globalThis.__agentSnapshotsE2E) {
      globalThis.__agentSnapshotsE2E = { beforeQuitCount: 0 };
      app.on("before-quit", () => {
        globalThis.__agentSnapshotsE2E.beforeQuitCount += 1;
      });
    }
  });

  const launcherPage = await waitForLauncherPage(electronApp);
  wirePage(launcherPage);
  const launcherUrl = new URL(launcherPage.url());
  serverPort = Number(launcherUrl.port);
  assert(Number.isInteger(serverPort) && serverPort > 0, `expected a localhost server port in ${launcherPage.url()}`);
  step(`launcher ready at ${launcherPage.url()}`);

  await waitForLauncherContent(launcherPage);
  assertNoPageErrors();
  step("launcher content loaded without page errors");

  await assertSessionRecoveryBridgeReady(launcherPage);
  assertNoPageErrors();
  step("session recovery bridge returned the clean startup state");

  await assertLauncherPreviewShowsCompleteMessage(launcherPage);
  assertNoPageErrors();
  step("launcher preview shows complete messages and scrolls at the panel level");

  await assertLauncherResumeInteraction(launcherPage);
  assertNoPageErrors();
  step("launcher resume interaction handles loading, dedupe, success, and failure");

  const quota = await launcherPage.evaluate(async () => {
    const response = await fetch("/api/quota");
    const payload = await response.json();
    return { status: response.status, payload };
  });
  assert(quota.status === 200, `/api/quota should return 200, got ${quota.status}`);
  assert(
    quota.payload && typeof quota.payload === "object" && typeof quota.payload.available === "boolean",
    `/api/quota should include boolean available, got ${JSON.stringify(quota.payload)}`,
  );
  assertNoPageErrors();
  step("/api/quota returned expected JSON shape");

  await assertDeepLinkShowsLauncher(electronApp, appProcess);
  assertNoPageErrors();
  step("open-url deep link path handled without crash");

  await closeWindowsWithoutQuitting(electronApp, appProcess);
  step("closing windows left the tray app process alive");

  explicitQuitStarted = true;
  const exitPromise = waitForProcessExit(appProcess, PROCESS_EXIT_TIMEOUT_MS);
  await electronApp.evaluate(({ app }) => {
    app.quit();
  });
  const exit = await exitPromise;
  assert(exit.code === 0, `expected Electron to exit with code 0, got code=${exit.code} signal=${exit.signal || "none"}`);
  step("Electron process exited cleanly");

  await waitForConnectionRefused(serverPort, PORT_CLOSE_TIMEOUT_MS);
  step(`server port ${serverPort} refused connections after app exit`);

  console.log("[electron-e2e] PASS");
} catch (error) {
  console.error("[electron-e2e] FAIL");
  console.error(formatError(error));
  if (appOutput.length) {
    console.error("\n[electron-e2e] Electron output:");
    console.error(appOutput.slice(-80).join("").trimEnd());
  }
  process.exitCode = 1;
} finally {
  if (!explicitQuitStarted && electronApp && isProcessRunning(appProcess)) {
    await electronApp.close().catch(() => {});
  }
  await rm(tempDir, { recursive: true, force: true });
}

async function createCleanEnv(root) {
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex");
  const claudeHome = path.join(root, "claude");
  const prefsDir = path.join(root, "prefs");
  const cacheHome = path.join(root, "cache");
  const configHome = path.join(root, "config");

  await Promise.all([
    home,
    codexHome,
    claudeHome,
    prefsDir,
    cacheHome,
    configHome,
  ].map((dir) => mkdir(dir, { recursive: true })));
  await writeClaudeFixture(claudeHome);

  const inheritedKeys = [
    "APPDATA",
    "ComSpec",
    "DBUS_SESSION_BUS_ADDRESS",
    "DISPLAY",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "LOGNAME",
    "PATH",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROCESSOR_ARCHITECTURE",
    "SHELL",
    "SSH_AUTH_SOCK",
    "SystemRoot",
    "TEMP",
    "TERM",
    "TMP",
    "TMPDIR",
    "USER",
    "WAYLAND_DISPLAY",
    "WINDIR",
    "XAUTHORITY",
    "XDG_RUNTIME_DIR",
    "__CF_USER_TEXT_ENCODING",
  ];
  const env = {};
  for (const key of inheritedKeys) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }

  Object.assign(env, {
    AGENT_SNAPSHOT_DISABLE_CODEX_HOME_AUTODETECT: "1",
    AGENT_SNAPSHOT_PREFS_DIR: prefsDir,
    CLAUDE_HOME: claudeHome,
    CODEX_HOME: codexHome,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    HOME: home,
    LANG: env.LANG || "en_US.UTF-8",
    LOGNAME: env.LOGNAME || env.USER || "agent-snapshots-e2e",
    PWD: ROOT_DIR,
    USER: env.USER || "agent-snapshots-e2e",
    XDG_CACHE_HOME: cacheHome,
    XDG_CONFIG_HOME: configHome,
  });
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

async function writeClaudeFixture(claudeHome) {
  const sessionId = "11111111-2222-4333-8444-555555555555";
  const cwd = "/tmp/agent-snapshots-electron-e2e";
  const timestamp = new Date().toISOString();
  const projectDir = path.join(claudeHome, "projects", "-tmp-agent-snapshots-electron-e2e");
  const rows = [
    {
      sessionId,
      cwd,
      type: "user",
      message: { role: "user", content: "Electron E2E resume fixture" },
      timestamp,
    },
    {
      sessionId,
      cwd,
      type: "assistant",
      message: { role: "assistant", content: LONG_PREVIEW_TEXT },
      timestamp: new Date(Date.now() + 1).toISOString(),
    },
  ];
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, `${sessionId}.jsonl`),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
}

async function waitForLauncherPage(app) {
  const page = await withTimeout(app.firstWindow(), LAUNCH_TIMEOUT_MS, "launcher window to appear");
  wirePage(page);
  await page.waitForURL((url) => url.pathname.endsWith("/launcher"), { timeout: LAUNCH_TIMEOUT_MS });
  await page.waitForLoadState("domcontentloaded", { timeout: LAUNCH_TIMEOUT_MS });
  const title = await page.title();
  assert(title.includes("Agent Snapshots"), `expected title to contain Agent Snapshots, got ${JSON.stringify(title)}`);
  return page;
}

async function waitForLauncherContent(page) {
  await page.locator("#q").waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
  await page.waitForFunction(() => {
    const list = document.querySelector("#list");
    if (!list) {
      return false;
    }
    const text = list.textContent || "";
    const loading = list.querySelector(".spin") || /正在(载入|搜索)/.test(text);
    if (loading) {
      return false;
    }
    return Boolean(list.querySelector(".row") || list.querySelector(".empty"));
  }, undefined, { timeout: LAUNCH_TIMEOUT_MS });
}

async function assertSessionRecoveryBridgeReady(page) {
  const recovery = await page.evaluate(async () => {
    const desktop = window.agentSnapshotsDesktop;
    if (!desktop || typeof desktop.getSessionRecovery !== "function") {
      return null;
    }
    return desktop.getSessionRecovery();
  });
  assert(recovery, "launcher preload should expose the session recovery bridge");
  assert(recovery.count === 0, `clean launch should have no interrupted sessions, got ${JSON.stringify(recovery)}`);
  assert(recovery.restoring === false, `clean launch should not be restoring, got ${JSON.stringify(recovery)}`);
  assert(await page.locator("#recovery").isVisible(), "recovery readiness banner should be visible in Electron");
  assert(
    (await page.locator("#recoveryTitle").textContent())?.includes("崩溃恢复已开启"),
    "clean launch should explain that crash recovery is ready",
  );
  assert(!(await page.locator("#recoveryRestore").isEnabled()), "restore button should be disabled without interrupted sessions");
}

async function assertLauncherPreviewShowsCompleteMessage(page) {
  const row = page.locator(".row", { hasText: "Electron E2E resume fixture" });
  await row.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
  await row.click();

  const panel = page.locator("#peek");
  await panel.locator(".peek-turn.assistant").filter({ hasText: PREVIEW_END_MARKER }).waitFor({
    state: "visible",
    timeout: LAUNCH_TIMEOUT_MS,
  });
  const metrics = await panel.evaluate((element, endMarker) => {
    const turn = [...element.querySelectorAll(".peek-turn.assistant")]
      .find((candidate) => candidate.textContent?.includes(endMarker));
    const body = element.querySelector(".peek-body");
    if (!(turn instanceof HTMLElement) || !(body instanceof HTMLElement)) return null;
    const style = getComputedStyle(turn);
    return {
      text: turn.textContent || "",
      turnClientHeight: turn.clientHeight,
      turnScrollHeight: turn.scrollHeight,
      lineClamp: style.webkitLineClamp,
      overflow: style.overflow,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyOverflowY: getComputedStyle(body).overflowY,
    };
  }, PREVIEW_END_MARKER);

  assert(metrics, "preview should contain the long assistant message");
  assert(metrics.text === LONG_PREVIEW_TEXT, "preview should preserve the complete assistant message");
  assert(metrics.turnScrollHeight <= metrics.turnClientHeight + 1, `message card should not clip internally: ${JSON.stringify(metrics)}`);
  assert(metrics.lineClamp === "none", `message card should not use line clamp: ${JSON.stringify(metrics)}`);
  assert(metrics.overflow !== "hidden", `message card should not hide overflow: ${JSON.stringify(metrics)}`);
  assert(metrics.bodyScrollHeight > metrics.bodyClientHeight, `long previews should scroll in the panel: ${JSON.stringify(metrics)}`);
  assert(["auto", "scroll"].includes(metrics.bodyOverflowY), `preview body should own scrolling: ${JSON.stringify(metrics)}`);

  await panel.locator(".peek-close").click();
  await waitFor(async () => (await panel.getAttribute("aria-hidden")) === "true", {
    timeoutMs: 5_000,
    label: "preview panel to close",
  });
}

async function assertLauncherResumeInteraction(page) {
  let requestCount = 0;
  let releaseFirstRequest = null;
  const firstRequestGate = new Promise((resolve) => {
    releaseFirstRequest = resolve;
  });

  await page.route("**/api/resume-in-orca?**", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await firstRequestGate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, via: "orca" }),
      });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Orca E2E test failure" }),
    });
  });

  const row = page.locator(".row", { hasText: "Electron E2E resume fixture" });
  await row.waitFor({ state: "visible", timeout: LAUNCH_TIMEOUT_MS });
  const resumeButton = row.locator('[data-action="resume"]');
  assert(await resumeButton.isEnabled(), "resume button should start enabled");
  assert((await resumeButton.textContent())?.includes("Orca 继续"), "resume button should show its idle label");

  await resumeButton.evaluate((button) => {
    button.click();
    button.click();
  });
  await waitFor(() => requestCount === 1, { timeoutMs: 5_000, label: "first resume request" });
  assert(!(await resumeButton.isEnabled()), "resume button should be disabled while the request is pending");
  assert((await resumeButton.textContent())?.includes("唤起中"), "resume button should show its loading label");
  assert(await resumeButton.locator(".spin").isVisible(), "resume button should show a loading spinner");
  assert((await page.locator("#toast").textContent())?.includes("正在唤起 Orca"), "toast should describe the pending action");

  await resumeButton.evaluate((button) => button.click());
  await delay(100);
  assert(requestCount === 1, `disabled resume button should dedupe requests, got ${requestCount}`);

  releaseFirstRequest();
  await page.locator("#toast").filter({ hasText: "已在 Orca 继续" }).waitFor({ state: "visible", timeout: 5_000 });
  await waitFor(() => resumeButton.isEnabled(), { timeoutMs: 5_000, label: "resume button to reset after success" });
  assert((await resumeButton.textContent())?.includes("Orca 继续"), "resume button should restore its idle label after success");

  await resumeButton.click();
  await waitFor(() => requestCount === 2, { timeoutMs: 5_000, label: "second resume request" });
  await page.locator("#toast").filter({ hasText: "Orca E2E test failure" }).waitFor({ state: "visible", timeout: 5_000 });
  await waitFor(() => resumeButton.isEnabled(), { timeoutMs: 5_000, label: "resume button to reset after failure" });
  assert(await page.locator("#toast").evaluate((toast) => toast.classList.contains("err")), "failure toast should use the error state");
}

async function assertDeepLinkShowsLauncher(app, child) {
  await app.evaluate(({ BrowserWindow }) => {
    const launcher = BrowserWindow.getAllWindows().find((window) => {
      try {
        return new URL(window.webContents.getURL()).pathname.endsWith("/launcher");
      } catch {
        return false;
      }
    });
    launcher?.hide();
  });

  const before = await windowSnapshot(app);
  const beforeCount = before.length;
  await app.evaluate(({ app: electronApp }) => {
    electronApp.emit("open-url", { preventDefault() {} }, "agent-snapshots://launcher");
  });

  let after;
  try {
    after = await waitFor(async () => {
      const snapshot = await windowSnapshot(app);
      const launcher = findLauncherWindow(snapshot);
      return launcher && (launcher.visible || launcher.focused) ? { snapshot, launcher } : false;
    }, { timeoutMs: 5_000, label: "deep link to show or focus launcher" });
  } catch {
    const snapshot = await windowSnapshot(app);
    const launcher = findLauncherWindow(snapshot);
    assert(launcher, "launcher window disappeared after open-url");
    assertProcessRunning(child);
    after = { snapshot, launcher };
  }

  assert(
    after.snapshot.length === beforeCount,
    `open-url should not create or destroy windows; before=${beforeCount} after=${after.snapshot.length}`,
  );
  assert(
    after.launcher.visible || after.launcher.focused || after.snapshot.length === beforeCount,
    `launcher was not visible/focused after open-url: ${JSON.stringify(after.launcher)}`,
  );
}

async function closeWindowsWithoutQuitting(app, child) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.close();
      }
    }
  });
  await delay(1_000);
  assertProcessRunning(child);

  const state = await app.evaluate(({ BrowserWindow }) => ({
    beforeQuitCount: globalThis.__agentSnapshotsE2E?.beforeQuitCount ?? -1,
    windows: BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      visible: !window.isDestroyed() && window.isVisible(),
      url: !window.isDestroyed() ? window.webContents.getURL() : "",
    })),
  }));
  assert(state.beforeQuitCount === 0, `closing windows should not emit before-quit, got ${state.beforeQuitCount}`);
}

async function windowSnapshot(app) {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({
    id: window.id,
    visible: !window.isDestroyed() && window.isVisible(),
    focused: !window.isDestroyed() && window.isFocused(),
    minimized: !window.isDestroyed() && window.isMinimized(),
    url: !window.isDestroyed() ? window.webContents.getURL() : "",
  })));
}

function findLauncherWindow(snapshot) {
  return snapshot.find((window) => {
    try {
      return new URL(window.url).pathname.endsWith("/launcher");
    } catch {
      return false;
    }
  });
}

async function waitForConnectionRefused(port, timeoutMs) {
  let last = null;
  await waitFor(async () => {
    last = await probePort(port);
    return !last.open && last.code === "ECONNREFUSED";
  }, {
    timeoutMs,
    intervalMs: 150,
    label: () => `server port ${port} to refuse connections, last probe was ${JSON.stringify(last)}`,
  });
}

function probePort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port });
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500, () => finish({ open: true, code: "TIMEOUT" }));
    socket.once("connect", () => finish({ open: true, code: "CONNECTED" }));
    socket.once("error", (error) => finish({ open: false, code: error?.code || "ERROR" }));
  });
}

function waitForProcessExit(child, timeoutMs) {
  if (!child) {
    return Promise.reject(new Error("Electron child process is not available"));
  }
  if (!isProcessRunning(child)) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Electron process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function collectProcessOutput(child, output) {
  if (!child) {
    return;
  }
  child.stdout?.on("data", (chunk) => output.push(String(chunk)));
  child.stderr?.on("data", (chunk) => output.push(String(chunk)));
}

function wirePage(page) {
  if (!page || wiredPages.has(page)) {
    return;
  }
  wiredPages.add(page);
  page.on("pageerror", (error) => {
    pageErrors.push(formatError(error));
  });
}

function assertNoPageErrors() {
  assert(!pageErrors.length, `page errors were emitted:\n${pageErrors.join("\n---\n")}`);
}

async function waitFor(fn, { timeoutMs, intervalMs = 100, label }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  const text = typeof label === "function" ? label() : label;
  throw new Error(`${text} timed out after ${timeoutMs}ms${lastError ? `: ${formatError(lastError)}` : ""}`);
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertProcessRunning(child) {
  assert(isProcessRunning(child), `Electron process exited early with code=${child?.exitCode} signal=${child?.signalCode || "none"}`);
}

function isProcessRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function step(message) {
  console.log(`[electron-e2e] ${message}`);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}
