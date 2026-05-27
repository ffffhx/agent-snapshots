#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const label = process.env.SNAPSHOT_LAUNCH_AGENT_LABEL || "com.codex-snapshots.viewer";
const uid = process.getuid?.() ?? Number.parseInt(process.env.UID || "", 10);
const homeDir = os.homedir();
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
const logsDir = path.join(homeDir, "Library", "Logs", "codex-snapshots");
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const stdoutPath = path.join(logsDir, "codex-snapshot.out.log");
const stderrPath = path.join(logsDir, "codex-snapshot.err.log");
const defaultApiUrl = "http://127.0.0.1:8787";
const defaultSiteUrl = "http://127.0.0.1:8787";

const command = process.argv[2] || "status";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (command === "install") {
    await install();
    return;
  }
  if (command === "uninstall") {
    await uninstall();
    return;
  }
  if (command === "status") {
    await status();
    return;
  }
  if (command === "logs") {
    await logs();
    return;
  }
  printHelp();
  process.exitCode = 1;
}

async function install() {
  const pnpmPath = await resolvePnpmPath();
  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const plist = renderPlist({
    pnpmPath,
    apiUrl: process.env.SNAPSHOT_SHARE_API_URL || defaultApiUrl,
    siteUrl: process.env.SNAPSHOT_SHARE_SITE_URL || defaultSiteUrl,
  });

  await writeFile(plistPath, plist, "utf8");
  await bootoutIfLoaded();
  await execLaunchctl(["bootstrap", guiDomain(), plistPath]);
  await execLaunchctl(["kickstart", "-k", `${guiDomain()}/${label}`]);

  console.log(`Installed ${label}`);
  console.log(`Plist: ${plistPath}`);
  console.log(`Logs: ${stdoutPath}`);
  console.log(`Preview: http://127.0.0.1:4321/`);
}

async function uninstall() {
  await bootoutIfLoaded();
  await rm(plistPath, { force: true });
  console.log(`Uninstalled ${label}`);
}

async function status() {
  if (!existsSync(plistPath)) {
    console.log(`Not installed: ${plistPath}`);
    return;
  }
  try {
    const { stdout } = await execLaunchctl(["print", `${guiDomain()}/${label}`]);
    const state = stdout.match(/state = ([^\n]+)/)?.[1]?.trim() || "unknown";
    const pid = stdout.match(/pid = (\d+)/)?.[1] || "";
    console.log(`${label}: ${state}${pid ? `, pid=${pid}` : ""}`);
    console.log(`Plist: ${plistPath}`);
    console.log(`Preview: http://127.0.0.1:4321/`);
  } catch (error) {
    console.log(`${label}: installed but not loaded`);
    console.log(`Plist: ${plistPath}`);
    if (error instanceof Error && error.message) {
      console.log(error.message);
    }
  }
}

async function logs() {
  console.log(`==> ${stdoutPath}`);
  console.log(await tailFile(stdoutPath));
  console.log(`==> ${stderrPath}`);
  console.log(await tailFile(stderrPath));
}

async function bootoutIfLoaded() {
  try {
    await execLaunchctl(["bootout", guiDomain(), plistPath]);
  } catch {}
  try {
    await execLaunchctl(["bootout", `${guiDomain()}/${label}`]);
  } catch {}
}

async function resolvePnpmPath() {
  if (process.env.PNPM_EXECUTABLE) {
    return process.env.PNPM_EXECUTABLE;
  }
  try {
    const { stdout } = await execFileAsync("/bin/zsh", ["-lc", "command -v pnpm"], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    });
    const pnpmPath = stdout.trim().split("\n")[0];
    if (pnpmPath) {
      return pnpmPath;
    }
  } catch {}
  throw new Error("Cannot find pnpm. Install pnpm first, or run with PNPM_EXECUTABLE=/absolute/path/to/pnpm.");
}

function renderPlist({ pnpmPath, apiUrl, siteUrl }) {
  const shellCommand = `cd ${shellQuote(repoRoot)} && exec ${shellQuote(pnpmPath)} snapshot:daemon`;
  const stablePath = [
    path.dirname(pnpmPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
  const env = {
    PATH: process.env.SNAPSHOT_DAEMON_PATH || stablePath,
    SNAPSHOT_SHARE_API_URL: apiUrl,
    SNAPSHOT_SHARE_SITE_URL: siteUrl,
    SNAPSHOT_VIEWER_ALLOWED_ORIGINS:
      process.env.SNAPSHOT_VIEWER_ALLOWED_ORIGINS ||
      "http://127.0.0.1:3000,http://localhost:3000",
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(shellCommand)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
  .join("\n")}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function guiDomain() {
  if (!Number.isFinite(uid)) {
    throw new Error("Cannot determine current macOS user id.");
  }
  return `gui/${uid}`;
}

async function execLaunchctl(args) {
  return execFileAsync("/bin/launchctl", args, {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
  });
}

async function tailFile(filePath, lines = 80) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.split(/\r?\n/).slice(-lines).join("\n").trimEnd() || "(empty)";
  } catch {
    return "(missing)";
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function printHelp() {
  console.log(`Usage:
  pnpm snapshot:install-daemon
  pnpm snapshot:daemon:status
  pnpm snapshot:daemon:logs
  pnpm snapshot:uninstall-daemon

Environment:
  PNPM_EXECUTABLE=/absolute/path/to/pnpm
  SNAPSHOT_SHARE_API_URL=${defaultApiUrl}
  SNAPSHOT_SHARE_SITE_URL=${defaultSiteUrl}
  SNAPSHOT_VIEWER_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
`);
}
