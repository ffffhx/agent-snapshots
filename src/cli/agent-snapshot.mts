#!/usr/bin/env node
// @ts-nocheck

import { execFile } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  escapeHtml,
  sanitizeSnapshotHtml as sanitizeSnapshotTurnHtml,
  stripAppDirectives as stripCodexAppDirectives,
} from "../shared/sanitize.js";
import { isInterruptionMarker, renderTranscriptHtml } from "../renderers/transcript.js";
import { send, sendJson } from "../server/http.js";
import { createGitHubGist } from "../server/gist-publish.mjs";
import { serveLocalViewer } from "../server/local-viewer.mjs";
import { listSessions, loadSnapshot, searchSessions } from "../sources/index.mjs";

const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
const cliPath = fileURLToPath(import.meta.url);
const VERSION = readPackageVersion(packageRoot);
const DEFAULT_LIMIT = 40;
const DEFAULT_SERVER_LIMIT = 80;
const DEFAULT_TRAE_RECORDER_PORT = 4732;
const DEFAULT_VIEWER_PORT = 4321;
const MAX_TRAE_CAPTURE_POST_BYTES = 64 * 1024 * 1024;
const DEFAULT_SNAPSHOT_SHARE_API_URL = "https://8-218-149-148.anyip.dev/agent-snapshots";
const DEFAULT_SNAPSHOT_SHARE_SITE_URL = "https://ffffhx.github.io/agent-snapshots";
const DEFAULT_DAEMON_LABEL = "com.agent-snapshots.viewer";
const SNAPSHOT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Agent Snapshots"><rect width="64" height="64" rx="14" fill="#c33f28"/><g transform="rotate(-5 32 32)"><rect x="18.5" y="16" width="27" height="33" rx="3" fill="#5c160c" opacity="0.22"/><rect x="18.5" y="15" width="27" height="33" rx="3" fill="#f6ecd6"/><g fill="#c9bb98"><rect x="22.5" y="21" width="19" height="2" rx="1"/><rect x="22.5" y="25.5" width="17" height="2" rx="1"/><rect x="22.5" y="30" width="19" height="2" rx="1"/><rect x="22.5" y="34.5" width="13.5" height="2" rx="1"/></g><circle cx="40.5" cy="42.5" r="6.2" fill="#a82f1c"/><circle cx="40.5" cy="42.5" r="6.2" fill="none" stroke="#fff3df" stroke-width="0.9" stroke-opacity="0.85"/><circle cx="40.5" cy="42.5" r="1.4" fill="#fff3df"/></g></svg>`;
const execFileAsync = promisify(execFile);
let defaultShareConfigCache;

function findPackageRoot(startDir) {
  let current = startDir;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(current, "package.json"), "utf8"));
      if (pkg?.name === "agent-snapshots") {
        return current;
      }
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(startDir, "..");
}

function readPackageVersion(root) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "daemon" && parsed.options.help) {
    printDaemonHelp();
    return;
  }
  if (parsed.options.help || parsed.command === "help" || !parsed.command) {
    printHelp();
    return;
  }

  const codexHome = path.resolve(parsed.options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const claudeHome = path.resolve(parsed.options.claudeHome || process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"));
  const traeHome = path.resolve(parsed.options.traeHome || process.env.TRAE_HOME || path.join(os.homedir(), ".trae-cn"));
  const traeAppHome = path.resolve(parsed.options.traeAppHome || process.env.TRAE_APP_HOME || path.join(os.homedir(), "Library", "Application Support", "Trae CN"));
  // The data dir was ~/.codex-snapshot before the agent-snapshots rename;
  // adopt the old dir once so existing Trae recordings survive the rename.
  const dataDir = path.join(os.homedir(), ".agent-snapshot");
  const legacyDataDir = path.join(os.homedir(), ".codex-snapshot");
  if (!existsSync(dataDir) && existsSync(legacyDataDir)) {
    try {
      renameSync(legacyDataDir, dataDir);
    } catch {
      // Keep using the default below; worst case recordings restart fresh.
    }
  }
  const traeRecordingsDir = path.resolve(parsed.options.traeRecordingsDir || process.env.TRAE_RECORDINGS_DIR || path.join(dataDir, "trae-recordings"));

  if (parsed.command === "list") {
    const sessions = await listSessions({
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      limit: parsed.options.limit || DEFAULT_LIMIT,
      cwd: parsed.options.cwd,
      includeArchived: parsed.options.includeArchived,
      source: parsed.options.source,
    });
    if (parsed.options.json) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      printSessionList(sessions);
    }
    return;
  }

  if (parsed.command === "search") {
    const query = parsed.positionals.join(" ").trim();
    if (!query) {
      throw new Error("search requires a query");
    }
    const result = await searchSessions({
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      query,
      limit: parsed.options.limit || 10,
      scanLimit: parsed.options.scanLimit || 600,
      cwd: parsed.options.cwd,
      includeArchived: parsed.options.includeArchived,
      source: parsed.options.source,
      completeOnly: true,
      includeTools: parsed.options.includeTools,
      includeToolOutput: parsed.options.includeToolOutput,
    });
    if (parsed.options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printSearchResults(result);
    }
    return;
  }

  if (parsed.command === "preview") {
    const ref = parsed.positionals[0];
    if (!ref) {
      throw new Error("preview requires a session id or JSONL path");
    }
    const snapshot = await loadSnapshot(ref, {
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      includeTools: parsed.options.includeTools,
      includeToolOutput: parsed.options.includeToolOutput,
      redact: !parsed.options.noRedact,
    });
    if (parsed.options.json) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      console.log(renderTextPreview(snapshot));
    }
    return;
  }

  if (parsed.command === "export") {
    const ref = parsed.positionals[0];
    if (!ref) {
      throw new Error("export requires a session id or JSONL path");
    }
    if (parsed.options.gist && parsed.options.noRedact && !parsed.options.allowUnredacted) {
      throw new Error("export --gist refuses --no-redact unless --allow-unredacted is also set");
    }
    const format = parsed.options.format || (parsed.options.md ? "md" : "html");
    const snapshot = await loadSnapshot(ref, {
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      includeTools: parsed.options.includeTools,
      includeToolOutput: parsed.options.includeToolOutput,
      redact: !parsed.options.noRedact,
    });
    if (parsed.options.gist) {
      const result = await createGitHubGist(renderHtml(snapshot), { publicGist: parsed.options.gistPublic });
      console.log(result.gistUrl);
      console.log(result.previewUrl);
      return;
    }
    const output = format === "md" ? renderMarkdown(snapshot) : renderHtml(snapshot);
    if (parsed.options.output) {
      await mkdir(path.dirname(path.resolve(parsed.options.output)), { recursive: true });
      await writeFile(parsed.options.output, output, "utf8");
      console.log(path.resolve(parsed.options.output));
    } else {
      console.log(output);
    }
    return;
  }

  if (parsed.command === "publish") {
    const ref = parsed.positionals[0];
    if (!ref) {
      throw new Error("publish requires a session id or JSONL path");
    }
    if (parsed.options.noRedact && !parsed.options.allowUnredacted) {
      throw new Error("publish refuses --no-redact unless --allow-unredacted is also set");
    }
    const snapshot = await loadSnapshot(ref, {
      codexHome,
      claudeHome,
      traeHome,
      traeAppHome,
      traeRecordingsDir,
      includeTools: parsed.options.includeTools,
      includeToolOutput: parsed.options.includeToolOutput,
      redact: !parsed.options.noRedact,
    });
    applySafetyChecksOption(snapshot, Boolean(parsed.options.withSafety));
    const result = await publishSnapshot(snapshot, {
      apiUrl: parsed.options.apiUrl,
      token: parsed.options.shareToken,
      siteUrl: parsed.options.siteUrl,
      expiresInDays: parsed.options.expiresInDays,
    });
    console.log(`Published ${snapshot.engineLabel || "Codex"} snapshot: ${snapshot.title}`);
    console.log(`Share id: ${result.id}`);
    console.log(`URL: ${result.url}`);
    return;
  }

  if (parsed.command === "daemon") {
    await runDaemonCommand(parsed.positionals[0] || "status", parsed.options);
    return;
  }

  if (parsed.command === "serve") {
    const port = parsed.options.port || DEFAULT_VIEWER_PORT;
    const host = parsed.options.host || "127.0.0.1";
    await serve({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, host, port });
    return;
  }

  if (parsed.command === "record-trae") {
    const port = parsed.options.port || DEFAULT_TRAE_RECORDER_PORT;
    const host = parsed.options.host || "127.0.0.1";
    await serveTraeRecorder({
      host,
      port,
      traeRecordingsDir,
      recordSensitiveContext: parsed.options.recordSensitiveContext,
    });
    return;
  }

  throw new Error(`unknown command: ${parsed.command}`);
}

function parseArgs(args) {
  const options = {
    codexHome: "",
    cwd: "",
    format: "",
    gist: false,
    gistPublic: false,
    help: false,
    host: "",
    includeArchived: true,
    includeToolOutput: false,
    includeTools: false,
    json: false,
    label: "",
    limit: 0,
    md: false,
    noRedact: false,
    output: "",
    port: 0,
    scanLimit: 0,
    apiUrl: "",
    siteUrl: "",
    shareToken: "",
    expiresInDays: 0,
    allowUnredacted: false,
    withSafety: false,
    source: "codex",
    claudeHome: "",
    traeAppHome: "",
    traeHome: "",
    traeRecordingsDir: "",
    recordSensitiveContext: false,
  };
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--version") {
      console.log(VERSION);
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--html") {
      options.format = "html";
      continue;
    }
    if (arg === "--gist") {
      options.gist = true;
      options.format = "html";
      continue;
    }
    if (arg === "--gist-public") {
      options.gistPublic = true;
      continue;
    }
    if (arg === "--md" || arg === "--markdown") {
      options.format = "md";
      options.md = true;
      continue;
    }
    if (arg === "--include-tools") {
      options.includeTools = true;
      continue;
    }
    if (arg === "--include-tool-output") {
      options.includeToolOutput = true;
      options.includeTools = true;
      continue;
    }
    if (arg === "--no-redact") {
      options.noRedact = true;
      continue;
    }
    if (arg === "--record-sensitive-context") {
      options.recordSensitiveContext = true;
      continue;
    }
    if (arg === "--allow-unredacted") {
      options.allowUnredacted = true;
      continue;
    }
    if (arg === "--with-safety") {
      options.withSafety = true;
      continue;
    }
    if (arg === "--live-only") {
      options.includeArchived = false;
      continue;
    }
    if (arg === "--codex-home" || arg === "--claude-home" || arg === "--trae-home" || arg === "--trae-app-home" || arg === "--trae-recordings-dir" || arg === "--cwd" || arg === "--limit" || arg === "--scan-limit" || arg === "--output" || arg === "-o" || arg === "--port" || arg === "--host" || arg === "--source" || arg === "--api-url" || arg === "--site-url" || arg === "--share-token" || arg === "--expires-in-days" || arg === "--label") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--codex-home") {
        options.codexHome = value;
      } else if (arg === "--claude-home") {
        options.claudeHome = value;
      } else if (arg === "--trae-home") {
        options.traeHome = value;
      } else if (arg === "--trae-app-home") {
        options.traeAppHome = value;
      } else if (arg === "--trae-recordings-dir") {
        options.traeRecordingsDir = value;
      } else if (arg === "--cwd") {
        options.cwd = value;
      } else if (arg === "--limit") {
        options.limit = readPositiveInteger(value, "--limit");
      } else if (arg === "--scan-limit") {
        options.scanLimit = readPositiveInteger(value, "--scan-limit");
      } else if (arg === "--label") {
        options.label = value;
      } else if (arg === "--output" || arg === "-o") {
        options.output = value;
      } else if (arg === "--port") {
        options.port = readPositiveInteger(value, "--port");
      } else if (arg === "--host") {
        options.host = value;
      } else if (arg === "--source") {
        if (!["codex", "claude", "trae", "all"].includes(value)) {
          throw new Error("--source must be codex, claude, trae, or all");
        }
        options.source = value;
      } else if (arg === "--api-url") {
        options.apiUrl = value;
      } else if (arg === "--site-url") {
        options.siteUrl = value;
      } else if (arg === "--share-token") {
        options.shareToken = value;
      } else if (arg === "--expires-in-days") {
        options.expiresInDays = readPositiveInteger(value, "--expires-in-days");
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  return {
    command: positionals[0] || "",
    options,
    positionals: positionals.slice(1),
  };
}

function readPositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function readNonNegativeInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

async function runDaemonCommand(action, options) {
  if (action === "help" || options.help) {
    printDaemonHelp();
    return;
  }
  if (action === "install") {
    await installDaemon(options);
    return;
  }
  if (action === "uninstall") {
    await uninstallDaemon(options);
    return;
  }
  if (action === "status") {
    await printDaemonStatus(options);
    return;
  }
  if (action === "logs") {
    await printDaemonLogs(options);
    return;
  }
  throw new Error(`unknown daemon command: ${action}`);
}

async function installDaemon(options) {
  assertMacosDaemonSupported();
  const config = resolveDaemonConfig(options);
  await mkdir(config.launchAgentsDir, { recursive: true });
  await mkdir(config.logsDir, { recursive: true });

  await writeFile(config.plistPath, renderDaemonPlist(config), "utf8");
  await bootoutDaemonIfLoaded(config);
  await execLaunchctl(["bootstrap", guiDomain(), config.plistPath]);
  await execLaunchctl(["kickstart", "-k", `${guiDomain()}/${config.label}`]);

  console.log(`Installed ${config.label}`);
  console.log(`Plist: ${config.plistPath}`);
  console.log(`Logs: ${config.stdoutPath}`);
  console.log(`Command: ${formatDaemonCommand(config)}`);
  console.log(`Preview: http://${config.host}:${config.port}/`);
}

async function uninstallDaemon(options) {
  assertMacosDaemonSupported();
  const config = resolveDaemonConfig(options);
  await bootoutDaemonIfLoaded(config);
  await rm(config.plistPath, { force: true });
  console.log(`Uninstalled ${config.label}`);
}

async function printDaemonStatus(options) {
  assertMacosDaemonSupported();
  const config = resolveDaemonConfig(options);
  if (!existsSync(config.plistPath)) {
    console.log(`Not installed: ${config.plistPath}`);
    return;
  }
  try {
    const { stdout } = await execLaunchctl(["print", `${guiDomain()}/${config.label}`]);
    const state = stdout.match(/state = ([^\n]+)/)?.[1]?.trim() || "unknown";
    const pid = stdout.match(/pid = (\d+)/)?.[1] || "";
    console.log(`${config.label}: ${state}${pid ? `, pid=${pid}` : ""}`);
    console.log(`Plist: ${config.plistPath}`);
    console.log(`Preview: http://${config.host}:${config.port}/`);
  } catch (error) {
    console.log(`${config.label}: installed but not loaded`);
    console.log(`Plist: ${config.plistPath}`);
    if (error instanceof Error && error.message) {
      console.log(error.message);
    }
  }
}

async function printDaemonLogs(options) {
  const config = resolveDaemonConfig(options);
  console.log(`==> ${config.stdoutPath}`);
  console.log(await tailFile(config.stdoutPath));
  console.log(`==> ${config.stderrPath}`);
  console.log(await tailFile(config.stderrPath));
}

async function bootoutDaemonIfLoaded(config) {
  try {
    await execLaunchctl(["bootout", guiDomain(), config.plistPath]);
  } catch {}
  try {
    await execLaunchctl(["bootout", `${guiDomain()}/${config.label}`]);
  } catch {}
}

function resolveDaemonConfig(options) {
  const homeDir = os.homedir();
  const label = options.label || process.env.SNAPSHOT_LAUNCH_AGENT_LABEL || DEFAULT_DAEMON_LABEL;
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  const logsDir = path.join(homeDir, "Library", "Logs", "agent-snapshots");
  const nodePath = process.env.SNAPSHOT_DAEMON_NODE || process.execPath;
  const daemonCliPath = process.env.SNAPSHOT_DAEMON_CLI || cliPath;
  const host = options.host || process.env.SNAPSHOT_DAEMON_HOST || "127.0.0.1";
  const port = options.port || readOptionalPositiveInteger(process.env.SNAPSHOT_DAEMON_PORT, "SNAPSHOT_DAEMON_PORT") || DEFAULT_VIEWER_PORT;
  const apiUrl = options.apiUrl || process.env.SNAPSHOT_SHARE_API_URL || DEFAULT_SNAPSHOT_SHARE_API_URL;
  const siteUrl = options.siteUrl || process.env.SNAPSHOT_SHARE_SITE_URL || DEFAULT_SNAPSHOT_SHARE_SITE_URL;
  const stdoutPath = path.join(logsDir, "agent-snapshot.out.log");
  const stderrPath = path.join(logsDir, "agent-snapshot.err.log");
  const pathEntries = [
    path.dirname(nodePath),
    path.join(packageRoot, "node_modules", ".bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];

  return {
    apiUrl,
    cliPath: daemonCliPath,
    envPath: process.env.SNAPSHOT_DAEMON_PATH || Array.from(new Set(pathEntries.filter(Boolean))).join(":"),
    host,
    label,
    launchAgentsDir,
    logsDir,
    nodePath,
    plistPath: path.join(launchAgentsDir, `${label}.plist`),
    port,
    siteUrl,
    stderrPath,
    stdoutPath,
    viewerAllowedOrigins: process.env.SNAPSHOT_VIEWER_ALLOWED_ORIGINS || "http://127.0.0.1:3000,http://localhost:3000",
  };
}

function renderDaemonPlist(config) {
  const env = {
    PATH: config.envPath,
    SNAPSHOT_SHARE_API_URL: config.apiUrl,
    SNAPSHOT_SHARE_SITE_URL: config.siteUrl,
    SNAPSHOT_VIEWER_ALLOWED_ORIGINS: config.viewerAllowedOrigins,
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(config.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(config.nodePath)}</string>
    <string>${xmlEscape(config.cliPath)}</string>
    <string>serve</string>
    <string>--host</string>
    <string>${xmlEscape(config.host)}</string>
    <string>--port</string>
    <string>${xmlEscape(config.port)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(packageRoot)}</string>
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
  <string>${xmlEscape(config.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(config.stderrPath)}</string>
</dict>
</plist>
`;
}

function assertMacosDaemonSupported() {
  if (process.platform !== "darwin") {
    throw new Error("macOS LaunchAgent commands are only supported on macOS.");
  }
}

function guiDomain() {
  const uid = process.getuid?.() ?? Number.parseInt(process.env.UID || "", 10);
  if (!Number.isFinite(uid)) {
    throw new Error("Cannot determine current macOS user id.");
  }
  return `gui/${uid}`;
}

async function execLaunchctl(args) {
  return execFileAsync("/bin/launchctl", args, {
    cwd: packageRoot,
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

function formatDaemonCommand(config) {
  return `${shellQuote(config.nodePath)} ${shellQuote(config.cliPath)} serve --host ${shellQuote(config.host)} --port ${shellQuote(config.port)}`;
}

function readOptionalPositiveInteger(value, label) {
  return value ? readPositiveInteger(value, label) : 0;
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

async function publishSnapshot(snapshot, { apiUrl, token, siteUrl, expiresInDays, shareId }) {
  const requestPayload = createShareRequestPayload(snapshot, { apiUrl, siteUrl, expiresInDays, shareId });
  const shareToken = resolveShareToken(token);

  if (!shareToken) {
    throw new Error("Missing share API token. Set SNAPSHOT_SHARE_TOKEN, pass --share-token, or create ~/.agent-snapshots-agent.json.");
  }

  let response;

  try {
    response = await fetch(`${requestPayload.apiUrl}/api/snapshots`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${shareToken}`,
        "Content-Type": "application/json",
        "User-Agent": `agent-snapshot/${VERSION}`,
      },
      body: JSON.stringify(requestPayload.body),
    });
  } catch (error) {
    throw new Error(formatShareApiNetworkError(error, requestPayload.apiUrl));
  }

  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = { error: text };
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Publish failed with HTTP ${response.status}`);
  }
  if (!payload?.id || !payload?.url) {
    throw new Error("Publish response did not include a share id and URL");
  }

  return payload;
}

function createShareRequestPayload(snapshot, { apiUrl, siteUrl, expiresInDays, shareId }) {
  const normalizedApiUrl = resolveShareApiUrl(apiUrl);
  const normalizedSiteUrl = resolveShareSiteUrl(siteUrl);

  if (!normalizedApiUrl) {
    throw new Error("Missing share API URL. Set SNAPSHOT_SHARE_API_URL or pass --api-url.");
  }

  return {
    apiUrl: normalizedApiUrl,
    body: {
      snapshot: prepareSnapshotForCloud(snapshot),
      siteUrl: normalizedSiteUrl,
      apiUrl: normalizedApiUrl,
      expiresInDays: expiresInDays || undefined,
      shareId: shareId || undefined,
    },
  };
}

function formatShareApiNetworkError(error, apiUrl) {
  const reason = error?.cause?.code || error?.cause?.message || error?.message || String(error);
  return `Could not connect to share API at ${apiUrl}: ${reason}. Start agent-snapshot-share or set SNAPSHOT_SHARE_API_URL to the running share API.`;
}

function resolveShareApiUrl(apiUrl) {
  const config = readDefaultShareConfig();
  return normalizeUrl(
    apiUrl ||
      process.env.SNAPSHOT_SHARE_API_URL ||
      process.env.TOKEN_BOARD_API_URL ||
      process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL ||
      process.env.AGENT_SNAPSHOTS_SHARE_API_URL ||
      process.env.CODEX_SNAPSHOTS_SHARE_API_URL ||
      config.apiUrl ||
      DEFAULT_SNAPSHOT_SHARE_API_URL
  );
}

function resolveShareToken(token) {
  const config = readDefaultShareConfig();
  return (
    token ||
    process.env.SNAPSHOT_SHARE_TOKEN ||
    process.env.AGENT_SNAPSHOTS_SHARE_TOKEN ||
    process.env.CODEX_SNAPSHOTS_SHARE_TOKEN ||
    process.env.TOKEN_BOARD_AGENT_TOKEN ||
    process.env.TOKEN_BOARD_UPLOAD_TOKEN ||
    config.token ||
    ""
  );
}

function resolveShareSiteUrl(siteUrl) {
  const config = readDefaultShareConfig();
  return normalizeUrl(siteUrl || process.env.SNAPSHOT_SHARE_SITE_URL || config.siteUrl || DEFAULT_SNAPSHOT_SHARE_SITE_URL);
}

function browserShareConfig() {
  return {
    apiUrl: resolveShareApiUrl(""),
    siteUrl: resolveShareSiteUrl(""),
  };
}

async function publishAllSnapshots({
  codexHome,
  claudeHome,
  traeHome,
  traeAppHome,
  traeRecordingsDir,
  cwd,
  includeArchived,
  source,
  completeOnly,
  limit,
  includeTools,
  includeToolOutput,
  safety,
}) {
  const sessions = await listSessions({
    codexHome,
    claudeHome,
    traeHome,
    traeAppHome,
    traeRecordingsDir,
    limit,
    cwd,
    includeArchived,
    source,
    completeOnly,
  });
  const results = [];
  const failures = [];

  for (const session of sessions) {
    const ref = session.ref || session.id;
    if (!ref) {
      failures.push({
        id: "",
        title: session.title || "Untitled session",
        error: "missing session ref",
      });
      continue;
    }

    try {
      const snapshot = await loadSnapshot(ref, {
        codexHome,
        claudeHome,
        traeHome,
        traeAppHome,
        traeRecordingsDir,
        includeTools,
        includeToolOutput,
        redact: true,
      });
      applySafetyChecksOption(snapshot, safety);
      const result = await publishSnapshot(snapshot, {
        apiUrl: "",
        token: "",
        siteUrl: "",
        expiresInDays: 0,
        shareId: stableSnapshotShareId(snapshot),
      });
      results.push({
        id: snapshot.ref || ref,
        title: snapshot.title || session.title || ref,
        url: result.url,
      });
    } catch (error) {
      failures.push({
        id: ref,
        title: session.title || ref,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    total: sessions.length,
    published: results.length,
    failed: failures.length,
    firstUrl: results[0]?.url || "",
    sampleUrls: results.slice(0, 5),
    failures: failures.slice(0, 20),
  };
}

function stableSnapshotShareId(snapshot) {
  const source = [
    snapshot.engine || "codex",
    snapshot.ref || snapshot.id || snapshot.title || "",
  ].join(":");
  const digest = createHash("sha256").update(source).digest("base64url").slice(0, 32);
  return `snap_${digest}`;
}

function readDefaultShareConfig() {
  if (defaultShareConfigCache) {
    return defaultShareConfigCache;
  }

  defaultShareConfigCache = {
    apiUrl: "",
    siteUrl: "",
    token: "",
  };

  const filePaths = [
    process.env.AGENT_SNAPSHOTS_AGENT_FILE,
    process.env.CODEX_SNAPSHOTS_AGENT_FILE,
    process.env.SNAPSHOT_SHARE_TOKEN_FILE,
    process.env.TOKEN_BOARD_AGENT_FILE,
    path.join(os.homedir(), ".agent-snapshots-agent.json"),
    path.join(os.homedir(), ".codex-snapshots-agent.json"),
    path.join(os.homedir(), ".token-board-agent.json"),
  ].filter(Boolean);

  for (const filePath of filePaths) {
    try {
      const payload = JSON.parse(readFileSync(filePath, "utf8"));
      const config = {
        apiUrl: firstNonEmptyString(
          payload.snapshotShareApiUrl,
          payload.snapshotSharePublicApiUrl,
          payload.shareApiUrl,
          payload.publicApiUrl,
          payload.apiUrl
        ),
        siteUrl: firstNonEmptyString(payload.snapshotShareSiteUrl, payload.shareSiteUrl, payload.siteUrl),
        token: firstNonEmptyString(payload.snapshotShareToken, payload.agentToken, payload.token, payload.uploadToken),
      };
      if (config.apiUrl || config.siteUrl || config.token) {
        defaultShareConfigCache = config;
        return defaultShareConfigCache;
      }
    } catch {}
  }

  return defaultShareConfigCache;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function prepareSnapshotForCloud(snapshot) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  delete copy.cwd;
  delete copy.filePath;
  delete copy.displayFilePath;
  // Subagent transcripts are only rendered in the local viewer; never upload
  // them with a published share (avoids leaking and bloating cloud payloads).
  delete copy.subagents;
  copy.cloudShared = true;
  copy.cloudSharedAt = new Date().toISOString();
  return removePrivatePathFields(copy);
}

function removePrivatePathFields(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(removePrivatePathFields);
  }
  for (const key of ["cwd", "filePath", "displayFilePath"]) {
    delete value[key];
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "images") {
      continue;
    }
    value[key] = removePrivatePathFields(item);
  }
  return value;
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function printSessionList(sessions) {
  if (!sessions.length) {
    console.log("No Codex sessions found.");
    return;
  }
  for (const session of sessions) {
    const size = formatBytes(session.size).padStart(8, " ");
    const date = formatDate(session.mtime).padEnd(16, " ");
    const risk = session.riskCount ? ` risks:${session.riskCount}` : "";
    const source = (session.engineLabel || "Codex").padEnd(11, " ");
    console.log(`${source} ${session.id.slice(0, 8)}  ${date} ${size}  ${session.title}${risk}`);
    if (session.displayCwd || session.cwd) {
      console.log(`          ${session.displayCwd || session.cwd}`);
    }
  }
}

function printSearchResults(result) {
  if (!result.results.length) {
    console.log(`No sessions matched "${result.query}".`);
    console.log(`Scanned ${result.scanned} session(s).`);
    return;
  }
  console.log(`Found ${result.matched} match(es) for "${result.query}" across ${result.scanned} scanned session(s).`);
  if (result.failed) {
    console.log(`Skipped ${result.failed} session(s) that could not be parsed.`);
  }
  console.log("");
  result.results.forEach((item, index) => {
    const source = item.engineLabel || "Codex";
    const date = formatDate(item.mtime);
    const location = item.displayCwd || item.cwd || "No project";
    const turn = item.turn ? ` turn ${item.turn}` : "";
    console.log(`${index + 1}. [${source}] ${date}  ${item.title}`);
    console.log(`   ${location}`);
    console.log(`   ${item.label || item.role || "Match"}${turn}: "${item.snippet}"`);
    console.log(`   Ref: ${item.ref}`);
    console.log("");
  });
}

function renderTextPreview(snapshot) {
  const lines = [
    `${snapshot.title}`,
    `${snapshot.id}`,
    `${snapshot.engineLabel || "Codex"}${snapshot.sourceDetail ? ` | ${snapshot.sourceDetail}` : ""} | ${snapshot.displayCwd || snapshot.cwd || "No cwd"} | ${formatBytes(snapshot.size)} | ${snapshot.turns.length} entries`,
    "",
    ...(snapshot.goalObjective ? [`Goal: ${snapshot.goalObjective}`, ""] : []),
    `Risks: ${snapshot.risks.length ? snapshot.risks.map((risk) => `${risk.label}(${risk.count})`).join(", ") : "none detected"}`,
    "",
  ];
  for (const turn of snapshot.turns) {
    if (turn.kind !== "tool" && turn.role === "user" && isInterruptionMarker(turn.text)) {
      lines.push(`--- interrupted #${turn.turn} ---`, "[User interrupted this turn]", "");
      continue;
    }
    lines.push(`--- ${turn.role}${turn.kind === "tool" ? `:${turn.name}` : ""} #${turn.turn} ---`);
    const visibleText = stripCodexAppDirectives(turn.text);
    if (visibleText) {
      lines.push(visibleText);
    }
    for (const image of turn.images || []) {
      lines.push(image.src ? "[image]" : `[image unavailable: ${image.unavailableReason || "unavailable"}]`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderMarkdown(snapshot) {
  const lines = [
    `# ${escapeMarkdown(snapshot.title)}`,
    "",
    `- Source: \`${snapshot.engineLabel || "Codex"}\``,
    ...(snapshot.sourceDetail ? [`- Source detail: \`${snapshot.sourceDetail}\``] : []),
    `- Session: \`${snapshot.id}\``,
    `- CWD: \`${snapshot.displayCwd || "unknown"}\``,
    `- Source file: \`${snapshot.displayFilePath || "unknown"}\``,
    `- Generated: \`${snapshot.generatedAt}\``,
    `- Redacted: \`${snapshot.redacted ? "yes" : "no"}\``,
    "",
  ];

  if (snapshot.goalObjective) {
    lines.push("## Goal", "", snapshot.goalObjective, "");
  }

  if (snapshot.safetyChecks !== false) {
    lines.push("## Sharing risks", "");
    if (snapshot.risks.length) {
      for (const risk of snapshot.risks) {
        lines.push(`- **${risk.severity.toUpperCase()}** ${risk.label}: ${risk.count} match(es), turns ${risk.turns.join(", ")}`);
      }
    } else {
      lines.push("- No common high-risk patterns detected.");
    }

    if (snapshot.notices?.length) {
      lines.push("", "## Notices", "");
      for (const notice of snapshot.notices) {
        lines.push(`- **${escapeMarkdown(notice.label)}**: ${escapeMarkdown(notice.text)}`);
      }
    }
    lines.push("");
  }

  lines.push("## Transcript", "");
  for (const turn of snapshot.turns) {
    if (turn.kind !== "tool" && turn.role === "user" && isInterruptionMarker(turn.text)) {
      lines.push(`### Interrupted ${turn.turn}`, "", "> ⏹ User interrupted this turn.", "");
      continue;
    }
    const heading = turn.kind === "tool" ? `Tool: ${turn.name}` : turn.role === "user" ? "User" : "Assistant";
    lines.push(`### ${heading} ${turn.turn}`, "");
    if (turn.kind === "tool") {
      if (Array.isArray(turn.fileChanges) && turn.fileChanges.length) {
        for (const change of turn.fileChanges) {
          if (change.path) {
            lines.push(`**${escapeMarkdown(change.kind || "change")}:** \`${escapeMarkdown(change.path)}\``, "");
          }
          lines.push("```diff", change.diffText || "", "```", "");
        }
      } else {
        lines.push("```text", turn.text, "```", "");
      }
    } else {
      const visibleText = stripCodexAppDirectives(turn.text);
      if (visibleText) {
        lines.push(visibleText, "");
      }
      for (const image of turn.images || []) {
        if (image.src) {
          lines.push(`![${escapeMarkdown(image.alt || "Image attachment")}](${image.src})`, "");
        } else {
          lines.push(`> [image unavailable: ${escapeMarkdown(image.unavailableReason || "unsupported image source")}]`, "");
        }
      }
    }
  }
  return lines.join("\n");
}

function renderHtml(snapshot) {
  const riskRows = snapshot.risks.length
    ? snapshot.risks.map((risk) => `
      <li class="risk risk-${escapeHtml(risk.severity)}">
        <span>${escapeHtml(risk.severity.toUpperCase())}</span>
        <strong>${escapeHtml(risk.label)}</strong>
        <em>${risk.count} match(es), turns ${escapeHtml(risk.turns.join(", "))}</em>
      </li>`).join("")
    : `<li class="risk risk-low"><span>OK</span><strong>No common high-risk patterns detected</strong><em>Still review before sharing.</em></li>`;
  const noticeRows = (snapshot.notices || []).map((notice) => `
      <li class="risk risk-${escapeHtml(notice.severity || "medium")}">
        <span>NOTE</span>
        <strong>${escapeHtml(notice.label || "Notice")}</strong>
        <em>${escapeHtml(notice.text || "")}</em>
      </li>`).join("");
  const riskPanel = snapshot.safetyChecks === false ? "" : `
    <section class="risk-panel">
      <div>
        <p class="eyebrow">Share review</p>
        <h2>${snapshot.risks.length} risk type${snapshot.risks.length === 1 ? "" : "s"} flagged</h2>
      </div>
      <ul>${noticeRows}${riskRows}</ul>
    </section>`;
  const turns = renderTranscriptHtml(snapshot.turns || [], {
    emptyHtml: `<p class="empty">No shareable user or assistant messages found.</p>`,
    bodyWrapper: false,
    contentClassName: "markdown-body",
    roleClassMode: "prefixed",
    labels: {
      processed: "Processed",
      tool: "Tool",
      interrupted: "User interrupted this turn",
      imageUnavailable: "Image unavailable",
      imageAltPrefix: "Image attachment",
    },
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(snapshot.title)} - Codex Snapshot</title>
  <link rel="icon" type="image/svg+xml" href="${snapshotLogoDataUri()}">
  <style>${snapshotCss()}</style>
</head>
<body>
  <main class="snapshot-shell">
    <header class="snapshot-header">
      <div>
        <p class="eyebrow">${escapeHtml(snapshot.engineLabel || "Codex")} read-only snapshot</p>
        <h1>${escapeHtml(snapshot.title)}</h1>
      </div>
      <dl class="meta-grid">
        <div><dt>Session</dt><dd>${escapeHtml(snapshot.id)}</dd></div>
        <div><dt>Generated</dt><dd>${escapeHtml(formatDate(snapshot.generatedAt))}</dd></div>
        <div><dt>Size</dt><dd>${escapeHtml(formatBytes(snapshot.size))}</dd></div>
        <div><dt>Redacted</dt><dd>${snapshot.redacted ? "yes" : "no"}</dd></div>
        ${snapshot.sourceDetail ? `<div><dt>Source detail</dt><dd>${escapeHtml(snapshot.sourceDetail)}</dd></div>` : ""}
      </dl>
    </header>
    ${snapshot.goalObjective ? `<section class="goal-band"><span>Goal</span><p>${escapeHtml(snapshot.goalObjective)}</p></section>` : ""}
    <section class="path-band">
      <span>CWD</span>
      <code>${escapeHtml(snapshot.displayCwd || "unknown")}</code>
    </section>
    ${riskPanel}
    <section class="transcript">
      ${turns}
    </section>
    <footer class="snapshot-footer">Generated by agent-snapshot ${VERSION}. Static read-only file.</footer>
  </main>
</body>
</html>`;
}

function snapshotCss() {
  return `
:root {
  color-scheme: light;
  --ink: #16191f;
  --muted: #5f6978;
  --line: #d8dde5;
  --paper: #f5f1e8;
  --panel: #fffdf8;
  --panel-strong: #fef7dd;
  --green: #0d6b57;
  --red: #a33a2b;
  --amber: #a66a16;
  --blue: #245d83;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background:
    linear-gradient(90deg, rgba(22, 25, 31, 0.06) 1px, transparent 1px),
    linear-gradient(rgba(22, 25, 31, 0.045) 1px, transparent 1px),
    var(--paper);
  background-size: 28px 28px;
  color: var(--ink);
  font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
}
.snapshot-shell { width: min(1180px, calc(100vw - 28px)); margin: 0 auto; padding: 24px 0 56px; }
.snapshot-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 460px);
  gap: 24px;
  align-items: end;
  border-bottom: 3px solid var(--ink);
  padding: 24px 0 18px;
}
.eyebrow {
  margin: 0 0 10px;
  color: var(--blue);
  font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0;
}
h1 { margin: 0; font-size: clamp(34px, 5vw, 72px); line-height: 0.95; letter-spacing: 0; overflow-wrap: anywhere; }
h2 { margin: 0; font-size: 24px; letter-spacing: 0; }
.meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
.meta-grid div, .path-band, .goal-band, .risk-panel {
  border: 1px solid var(--line);
  background: rgba(255, 253, 248, 0.92);
}
.meta-grid div { padding: 12px; min-width: 0; }
dt, .path-band span, .goal-band span {
  color: var(--muted);
  font: 700 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
dd { margin: 5px 0 0; overflow-wrap: anywhere; font-size: 14px; }
.path-band, .goal-band {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  margin-top: 18px;
  padding: 12px 14px;
}
.goal-band { align-items: start; }
.goal-band p {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  line-height: 1.55;
}
code, pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
}
.path-band code { overflow-wrap: anywhere; }
.risk-panel {
  display: grid;
  grid-template-columns: minmax(220px, 0.6fr) minmax(0, 1fr);
  gap: 18px;
  margin-top: 18px;
  padding: 18px;
}
.risk-panel ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.risk {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 8px 12px;
  align-items: center;
  border-left: 5px solid var(--green);
  background: #f6fbf7;
  padding: 10px 12px;
}
.risk span { color: var(--green); font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
.risk strong { font-size: 15px; }
.risk em { grid-column: 2; color: var(--muted); font-size: 13px; font-style: normal; }
.risk-high { border-color: var(--red); background: #fff1ee; }
.risk-high span { color: var(--red); }
.risk-medium { border-color: var(--amber); background: #fff8e7; }
.risk-medium span { color: var(--amber); }
.transcript {
  display: grid;
  gap: 52px;
  width: min(1600px, 100%);
  margin: 42px auto 0;
}
.turn {
  display: flex;
  min-width: 0;
}
.turn-user, .turn.user { justify-content: flex-end; }
.turn-assistant, .turn-tool, .turn-process, .turn.assistant, .turn.tool, .turn.process { justify-content: flex-start; }
.turn-interrupt, .turn.interrupt { justify-content: center; }
.turn-notice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px dashed rgba(23, 32, 42, 0.3);
  border-radius: 999px;
  background: rgba(23, 32, 42, 0.05);
  color: #8492a3;
  padding: 7px 15px;
  font: 600 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.08em;
}
.message-card {
  min-width: 0;
  max-width: min(1160px, 74%);
  border: 0;
  background: transparent;
  padding: 0;
  box-shadow: none;
}
.turn-user .message-card,
.turn.user .message-card {
  max-width: min(1220px, 76%);
  border: 1px solid #d6e9e5;
  border-radius: 18px;
  background: #eef9f6;
  padding: 23px 34px 26px;
  box-shadow: 0 24px 60px -54px rgba(22, 25, 31, 0.42);
}
.turn-assistant .message-card,
.turn.assistant .message-card {
  max-width: min(1120px, 72%);
}
.turn-tool .message-card,
.turn.tool .message-card {
  max-width: min(1160px, 80%);
  border: 1px solid #efd99f;
  border-radius: 10px;
  background: #fff8df;
  padding: 16px 18px;
}
.process-details {
  width: min(1120px, 74%);
  border-top: 1px solid rgba(22, 25, 31, 0.12);
  color: rgba(22, 25, 31, 0.62);
}
.process-summary {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-height: 42px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  font: 800 17px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.process-files {
  max-width: min(52vw, 560px);
  overflow: hidden;
  color: var(--muted);
  font: 700 12px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.process-summary::-webkit-details-marker {
  display: none;
}
.process-summary::after {
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  content: "";
  transform: translateY(-2px) rotate(45deg);
  transition: transform 0.16s ease;
}
.process-details[open] .process-summary::after {
  transform: translateY(2px) rotate(225deg);
}
.process-body {
  display: grid;
  gap: 24px;
  padding: 6px 0 8px;
}
.process-entry {
  min-width: 0;
}
.process-tool {
  max-width: min(980px, 100%);
  border-left: 3px solid rgba(183, 121, 31, 0.32);
  padding-left: 12px;
}
.turn-meta {
  margin-bottom: 20px;
  color: var(--muted);
  font: 800 13px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.turn-meta span { font-weight: 700; }
.markdown-body {
  max-width: 78ch;
  color: var(--ink);
  font-size: 20px;
  line-height: 1.7;
}
.markdown-body > * { margin: 0; }
.markdown-body > * + * { margin-top: 18px; }
.markdown-body p, .markdown-body li { overflow-wrap: anywhere; }
.markdown-body strong { font-weight: 800; }
.markdown-body em { font-style: italic; }
.markdown-body a { color: #155e75; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.markdown-body code {
  border: 1px solid rgba(22, 25, 31, 0.12);
  border-radius: 8px;
  background: rgba(22, 25, 31, 0.06);
  padding: 0.08rem 0.34rem;
  font-size: 0.9em;
}
.markdown-body pre {
  max-width: 100%;
  overflow: auto;
  border: 1px solid #253043;
  border-radius: 8px;
  background: #111722;
  color: #edf4ff;
  padding: 14px 16px;
  font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre;
}
.markdown-body pre code {
  display: block;
  min-width: max-content;
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
}
.markdown-body .hljs-keyword,
.markdown-body .hljs-selector-tag,
.markdown-body .hljs-built_in { color: #8ab4f8; }
.markdown-body .hljs-title,
.markdown-body .hljs-title.class_,
.markdown-body .hljs-title.function_ { color: #f2cc60; }
.markdown-body .hljs-string,
.markdown-body .hljs-attr,
.markdown-body .hljs-symbol { color: #9ccc65; }
.markdown-body .hljs-number,
.markdown-body .hljs-literal { color: #f8a978; }
.markdown-body .hljs-comment { color: #7d8796; font-style: italic; }
.markdown-body .hljs-type,
.markdown-body .hljs-params,
.markdown-body .hljs-variable,
.markdown-body .hljs-property { color: #c4b5fd; }
.markdown-body ul, .markdown-body ol {
  padding-left: 1.35rem;
}
.markdown-body li + li { margin-top: 0.25rem; }
.markdown-body blockquote {
  border-left: 3px solid #ccd5df;
  margin-left: 0;
  padding-left: 14px;
  color: #4b5563;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3 {
  line-height: 1.25;
  font-size: 1.08em;
}
.markdown-body table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 13.5px;
  line-height: 1.5;
}
.markdown-body th, .markdown-body td {
  border: 1px solid rgba(23, 32, 42, 0.16);
  padding: 7px 12px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}
.markdown-body th {
  background: rgba(23, 32, 42, 0.05);
  font-weight: 700;
  white-space: nowrap;
}
.markdown-body tbody tr:nth-child(even) td,
.markdown-body tr:nth-child(even) td {
  background: rgba(23, 32, 42, 0.025);
}
.attachment-grid {
  display: grid;
  gap: 18px;
  margin-top: 24px;
}
.markdown-body > .attachment-grid { margin-top: 24px; }
.image-attachment {
  margin: 0;
  min-width: 0;
}
.image-attachment img {
  display: block;
  max-width: 100%;
  max-height: 540px;
  border: 1px solid rgba(22, 25, 31, 0.18);
  border-radius: 8px;
  background: #fff;
  object-fit: contain;
}
.image-unavailable {
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 16px;
  color: var(--muted);
}
.tool-details summary {
  min-height: 34px;
  color: var(--amber);
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.file-change {
  display: grid;
  gap: 7px;
}
.file-change + .file-change {
  margin-top: 12px;
}
.file-change-path {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--muted);
  font: 700 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
}
pre {
  overflow: auto;
  max-height: 520px;
  margin: 8px 0 0;
  border: 1px solid #253043;
  background: #111722;
  color: #edf4ff;
  padding: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.empty, .snapshot-footer { color: var(--muted); }
.snapshot-footer { margin-top: 24px; font: 700 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
@media (max-width: 820px) {
  .snapshot-header, .risk-panel { grid-template-columns: 1fr; }
  .meta-grid { grid-template-columns: 1fr; }
  .risk { grid-template-columns: 1fr; }
  .risk em { grid-column: auto; }
  .transcript { gap: 36px; }
  .message-card, .process-details, .turn-user .message-card, .turn.user .message-card { max-width: 94%; }
  .turn-assistant .message-card, .turn.assistant .message-card { max-width: 100%; }
  .turn-user .message-card, .turn.user .message-card { padding: 18px 20px 20px; }
  .markdown-body { font-size: 18px; }
}
`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function snapshotLogoDataUri() {
  return `data:image/svg+xml,${encodeURIComponent(SNAPSHOT_LOGO_SVG)}`;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toISOString().replace("T", " ").slice(0, 16);
}

async function serve({ codexHome, claudeHome, traeHome, traeAppHome, traeRecordingsDir, host, port }) {
  await serveLocalViewer({
    codexHome,
    claudeHome,
    traeHome,
    traeAppHome,
    traeRecordingsDir,
    host,
    port,
    defaultServerLimit: DEFAULT_SERVER_LIMIT,
    snapshotLogoSvg: SNAPSHOT_LOGO_SVG,
    shareConfig: browserShareConfig(),
    listSessions,
    loadSnapshot,
    searchSessions,
    applySafetyChecksOption,
    snapshotApiResponse,
    publishAllSnapshots,
    publishSnapshot,
    createShareRequestPayload,
    stableSnapshotShareId,
    renderMarkdown,
    renderHtml,
    readPositiveInteger,
    readNonNegativeInteger,
    safeFileName,
  });
}

async function serveTraeRecorder({ host, port, traeRecordingsDir, recordSensitiveContext }) {
  await mkdir(traeRecordingsDir, { recursive: true });
  const endpoint = `http://${host}:${port}/capture`;
  const wsEndpoint = `ws://${host}:${port}/capture-ws`;
  const server = http.createServer(async (request, response) => {
    try {
      setCorsHeaders(response);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
      if (url.pathname === "/") {
        send(response, 200, "text/html; charset=utf-8", renderTraeRecorderHome({ host, port, traeRecordingsDir, recordSensitiveContext }));
        return;
      }
      if (url.pathname === "/health") {
        sendJson(response, {
          ok: true,
          endpoint,
          wsEndpoint,
          recordingsDir: traeRecordingsDir,
          recordSensitiveContext,
        });
        return;
      }
      if (url.pathname === "/trae-recorder.js") {
        send(response, 200, "application/javascript; charset=utf-8", renderTraeRecorderScript({ endpoint, wsEndpoint, recordSensitiveContext }));
        return;
      }
      if (url.pathname === "/capture" && request.method === "POST") {
        const event = await readJsonRequest(request, MAX_TRAE_CAPTURE_POST_BYTES);
        const saved = await saveTraeCaptureEvent(event, { traeRecordingsDir, recordSensitiveContext });
        sendJson(response, saved);
        return;
      }
      send(response, 404, "text/plain; charset=utf-8", "not found");
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
  server.on("upgrade", (request, socket) => {
    handleTraeRecorderUpgrade(request, socket, { traeRecordingsDir, recordSensitiveContext });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const url = `http://${host}:${port}`;
  console.log(`Trae local recorder is running at ${url}`);
  console.log(`Recorder script: import("${url}/trae-recorder.js")`);
  console.log(`Recorder WebSocket: ${wsEndpoint}`);
  console.log(`Recordings dir: ${traeRecordingsDir}`);
  console.log(`Sensitive context recording: ${recordSensitiveContext ? "enabled" : "disabled"}`);
}

function handleTraeRecorderUpgrade(request, socket, { traeRecordingsDir, recordSensitiveContext }) {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/capture-ws") {
      socket.destroy();
      return;
    }
    const key = request.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"));
    let buffer = Buffer.alloc(0);
    let fragmentedOpcode = 0;
    let fragmentedPayloads = [];
    const handleTextPayload = (payload) => {
      try {
        const event = JSON.parse(payload.toString("utf8"));
        saveTraeCaptureEvent(event, {
          traeRecordingsDir,
          recordSensitiveContext,
        }).catch(() => {});
      } catch {}
    };
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = readWebSocketFrames(buffer);
      buffer = parsed.remaining;
      for (const frame of parsed.frames) {
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode === 0x1) {
          if (frame.fin) {
            handleTextPayload(frame.payload);
          } else {
            fragmentedOpcode = frame.opcode;
            fragmentedPayloads = [frame.payload];
          }
          continue;
        }
        if (frame.opcode === 0x0 && fragmentedOpcode === 0x1) {
          fragmentedPayloads.push(frame.payload);
          if (frame.fin) {
            handleTextPayload(Buffer.concat(fragmentedPayloads));
            fragmentedOpcode = 0;
            fragmentedPayloads = [];
          }
        }
      }
    });
  } catch {
    socket.destroy();
  }
}

function readWebSocketFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) {
        break;
      }
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      length = high * 2 ** 32 + low;
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const totalLength = headerLength + maskLength + length;
    if (buffer.length - offset < totalLength) {
      break;
    }
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    frames.push({ fin, opcode, payload });
    offset += totalLength;
  }
  return {
    frames,
    remaining: buffer.subarray(offset),
  };
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-max-age", "86400");
}

async function readJsonRequest(request, limitBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limitBytes) {
      throw new Error(`capture body is larger than ${formatBytes(limitBytes)}`);
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    throw new Error("empty capture body");
  }
  return JSON.parse(text);
}

async function saveTraeCaptureEvent(event, { traeRecordingsDir, recordSensitiveContext }) {
  if (!event || typeof event !== "object") {
    throw new Error("capture event must be a JSON object");
  }
  const pageSession = safeCaptureId(event.pageSession || event.page?.session || `trae-${new Date().toISOString().slice(0, 10)}`);
  const body = normalizeCapturedBody(event.body);
  const chunk = normalizeCapturedBody(event.chunk);
  const sessionEvent = { ...event, body, chunk };
  const actualSessionId = extractActualTraeSessionId(sessionEvent) || "";
  const captureSessionId = extractTraeCaptureSessionId(sessionEvent, actualSessionId) || "";
  const captureFileId = safeCaptureId(captureSessionId || actualSessionId || pageSession);
  const filePath = path.join(traeRecordingsDir, `${captureFileId}.jsonl`);
  const domThreadId = cleanTraeSessionId(event.domThreadId || event.dom_thread_id || "");
  if (actualSessionId && domThreadId) {
    await migrateTraeCaptureAlias(traeRecordingsDir, domThreadId, captureFileId);
  }
  const record = {
    schema: "trae-local-recorder-event.v1",
    capturedAt: normalizeRecordedTimestamp(event.capturedAt) || new Date().toISOString(),
    pageSession,
    captureSessionId,
    captureFileId,
    domThreadId,
    sequence: Number(event.sequence || 0),
    kind: String(event.kind || "capture"),
    source: String(event.source || ""),
    requestId: event.requestId ? String(event.requestId) : "",
    wsId: event.wsId ? String(event.wsId) : "",
    eventSourceId: event.eventSourceId ? String(event.eventSourceId) : "",
    method: event.method ? String(event.method) : "",
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : undefined,
    statusText: event.statusText ? String(event.statusText) : "",
    contentType: event.contentType ? String(event.contentType) : "",
    url: sanitizeCaptureUrl(event.url),
    responseUrl: sanitizeCaptureUrl(event.responseUrl),
    pageUrl: sanitizeCaptureUrl(event.page?.href || event.pageUrl),
    pageTitle: event.page?.title ? String(event.page.title) : event.pageTitle ? String(event.pageTitle) : "",
    body,
    chunk,
    bodyEncoding: event.bodyEncoding ? String(event.bodyEncoding) : "",
    actualSessionId,
    sensitiveContextRecorded: Boolean(recordSensitiveContext),
    headers: recordSensitiveContext ? normalizeCaptureHeaders(event.headers) : undefined,
  };
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return {
    ok: true,
    file: filePath,
    captureSessionId: record.captureSessionId,
    actualSessionId: record.actualSessionId,
    eventKind: record.kind,
    sequence: record.sequence,
  };
}

function normalizeCapturedBody(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeCaptureHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[String(key).toLowerCase()] = Array.isArray(value)
      ? value.map((item) => String(item))
      : String(value);
  }
  return normalized;
}

function sanitizeCaptureUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(String(value));
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, "<redacted>");
    }
    url.hash = "";
    return url.toString();
  } catch {
    return String(value).replace(/[?&]([^=&#]+)=([^&#]+)/g, (_match, key) => `?${key}=<redacted>`);
  }
}

function safeCaptureId(value) {
  const clean = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!clean) {
    return `trae-${Date.now().toString(36)}`;
  }
  return clean.length > 96 ? `${clean.slice(0, 72)}-${stableHash(clean)}` : clean;
}

async function migrateTraeCaptureAlias(traeRecordingsDir, fromId, toId) {
  const fromFileId = safeCaptureId(fromId);
  const toFileId = safeCaptureId(toId);
  if (!fromFileId || !toFileId || fromFileId === toFileId) {
    return;
  }
  const fromPath = path.join(traeRecordingsDir, `${fromFileId}.jsonl`);
  const toPath = path.join(traeRecordingsDir, `${toFileId}.jsonl`);
  try {
    const existing = await readFile(fromPath, "utf8");
    if (existing.trim()) {
      await appendFile(toPath, existing.endsWith("\n") ? existing : `${existing}\n`, "utf8");
    }
    await unlink(fromPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

const TRAE_ACTUAL_SESSION_KEYS = new Set([
  "agentsessionid",
  "chatsessionid",
  "conversationid",
  "conversationuuid",
  "currentsessionid",
  "sessionid",
  "sessionuuid",
  "threadid",
  "taskid",
  "chatid",
]);

const TRAE_CAPTURE_SESSION_KEYS = new Set([
  ...TRAE_ACTUAL_SESSION_KEYS,
  "capturesessionid",
  "domthreadid",
]);

function normalizeTraeSessionKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanTraeSessionId(value) {
  const clean = String(value || "").trim();
  if (!clean || clean.length < 8 || clean.length > 240) {
    return "";
  }
  if (/^(<redacted>|undefined|null|true|false)$/i.test(clean)) {
    return "";
  }
  if (/^(data:|blob:|https?:)/i.test(clean)) {
    return "";
  }
  return clean;
}

function extractActualTraeSessionId(event) {
  const values = [];
  const explicit = cleanTraeSessionId(event.actualSessionId || event.actual_session_id);
  if (explicit) {
    return explicit;
  }
  collectTraeSessionValues(event, TRAE_ACTUAL_SESSION_KEYS, values, 0);
  for (const payloadText of [event.body, event.chunk]) {
    if (!payloadText || typeof payloadText !== "string") {
      continue;
    }
    for (const payload of parseCapturePayloads(payloadText)) {
      collectTraeSessionValues(payload, TRAE_ACTUAL_SESSION_KEYS, values, 0);
    }
  }
  for (const value of values) {
    const clean = cleanTraeSessionId(value);
    if (clean) {
      return clean;
    }
  }
  for (const url of [event.url, event.responseUrl, event.page?.href, event.pageUrl]) {
    const fromUrl = extractTraeSessionIdFromUrl(url);
    if (fromUrl) {
      return fromUrl;
    }
  }
  return "";
}

function extractTraeCaptureSessionId(event, actualSessionId) {
  if (actualSessionId) {
    return actualSessionId;
  }
  const explicit = cleanTraeSessionId(event.captureSessionId || event.capture_session_id || event.page?.captureSessionId);
  if (explicit) {
    return explicit;
  }
  const values = [];
  collectTraeSessionValues(event, TRAE_CAPTURE_SESSION_KEYS, values, 0);
  for (const payloadText of [event.body, event.chunk]) {
    if (!payloadText || typeof payloadText !== "string") {
      continue;
    }
    for (const payload of parseCapturePayloads(payloadText)) {
      collectTraeSessionValues(payload, TRAE_CAPTURE_SESSION_KEYS, values, 0);
    }
  }
  for (const value of values) {
    const clean = cleanTraeSessionId(value);
    if (clean) {
      return clean;
    }
  }
  return "";
}

function collectTraeSessionValues(value, keys, results, depth) {
  if (!value || depth > 8 || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTraeSessionValues(item, keys, results, depth + 1);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && keys.has(normalizeTraeSessionKey(key))) {
      results.push(child);
    } else if (child && typeof child === "object") {
      collectTraeSessionValues(child, keys, results, depth + 1);
    }
  }
}

function extractTraeSessionIdFromUrl(value) {
  if (!value) {
    return "";
  }
  const raw = String(value);
  try {
    const url = new URL(raw);
    for (const [key, child] of url.searchParams.entries()) {
      if (TRAE_ACTUAL_SESSION_KEYS.has(normalizeTraeSessionKey(key))) {
        const clean = cleanTraeSessionId(child);
        if (clean) {
          return clean;
        }
      }
    }
    const pathMatch = url.pathname.match(/(?:session|conversation|chat|thread|task)[/_-]([A-Za-z0-9._:-]{8,})/i);
    if (pathMatch) {
      return cleanTraeSessionId(pathMatch[1]);
    }
  } catch {
    const match = raw.match(/[?&#](?:[^=]*?(?:session|conversation|chat|thread|task)[^=]*?id)=([^&#]+)/i)
      || raw.match(/(?:session|conversation|chat|thread|task)[/_-]([A-Za-z0-9._:-]{8,})/i);
    if (match) {
      return cleanTraeSessionId(decodeURIComponent(match[1]));
    }
  }
  return "";
}

function renderTraeRecorderHome({ host, port, traeRecordingsDir, recordSensitiveContext }) {
  const scriptUrl = `http://${host}:${port}/trae-recorder.js`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trae Local Recorder</title>
  <style>
    body { margin: 40px; max-width: 920px; background: #f5efe4; color: #15191f; font: 18px/1.55 ui-serif, Georgia, serif; }
    h1 { font-size: 48px; line-height: 1; margin: 0 0 24px; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre { background: #15191f; color: #fff; padding: 18px; overflow: auto; }
    .meta { color: #687386; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  </style>
</head>
<body>
  <h1>Trae Local Recorder</h1>
  <p class="meta">status: running | recordings: ${escapeHtml(traeRecordingsDir)} | sensitive context: ${recordSensitiveContext ? "enabled" : "disabled"}</p>
  <p>Open Trae DevTools for the Trae window you want to record, then run:</p>
  <pre>import(${JSON.stringify(scriptUrl)})</pre>
  <p>If dynamic import is blocked, run:</p>
  <pre>fetch(${JSON.stringify(scriptUrl)}).then((r) => r.text()).then((code) => (0, eval)(code))</pre>
</body>
</html>`;
}

function renderTraeRecorderScript({ endpoint, wsEndpoint, recordSensitiveContext }) {
  return `(() => {
  const ENDPOINT = ${JSON.stringify(endpoint)};
  const WS_ENDPOINT = ${JSON.stringify(wsEndpoint)};
  const RECORD_SENSITIVE_CONTEXT = ${recordSensitiveContext ? "true" : "false"};
  const nativeFetch = window.fetch;
  const nativeFetchBound = nativeFetch.bind(window);
  const nativeWebSocket = window.WebSocket;
  if (window.__codexTraeRecorder && window.__codexTraeRecorder.installed) {
    console.info("[agent-snapshot] Trae recorder already installed", window.__codexTraeRecorder);
    return;
  }
  const recorder = {
    installed: true,
    endpoint: ENDPOINT,
    pageSession: "trae-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
    actualSessionId: "",
    actualSessionUpdatedAt: 0,
    actualSessionSource: "",
    captureSessionId: "",
    pageStateSessionId: "",
    domThreadId: "",
    domThreadSignature: "",
    sequence: 0,
  };
  const transport = { socket: null, queue: [], opening: false, failed: false };
  window.__codexTraeRecorder = recorder;

  function nextId(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + (++recorder.sequence).toString(36);
  }

  function sanitizeUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), location.href);
      for (const key of Array.from(url.searchParams.keys())) {
        url.searchParams.set(key, "<redacted>");
      }
      url.hash = "";
      return url.toString();
    } catch {
      return String(value);
    }
  }

  const TRAE_SESSION_ID_KEYS = new Set([
    "agentsessionid",
    "chatsessionid",
    "conversationid",
    "conversationuuid",
    "currentsessionid",
    "sessionid",
    "sessionuuid",
    "threadid",
    "taskid",
    "chatid",
  ]);

  function normalizeSessionKey(key) {
    return String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function isSessionIdKey(key) {
    const normalized = normalizeSessionKey(key);
    return TRAE_SESSION_ID_KEYS.has(normalized)
      || (normalized.startsWith("data") && TRAE_SESSION_ID_KEYS.has(normalized.slice(4)));
  }

  function cleanSessionId(value) {
    const clean = String(value || "").trim();
    if (!clean || clean.length < 8 || clean.length > 240) return "";
    if (/^(<redacted>|undefined|null|true|false)$/i.test(clean)) return "";
    if (/^(data:|blob:|https?:)/i.test(clean)) return "";
    if (clean.includes("\\n")) return "";
    return clean;
  }

  function rememberActualSessionId(value, source) {
    const clean = cleanSessionId(value);
    if (!clean) return "";
    recorder.actualSessionId = clean;
    recorder.actualSessionUpdatedAt = Date.now();
    recorder.actualSessionSource = source || "network";
    if (recorder.actualSessionSource !== "page-state") {
      recorder.captureSessionId = clean;
    }
    return clean;
  }

  function rememberCaptureSessionId(value) {
    const clean = cleanSessionId(value);
    if (!clean) return "";
    if (!recorder.actualSessionId) recorder.captureSessionId = clean;
    return clean;
  }

  function currentCaptureSessionId() {
    return (recorder.actualSessionSource !== "page-state" ? recorder.actualSessionId : "")
      || recorder.captureSessionId
      || recorder.domThreadId
      || "";
  }

  function collectSessionIds(value, out, depth) {
    if (value == null || depth > 8) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text || text.length > 300000) return;
      if (text[0] === "{" || text[0] === "[") {
        try {
          collectSessionIds(JSON.parse(text), out, depth + 1);
          return;
        } catch {}
      }
      for (const line of text.split(/\\r?\\n/)) {
        const item = line.trim();
        if (!item.startsWith("data:")) continue;
        const data = item.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          collectSessionIds(JSON.parse(data), out, depth + 1);
        } catch {}
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectSessionIds(item, out, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (isSessionIdKey(key)) {
        const clean = cleanSessionId(child);
        if (clean) out.push(clean);
      }
      if (child && (typeof child === "object" || typeof child === "string")) {
        collectSessionIds(child, out, depth + 1);
      }
    }
  }

  function rememberSessionIdsFromText(text) {
    const values = [];
    collectSessionIds(text, values, 0);
    return values.length ? rememberActualSessionId(values[0], "network-body") : "";
  }

  function rememberSessionIdsFromUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value), location.href);
      for (const [key, child] of url.searchParams.entries()) {
        if (isSessionIdKey(key)) {
          const remembered = rememberActualSessionId(child, "network-url");
          if (remembered) return remembered;
        }
      }
      const pathMatch = url.pathname.match(/(?:session|conversation|chat|thread|task)[/_-]([A-Za-z0-9._:-]{8,})/i);
      if (pathMatch) return rememberActualSessionId(pathMatch[1], "network-url");
    } catch {}
    return "";
  }

  function rememberSessionIdsFromCapture(url, text) {
    return rememberSessionIdsFromUrl(url) || rememberSessionIdsFromText(text);
  }

  function rememberSessionIdsFromPageState() {
    rememberSessionIdsFromUrl(location.href);
    const values = [];
    try {
      collectSessionIds(history.state, values, 0);
    } catch {}
    try {
      for (const storage of [localStorage, sessionStorage]) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          const value = key ? storage.getItem(key) : "";
          if (isSessionIdKey(key)) {
            const clean = cleanSessionId(value);
            if (clean) values.push(clean);
          }
          collectSessionIds(value, values, 0);
        }
      }
    } catch {}
    try {
      const selectors = [
        "[data-session-id]",
        "[data-conversation-id]",
        "[data-chat-id]",
        "[data-thread-id]",
        "[data-task-id]",
        "[aria-current='true']",
        ".active",
        ".selected",
        ".current",
      ].join(",");
      const elements = Array.from(document.querySelectorAll(selectors)).slice(0, 80);
      for (const element of elements) {
        for (const attr of Array.from(element.attributes || [])) {
          if (isSessionIdKey(attr.name)) {
            const clean = cleanSessionId(attr.value);
            if (clean) values.push(clean);
          }
        }
      }
    } catch {}
    if (values.length) {
      recorder.pageStateSessionId = cleanSessionId(values[0]);
    }
    return values[0] || "";
  }

  function headersToObject(headers) {
    if (!RECORD_SENSITIVE_CONTEXT || !headers) return undefined;
    try {
      const out = {};
      new Headers(headers).forEach((value, key) => { out[key] = value; });
      return out;
    } catch {
      return undefined;
    }
  }

  async function readBody(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (value instanceof URLSearchParams) return value.toString();
    if (typeof FormData !== "undefined" && value instanceof FormData) {
      const out = {};
      for (const [key, item] of value.entries()) {
        out[key] = typeof item === "string" ? item : "[File " + (item.name || "blob") + " " + (item.type || "application/octet-stream") + "]";
      }
      return JSON.stringify(out);
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      if (value.type && !/^text\\/|json|javascript|xml|x-www-form-urlencoded/i.test(value.type)) {
        return "[Blob " + value.type + " " + value.size + " bytes]";
      }
      return await value.text();
    }
    if (value instanceof ArrayBuffer) {
      return new TextDecoder().decode(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new TextDecoder().decode(value);
    }
    if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
      return "[ReadableStream request body]";
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  async function readFetchRequestBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, "body")) {
      return readBody(init.body);
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      try {
        return await input.clone().text();
      } catch {
        return "";
      }
    }
    return "";
  }

  function requestHeaders(input, init) {
    if (init && init.headers) return headersToObject(init.headers);
    if (typeof Request !== "undefined" && input instanceof Request) return headersToObject(input.headers);
    return undefined;
  }

  async function post(kind, payload) {
    rememberSessionIdsFromPageState();
    if (payload && payload.actualSessionId) rememberActualSessionId(payload.actualSessionId);
    if (payload && payload.captureSessionId) rememberCaptureSessionId(payload.captureSessionId);
    const event = {
      schema: "trae-browser-recorder.v1",
      kind,
      capturedAt: new Date().toISOString(),
      page: { href: sanitizeUrl(location.href), title: document.title },
      pageSession: recorder.pageSession,
      sequence: ++recorder.sequence,
      ...payload,
      actualSessionId: recorder.actualSessionSource === "page-state" ? "" : recorder.actualSessionId || "",
      actualSessionIdSource: recorder.actualSessionSource || "",
      pageStateSessionId: recorder.pageStateSessionId || "",
      captureSessionId: currentCaptureSessionId(),
      domThreadId: recorder.domThreadId || "",
    };
    const body = JSON.stringify(event);
    if (sendViaWebSocket(body)) {
      return;
    }
    try {
      await nativeFetchBound(ENDPOINT, {
        method: "POST",
        mode: "cors",
        keepalive: body.length < 60000,
        headers: { "content-type": "application/json" },
        body,
      });
    } catch (error) {
      console.debug("[agent-snapshot] recorder post failed", error);
    }
  }

  function sendViaWebSocket(body) {
    if (transport.failed || !nativeWebSocket || !WS_ENDPOINT) return false;
    if (transport.socket && transport.socket.readyState === nativeWebSocket.OPEN) {
      transport.socket.send(body);
      return true;
    }
    transport.queue.push(body);
    if (!transport.opening) {
      transport.opening = true;
      try {
        transport.socket = new nativeWebSocket(WS_ENDPOINT);
        transport.socket.addEventListener("open", () => {
          transport.opening = false;
          const pending = transport.queue.splice(0);
          for (const item of pending) transport.socket.send(item);
        });
        transport.socket.addEventListener("close", () => {
          transport.opening = false;
          transport.socket = null;
        });
        transport.socket.addEventListener("error", () => {
          transport.opening = false;
          transport.failed = true;
          transport.socket = null;
        });
      } catch {
        transport.opening = false;
        transport.failed = true;
        return false;
      }
    }
    return true;
  }

  async function captureResponseStream(response, meta) {
    try {
      if (response.body && response.body.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          const chunk = decoder.decode(result.value, { stream: true });
          if (chunk) {
            rememberSessionIdsFromText(chunk);
            await post("fetch-response-chunk", { ...meta, chunk });
          }
        }
        const tail = decoder.decode();
        if (tail) {
          rememberSessionIdsFromText(tail);
          await post("fetch-response-chunk", { ...meta, chunk: tail });
        }
        await post("fetch-response-end", meta);
        return;
      }
      const body = await response.text();
      rememberSessionIdsFromText(body);
      await post("fetch-response", { ...meta, body });
    } catch (error) {
      await post("capture-error", { ...meta, message: String(error && error.message || error) });
    }
  }

  window.fetch = async function recordedFetch(input, init) {
    const method = String((init && init.method) || (typeof Request !== "undefined" && input instanceof Request && input.method) || "GET").toUpperCase();
    const rawRequestUrl = typeof input === "string" || input instanceof URL ? input : input && input.url;
    const requestUrl = sanitizeUrl(rawRequestUrl);
    const requestId = nextId("fetch");
    rememberSessionIdsFromUrl(rawRequestUrl);
    readFetchRequestBody(input, init).then((body) => {
      rememberSessionIdsFromCapture(rawRequestUrl, body);
      return post("fetch-request", {
        requestId,
        source: "fetch",
        url: requestUrl,
        method,
        headers: requestHeaders(input, init),
        body,
      });
    }).then(() => {}, () => {});
    const response = await nativeFetch.apply(this, arguments);
    rememberSessionIdsFromUrl(response.url);
    const meta = {
      requestId,
      source: "fetch",
      url: requestUrl,
      responseUrl: sanitizeUrl(response.url),
      method,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") || "",
      headers: headersToObject(response.headers),
    };
    if (meta.contentType && !/json|text|event-stream|javascript|xml|x-www-form-urlencoded/i.test(meta.contentType)) {
      post("fetch-response-skip", meta);
      return response;
    }
    captureResponseStream(response.clone(), meta);
    return response;
  };

  if (nativeWebSocket) {
    const NativeWebSocket = nativeWebSocket;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = new target(...args);
        const wsId = nextId("ws");
        const rawUrl = args[0];
        const url = sanitizeUrl(rawUrl);
        rememberSessionIdsFromUrl(rawUrl);
        post("ws-open", { wsId, source: "websocket", url });
        const nativeSend = socket.send;
        socket.send = function recordedSend(data) {
          readBody(data).then((body) => {
            rememberSessionIdsFromCapture(rawUrl, body);
            return post("ws-send", { wsId, source: "websocket", url, body });
          }).then(() => {}, () => {});
          return nativeSend.apply(this, arguments);
        };
        socket.addEventListener("message", (event) => {
          readBody(event.data).then((body) => {
            rememberSessionIdsFromCapture(rawUrl, body);
            return post("ws-message", { wsId, source: "websocket", url, body });
          }).then(() => {}, () => {});
        });
        socket.addEventListener("close", (event) => post("ws-close", { wsId, source: "websocket", url, code: event.code, reason: event.reason }));
        socket.addEventListener("error", () => post("ws-error", { wsId, source: "websocket", url }));
        return socket;
      },
    });
  }

  if (window.EventSource) {
    const NativeEventSource = window.EventSource;
    window.EventSource = new Proxy(NativeEventSource, {
      construct(target, args) {
        const eventSource = new target(...args);
        const eventSourceId = nextId("sse");
        const rawUrl = args[0];
        const url = sanitizeUrl(rawUrl);
        rememberSessionIdsFromUrl(rawUrl);
        post("eventsource-open", { eventSourceId, source: "eventsource", url });
        eventSource.addEventListener("message", (event) => {
          rememberSessionIdsFromCapture(rawUrl, event.data);
          post("eventsource-message", {
            eventSourceId,
            source: "eventsource",
            url,
            body: event.data,
          });
        });
        eventSource.addEventListener("error", () => post("eventsource-error", { eventSourceId, source: "eventsource", url }));
        return eventSource;
      },
    });
  }

  const domRecorder = {
    ids: new WeakMap(),
    sent: new Map(),
    nextId: 0,
    observer: null,
    timer: null,
  };

  function queryFirst(root, selectors) {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  function normalizeDomMessageText(value) {
    return String(value || "")
      .replace(/\\u0000/g, "")
      .replace(/\\u00a0/g, " ")
      .replace(/\\r\\n/g, "\\n")
      .split("\\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\\n")
      .trim();
  }

  function normalizeDomCodeLanguage(value) {
    const lower = String(value || "").trim().toLowerCase();
    if (lower === "typescript" || lower === "ts") return "ts";
    if (lower === "javascript" || lower === "js") return "js";
    if (lower === "plaintext" || lower === "plain text" || lower === "text") return "text";
    if (/^(tsx|jsx|json|html|css|bash|yaml|yml|xml)$/.test(lower)) return lower === "yml" ? "yaml" : lower;
    return "";
  }

  function inferDomCodeLanguage(element) {
    const values = [];
    let current = element;
    while (current && current.nodeType === 1 && values.length < 4) {
      values.push(current.getAttribute("data-language") || "");
      values.push(current.getAttribute("lang") || "");
      values.push(String(current.className || ""));
      current = current.parentElement;
    }
    const joined = values.join(" ");
    const classMatch = joined.match(/language-([a-z0-9+#.-]+)/i) || joined.match(/\\b(tsx|ts|typescript|jsx|js|javascript|json|html|css|bash|plaintext|text|yaml|yml|xml)\\b/i);
    return normalizeDomCodeLanguage(classMatch && classMatch[1]);
  }

  function isDomCodeLineNumber(line) {
    return /^\\d{1,4}$/.test(String(line || "").trim());
  }

  function normalizeDomCodeBlockText(value, language) {
    const lines = String(value || "")
      .replace(/\\u0000/g, "")
      .replace(/\\u00a0/g, " ")
      .replace(/\\r\\n/g, "\\n")
      .split("\\n")
      .map((line) => line.replace(/\\s+$/g, ""));
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const leadingLanguage = normalizeDomCodeLanguage(lines[0]);
    if (leadingLanguage) {
      language = language || leadingLanguage;
      lines.shift();
    }
    while (lines.length && isDomCodeLineNumber(lines[0])) {
      lines.shift();
    }
    return {
      language: language || "text",
      code: lines.join("\\n").trimEnd(),
    };
  }

  function extractDomMessageText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    const codeBlocks = Array.from(clone.querySelectorAll("pre, .shiki, .code-block, .codeBlock, [class*='code-block'], [class*='codeBlock'], code[class*='language-']"));
    for (const block of codeBlocks) {
      if (!block.isConnected) continue;
      const raw = block.textContent || block.innerText || "";
      if (!raw.trim()) continue;
      if (block.tagName && block.tagName.toLowerCase() === "code" && !raw.includes("\\n")) continue;
      const normalized = normalizeDomCodeBlockText(raw, inferDomCodeLanguage(block));
      if (!normalized.code) continue;
      block.replaceWith(document.createTextNode("\\n\\n\`\`\`" + normalized.language + "\\n" + normalized.code + "\\n\`\`\`\\n\\n"));
    }
    return clone.innerText || clone.textContent || "";
  }

  function isVisibleElement(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) !== 0;
  }

  function getDomMessageId(section, role) {
    const existing = domRecorder.ids.get(section);
    if (existing) return existing;
    const id = "dom-" + role + "-" + Date.now().toString(36) + "-" + (++domRecorder.nextId).toString(36);
    domRecorder.ids.set(section, id);
    return id;
  }

  function extractDomTurn(section, order) {
    if (!section || !isVisibleElement(section)) return null;
    const role = section.classList.contains("user")
      ? "user"
      : section.classList.contains("assistant")
        ? "assistant"
        : "";
    if (!role) return null;
    const content = role === "user"
      ? queryFirst(section, [
        ".user-chat-bubble-request__content-wrapper",
        ".user-chat-bubble-request",
        ".user-chat-line",
        ".user-chat-bubble",
        ".icube-value",
        ".value",
      ])
      : queryFirst(section, [
        ".assistant-chat-turn-content .chat-markdown",
        ".assistant-chat-turn-content",
        ".assistant-chat-turn-content-inner-agent-wrapper",
        ".chat-markdown",
      ]);
    const text = normalizeDomMessageText(content ? extractDomMessageText(content) : section.innerText || section.textContent);
    if (!text) return null;
    if (role === "assistant" && /^(Builder|思考过程|任务完成)$/i.test(text)) return null;
    return {
      role,
      text,
      messageId: getDomMessageId(section, role),
      order,
      className: String(section.className || ""),
    };
  }

  function updateDomThreadId(turns) {
    const firstUser = turns.find((turn) => turn.role === "user");
    if (!firstUser) return;
    const signature = firstUser.text.slice(0, 240);
    if (!signature || signature === recorder.domThreadSignature) return;
    recorder.domThreadSignature = signature;
    recorder.domThreadId = "dom-thread-" + firstUser.messageId;
    const hasFreshNetworkSession = recorder.actualSessionId && Date.now() - recorder.actualSessionUpdatedAt < 5000;
    if (!hasFreshNetworkSession) {
      recorder.actualSessionId = "";
      recorder.actualSessionUpdatedAt = 0;
      recorder.actualSessionSource = "";
      recorder.captureSessionId = recorder.domThreadId;
    } else {
      recorder.captureSessionId = recorder.actualSessionId;
    }
  }

  function findDomCaptureRoot() {
    return document.querySelector("#agent-chat-view")
      || document.querySelector(".icube-chat-view-container")
      || document.querySelector(".chat-list-wrapper")
      || document.body;
  }

  function captureDomTurns(reason) {
    if (!document.body) return;
    const root = findDomCaptureRoot();
    if (!root) return;
    const sections = Array.from(root.querySelectorAll("section.chat-turn.user, section.chat-turn.assistant"));
    const turns = sections.map((section, index) => extractDomTurn(section, index + 1)).filter(Boolean);
    updateDomThreadId(turns);
    turns.forEach((turn) => {
      const sentKey = turn.messageId;
      const signature = turn.role + "\\u0000" + turn.text;
      if (domRecorder.sent.get(sentKey) === signature) return;
      domRecorder.sent.set(sentKey, signature);
      post("dom-message", {
        source: "dom",
        body: {
          role: turn.role,
          text: turn.text,
          messageId: turn.messageId,
          order: turn.order,
          reason,
          className: turn.className,
          timestamp: new Date().toISOString(),
        },
      });
    });
  }

  function scheduleDomCapture(reason) {
    clearTimeout(domRecorder.captureTimer);
    domRecorder.captureTimer = setTimeout(() => captureDomTurns(reason), 300);
  }

  function installDomCapture() {
    if (!document.body || !window.MutationObserver) {
      return;
    }
    captureDomTurns("install");
    domRecorder.observer = new MutationObserver(() => scheduleDomCapture("mutation"));
    domRecorder.observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    domRecorder.timer = setInterval(() => captureDomTurns("poll"), 2000);
  }

  installDomCapture();

  console.info("[agent-snapshot] Trae recorder installed. Capturing to", ENDPOINT, "pageSession=", recorder.pageSession);
})();`;
}

const SNAPSHOT_TRANSCRIPT_OPTIONS = {
  emptyHtml: "<div class='meta'>没有找到可分享的用户或助手消息。</div>",
  includeProcessMessageMeta: true,
  includeTopLevelToolMeta: true,
  labels: {
    processed: "已处理",
    tool: "Tool",
    imageUnavailable: "Image unavailable",
    imageAltPrefix: "Image attachment",
  },
};

function snapshotApiResponse(snapshot) {
  sanitizeSnapshotTurnHtml(snapshot);
  for (const subagent of snapshot.subagents || []) {
    sanitizeSnapshotTurnHtml(subagent);
  }
  const transcriptHtml = renderTranscriptHtml(snapshot.turns || [], SNAPSHOT_TRANSCRIPT_OPTIONS)
    + renderSubagentsHtml(snapshot.subagents);
  // The viewer renders from transcriptHtml only, so drop the (potentially huge)
  // raw subagent turn arrays from the JSON payload and keep lightweight headers.
  const subagents = (snapshot.subagents || []).map(({ turns, ...rest }) => ({
    ...rest,
    turnCount: Array.isArray(turns) ? turns.length : 0,
  }));
  return {
    ...snapshot,
    subagents,
    transcriptHtml,
  };
}

function renderSubagentsHtml(subagents) {
  const list = Array.isArray(subagents) ? subagents.filter((agent) => agent && (agent.turns || []).length) : [];
  if (!list.length) {
    return "";
  }
  const blocks = list.map((agent) => {
    const transcript = renderTranscriptHtml(agent.turns || [], SNAPSHOT_TRANSCRIPT_OPTIONS);
    const metaBits = [];
    if (agent.agentType) {
      metaBits.push("<span class='subagent-type'>" + escapeHtml(agent.agentType) + "</span>");
    }
    metaBits.push("<span class='subagent-count'>" + escapeHtml(agent.messageCount || 0) + " 条消息</span>");
    if (agent.toolCallCount) {
      metaBits.push("<span class='subagent-count'>" + escapeHtml(agent.toolCallCount) + " 次工具</span>");
    }
    return "<details class='subagent' data-tool-use-id='" + escapeHtml(agent.toolUseId || "") + "'>"
      + "<summary class='subagent-summary'><span class='subagent-label'>↳ " + escapeHtml(agent.label || "子代理") + "</span>"
      + "<span class='subagent-meta'>" + metaBits.join("") + "</span></summary>"
      + "<div class='subagent-body'>" + transcript + "</div>"
      + "</details>";
  }).join("");
  return "<section class='subagents'>"
    + "<div class='subagents-head'>子代理 <span class='subagents-count'>" + escapeHtml(list.length) + "</span></div>"
    + blocks
    + "</section>";
}

function applySafetyChecksOption(snapshot, enabled) {
  snapshot.safetyChecks = Boolean(enabled);
  if (!enabled) {
    snapshot.risks = [];
    snapshot.notices = [];
  }
  return snapshot;
}

function safeFileName(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "agent-snapshot";
}

function printHelp() {
  console.log(`agent-snapshot ${VERSION}

Usage:
  agent-snapshot list [--json] [--limit N] [--cwd DIR]
  agent-snapshot search <query> [--json] [--limit N] [--scan-limit N] [--cwd DIR]
  agent-snapshot preview <session-id|path> [--json] [--include-tools] [--include-tool-output]
  agent-snapshot export <session-id|path> [--html|--md] [--output FILE] [--gist] [--include-tools] [--include-tool-output]
  agent-snapshot publish <session-id|path> [--api-url URL] [--share-token TOKEN] [--site-url URL]
  agent-snapshot serve [--host 127.0.0.1] [--port 4321]
  agent-snapshot daemon install|status|logs|uninstall [--host 127.0.0.1] [--port 4321]
  agent-snapshot record-trae [--host 127.0.0.1] [--port 4732]

Options:
  --codex-home DIR         Use a custom Codex home. Defaults to $CODEX_HOME or ~/.codex
  --claude-home DIR        Use a custom Claude Code home. Defaults to $CLAUDE_HOME or ~/.claude
  --trae-home DIR          Use a custom Trae home. Defaults to $TRAE_HOME or ~/.trae-cn
  --trae-app-home DIR      Use a custom Trae app data home. Defaults to $TRAE_APP_HOME or ~/Library/Application Support/Trae CN
  --trae-recordings-dir DIR
                           Use a custom Trae recorder output dir. Defaults to $TRAE_RECORDINGS_DIR or ~/.agent-snapshot/trae-recordings
  --source codex|claude|trae|all
                           Choose which local agent history to list or search. Serve shows all configured sources in the UI.
  --scan-limit N           For search only: number of recent sessions to scan. Defaults to 600
  --include-tools          Include tool calls in previews and exports
  --include-tool-output    Include tool output as well as tool calls
  --no-redact              Disable automatic redaction
  --allow-unredacted       For publish and export --gist only: allow sharing a --no-redact snapshot
  --gist                   For export only: create a secret GitHub Gist with index.html, then print the Gist and preview URLs
  --gist-public            For export --gist only: create a public Gist instead of the default secret Gist
  --with-safety            For publish only: include local safety review rows in the cloud snapshot
  --api-url URL            For publish only: cloud API base. Defaults to $SNAPSHOT_SHARE_API_URL,
                           ~/.agent-snapshots-agent.json, or ${DEFAULT_SNAPSHOT_SHARE_API_URL}
  --site-url URL           For publish only: public site base used to print the share link.
                           Defaults to $SNAPSHOT_SHARE_SITE_URL, ~/.agent-snapshots-agent.json,
                           or ${DEFAULT_SNAPSHOT_SHARE_SITE_URL}
  --share-token TOKEN      For publish only: API token. Defaults to $SNAPSHOT_SHARE_TOKEN or ~/.agent-snapshots-agent.json
  --expires-in-days N      For publish only: ask the server to expire the share after N days
  --label LABEL            For daemon only: LaunchAgent label. Defaults to ${DEFAULT_DAEMON_LABEL}
  --live-only              Ignore archived_sessions when listing
  --record-sensitive-context
                           For record-trae only: persist captured request/response headers as local recorder context
  -h, --help               Show this help

Examples:
  agent-snapshot list --limit 20
  agent-snapshot search "redis race condition" --source all
  agent-snapshot export 019e457b --html -o snapshot.html
  agent-snapshot export 019e457b --gist
  agent-snapshot publish 019e457b --api-url ${DEFAULT_SNAPSHOT_SHARE_API_URL} --site-url ${DEFAULT_SNAPSHOT_SHARE_SITE_URL}
  agent-snapshot serve --port 4321
  agent-snapshot daemon install
  agent-snapshot record-trae --port 4732`);
}

function printDaemonHelp() {
  console.log(`agent-snapshot daemon

Usage:
  agent-snapshot daemon install [--host 127.0.0.1] [--port 4321]
  agent-snapshot daemon status
  agent-snapshot daemon logs
  agent-snapshot daemon uninstall

Installs a user-level macOS LaunchAgent that starts the npm-installed
Agent Snapshots viewer after login.

Environment:
  SNAPSHOT_DAEMON_NODE=/absolute/path/to/node
  SNAPSHOT_DAEMON_CLI=/absolute/path/to/agent-snapshot.mjs
  SNAPSHOT_LAUNCH_AGENT_LABEL=${DEFAULT_DAEMON_LABEL}
  SNAPSHOT_SHARE_API_URL=${DEFAULT_SNAPSHOT_SHARE_API_URL}
  SNAPSHOT_SHARE_SITE_URL=${DEFAULT_SNAPSHOT_SHARE_SITE_URL}
  SNAPSHOT_VIEWER_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
`);
}

export { detectRisks, redactText } from "../core/privacy.js";

export {
  renderHtml,
  renderMarkdown,
};
