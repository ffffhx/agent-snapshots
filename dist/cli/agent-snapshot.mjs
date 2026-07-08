#!/usr/bin/env node
// @ts-nocheck
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sanitizeSnapshotHtml as sanitizeSnapshotTurnHtml, stripAppDirectives as stripCodexAppDirectives, } from "../shared/sanitize.js";
import { buildTranscriptOutlineItems, isInterruptionMarker, renderTranscriptHtml } from "../renderers/transcript.js";
import { createGitHubGist } from "../server/gist-publish.mjs";
import { serveLocalViewer } from "../server/local-viewer.mjs";
import { readCodexQuotaSnapshot } from "../server/quota-meter.mjs";
import { defaultSearchIndexPath, searchIndexStats, syncSearchIndex } from "../server/search-index.mjs";
import { semanticIndexStatus } from "../server/semantic-index.mjs";
import { sessionListCachePath, sessionListCacheStatus } from "../server/session-list-cache.mjs";
import { buildWeeklyDigest, renderWeeklyDigestMarkdown } from "../server/weekly-digest.mjs";
import { discoverCodexHomes } from "../sources/codex-homes.mjs";
import { listSessions, loadSnapshot, searchSessions } from "../sources/index.mjs";
const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
const cliPath = fileURLToPath(import.meta.url);
const VERSION = readPackageVersion(packageRoot);
const DEFAULT_LIMIT = 40;
const DEFAULT_SERVER_LIMIT = 80;
const DEFAULT_VIEWER_PORT = 4321;
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
        }
        catch { }
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
    }
    catch {
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
    if (parsed.command === "digest" && parsed.options.help) {
        printDigestHelp();
        return;
    }
    if (parsed.command === "doctor" && parsed.options.help) {
        printDoctorHelp();
        return;
    }
    if (parsed.options.help || parsed.command === "help" || !parsed.command) {
        printHelp();
        return;
    }
    const codexHome = path.resolve(parsed.options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
    const claudeHome = path.resolve(parsed.options.claudeHome || process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"));
    if (parsed.command === "digest") {
        await ensureDigestTokenIndex({
            codexHome,
            claudeHome,
        });
        const digest = await buildWeeklyDigest({
            codexHome,
            claudeHome,
            listSessions,
            weeks: parsed.options.weeks || 1,
        });
        if (parsed.options.json) {
            console.log(JSON.stringify(digest, null, 2));
        }
        else {
            process.stdout.write(renderWeeklyDigestMarkdown(digest));
        }
        return;
    }
    if (parsed.command === "doctor") {
        const report = await buildDoctorReport({ codexHome, claudeHome });
        if (parsed.options.json) {
            console.log(JSON.stringify(report, null, 2));
        }
        else {
            console.log(renderDoctorReport(report));
        }
        return;
    }
    if (parsed.command === "list") {
        const sessions = await listSessions({
            codexHome,
            claudeHome,
            limit: parsed.options.limit || DEFAULT_LIMIT,
            cwd: parsed.options.cwd,
            includeArchived: parsed.options.includeArchived,
            source: parsed.options.source,
        });
        if (parsed.options.json) {
            console.log(JSON.stringify(sessions, null, 2));
        }
        else {
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
        }
        else {
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
            includeTools: parsed.options.includeTools,
            includeToolOutput: parsed.options.includeToolOutput,
            redact: !parsed.options.noRedact,
        });
        if (parsed.options.json) {
            console.log(JSON.stringify(snapshot, null, 2));
        }
        else {
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
        }
        else {
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
        await serve({ codexHome, claudeHome, host, port });
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
        weeks: 0,
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
        if (arg === "--codex-home" || arg === "--claude-home" || arg === "--cwd" || arg === "--limit" || arg === "--scan-limit" || arg === "--weeks" || arg === "--output" || arg === "-o" || arg === "--port" || arg === "--host" || arg === "--source" || arg === "--api-url" || arg === "--site-url" || arg === "--share-token" || arg === "--expires-in-days" || arg === "--label") {
            const value = args[index + 1];
            if (!value) {
                throw new Error(`${arg} requires a value`);
            }
            if (arg === "--codex-home") {
                options.codexHome = value;
            }
            else if (arg === "--claude-home") {
                options.claudeHome = value;
            }
            else if (arg === "--cwd") {
                options.cwd = value;
            }
            else if (arg === "--limit") {
                options.limit = readPositiveInteger(value, "--limit");
            }
            else if (arg === "--scan-limit") {
                options.scanLimit = readPositiveInteger(value, "--scan-limit");
            }
            else if (arg === "--weeks") {
                options.weeks = readPositiveInteger(value, "--weeks");
            }
            else if (arg === "--label") {
                options.label = value;
            }
            else if (arg === "--output" || arg === "-o") {
                options.output = value;
            }
            else if (arg === "--port") {
                options.port = readPositiveInteger(value, "--port");
            }
            else if (arg === "--host") {
                options.host = value;
            }
            else if (arg === "--source") {
                if (!["codex", "claude", "all"].includes(value)) {
                    throw new Error("--source must be codex, claude, or all");
                }
                options.source = value;
            }
            else if (arg === "--api-url") {
                options.apiUrl = value;
            }
            else if (arg === "--site-url") {
                options.siteUrl = value;
            }
            else if (arg === "--share-token") {
                options.shareToken = value;
            }
            else if (arg === "--expires-in-days") {
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
    }
    catch (error) {
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
    }
    catch { }
    try {
        await execLaunchctl(["bootout", `${guiDomain()}/${config.label}`]);
    }
    catch { }
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
    }
    catch {
        return "(missing)";
    }
}
function formatDaemonCommand(config) {
    return `${shellQuote(config.nodePath)} ${shellQuote(config.cliPath)} serve --host ${shellQuote(config.host)} --port ${shellQuote(config.port)}`;
}
function readOptionalPositiveInteger(value, label) {
    return value ? readPositiveInteger(value, label) : 0;
}
async function buildDoctorReport({ codexHome, claudeHome }) {
    const now = Date.now();
    const codexHomes = await safeDiagnostic("codexHomes", () => discoverCodexHomes(codexHome), []);
    const codexSessions = await safeDiagnostic("codexSessions", () => listSessions({
        codexHome,
        claudeHome,
        limit: Number.POSITIVE_INFINITY,
        includeArchived: true,
        source: "codex",
        completeOnly: false,
    }), []);
    const codexSessionCounts = countBy(codexSessions, (session) => session.codexHomeKey || "");
    const claudeHomeExists = await pathExists(claudeHome);
    const claudeProjectCount = await directoryEntryCount(path.join(claudeHome, "projects"));
    const cacheStatus = await safeDiagnostic("sessionListCache", () => sessionListCacheStatus(), null);
    const searchStats = await safeDiagnostic("searchIndex", () => searchIndexStats(), null);
    const semanticStatus = await safeDiagnostic("semanticIndex", () => semanticIndexStatus(), null);
    const quota = await safeDiagnostic("quota", () => readCodexQuotaSnapshot({ codexHome }), { available: false });
    const [orcaCli, ghCli] = await Promise.all([commandOnPath("orca"), commandOnPath("gh")]);
    return {
        generatedAt: new Date(now).toISOString(),
        homes: {
            codex: codexHomes.map((home) => ({
                path: home.home,
                key: home.key,
                label: home.label || (home.primary ? "default" : ""),
                primary: home.primary === true,
                exists: existsSync(home.home),
                sessionCount: Number(codexSessionCounts.get(home.key) || 0),
            })),
            claude: {
                path: claudeHome,
                exists: claudeHomeExists,
                projectCount: claudeProjectCount,
            },
        },
        sessionListCache: {
            path: cacheStatus?.path || sessionListCachePath(),
            rows: Number(cacheStatus?.rows || 0),
            watermark: cacheStatus?.watermark || "",
            watermarkAgeMs: cacheStatus?.watermarkMs ? Math.max(0, now - Number(cacheStatus.watermarkMs)) : 0,
            lastReconcileAt: cacheStatus?.lastReconcileAt || "",
            lastReconcileError: cacheStatus?.lastReconcileError || "",
            available: Boolean(cacheStatus),
        },
        searchIndex: {
            path: defaultSearchIndexPath(),
            rows: Number(searchStats?.indexedSessions || 0),
            sessionsWithTokens: Number(searchStats?.sessionsWithTokens || 0),
            totalTokens: Number(searchStats?.totalTokens || 0),
            coldStarting: Number(searchStats?.indexedSessions || 0) > 0 && Number(searchStats?.sessionsWithTokens || 0) === 0,
            available: Boolean(searchStats),
        },
        semanticIndex: semanticStatus || {
            path: "",
            exists: false,
            available: false,
            entries: 0,
            model: "",
            provider: "",
            updatedAt: "",
            error: "unavailable",
        },
        quota: {
            found: quota?.available === true,
            updatedAt: quota?.updatedAt || "",
            ageMs: quota?.updatedAt ? Math.max(0, now - new Date(quota.updatedAt).getTime()) : 0,
            weeklyPercent: quota?.secondary ? Number(quota.secondary.usedPercent || 0) : null,
            fiveHourPercent: quota?.primary ? Number(quota.primary.usedPercent || 0) : null,
            planType: quota?.planType || "",
        },
        tools: {
            orca: orcaCli,
            gh: ghCli,
            terminalFallback: {
                available: process.platform === "darwin",
                platform: process.platform,
            },
        },
    };
}
async function safeDiagnostic(_label, fn, fallback) {
    try {
        return await fn();
    }
    catch {
        return fallback;
    }
}
async function ensureDigestTokenIndex({ codexHome, claudeHome }) {
    const stats = await safeDiagnostic("digestSearchIndex", () => searchIndexStats(), null);
    if (Number(stats?.sessionsWithTokens || 0) > 0) {
        return;
    }
    const sessions = await safeDiagnostic("digestSessions", () => listSessions({
        codexHome,
        claudeHome,
        source: "all",
        includeArchived: true,
        completeOnly: true,
        limit: 1,
    }), []);
    if (!sessions.length) {
        return;
    }
    process.stderr.write("Token 索引为空，正在同步本机会话以生成 digest...\n");
    const result = await syncSearchIndex({
        codexHome,
        claudeHome,
        source: "all",
        includeArchived: true,
        completeOnly: true,
        scanLimit: 20_000,
        updateLimit: 20_000,
        includeTools: false,
        includeToolOutput: false,
        withTokens: true,
    });
    process.stderr.write(`Token 索引同步完成：扫描 ${formatInteger(result.scanned)}，更新 ${formatInteger(result.updated)}，待处理 ${formatInteger(result.pending)}，失败 ${formatInteger(result.failed)}。\n`);
}
async function pathExists(filePath) {
    try {
        await stat(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function directoryEntryCount(dirPath) {
    try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).length;
    }
    catch {
        return 0;
    }
}
function countBy(items, keyFn) {
    const counts = new Map();
    for (const item of items || []) {
        const key = keyFn(item);
        counts.set(key, Number(counts.get(key) || 0) + 1);
    }
    return counts;
}
async function commandOnPath(command) {
    try {
        const { stdout } = await execFileAsync("which", [command], { timeout: 2000 });
        const commandPath = stdout.trim().split(/\r?\n/)[0] || "";
        return { available: Boolean(commandPath), path: commandPath };
    }
    catch {
        return { available: false, path: "" };
    }
}
function renderDoctorReport(report) {
    const lines = [];
    lines.push("Agent Snapshot Doctor");
    lines.push(`生成时间：${formatDate(report.generatedAt)}`);
    lines.push("");
    lines.push(checkLine(report.homes.codex.some((home) => home.exists), "Codex homes", `${report.homes.codex.length} 个 home`));
    for (const home of report.homes.codex) {
        const label = home.label ? ` · ${home.label}` : "";
        lines.push(`  ${checkSymbol(home.exists)} ${home.path}${label} · sessions ${formatInteger(home.sessionCount)}`);
    }
    lines.push(checkLine(report.homes.claude.exists, "Claude Code home", `${report.homes.claude.path} · projects ${formatInteger(report.homes.claude.projectCount)}`));
    const cache = report.sessionListCache;
    lines.push(checkLine(cache.available ? (cache.rows > 0 ? true : null) : false, "Session-list cache", `${cache.path} · rows ${formatInteger(cache.rows)} · watermark ${cache.watermark ? ageText(cache.watermarkAgeMs) : "无"}`));
    const search = report.searchIndex;
    const tokenRowsText = search.coldStarting ? "索引冷启动中" : formatInteger(search.sessionsWithTokens);
    lines.push(checkLine(search.available ? (search.rows > 0 ? true : null) : false, "Search index", `${search.path} · rows ${formatInteger(search.rows)} · token rows ${tokenRowsText}`));
    const semantic = report.semanticIndex;
    const semanticDetail = semantic.exists
        ? `${semantic.path} · entries ${formatInteger(semantic.entries)} · ${semantic.model || "unknown"}${semantic.updatedAt ? ` · updated ${ageText(Date.now() - new Date(semantic.updatedAt).getTime())}` : ""}`
        : `${semantic.path || "默认路径"} · 未生成`;
    lines.push(checkLine(semantic.available ? true : null, "Semantic index", semanticDetail));
    const quota = report.quota;
    const quotaDetail = quota.found
        ? `age ${ageText(quota.ageMs)} · weekly ${formatOptionalPercent(quota.weeklyPercent)} · 5h ${formatOptionalPercent(quota.fiveHourPercent)}${quota.planType ? ` · ${quota.planType}` : ""}`
        : "未找到 Codex rate_limits 快照";
    lines.push(checkLine(quota.found, "Codex quota", quotaDetail));
    lines.push(checkLine(report.tools.orca.available, "orca CLI on PATH", report.tools.orca.path || "not found"));
    lines.push(checkLine(report.tools.gh.available, "gh CLI on PATH", report.tools.gh.path || "not found"));
    lines.push(checkLine(report.tools.terminalFallback.available ? true : null, "Terminal fallback", report.tools.terminalFallback.available ? "darwin 可用" : `${report.tools.terminalFallback.platform} 不适用`));
    return lines.join("\n");
}
function checkLine(status, label, detail) {
    return `${checkSymbol(status)} ${label}: ${detail}`;
}
function checkSymbol(status) {
    if (status === true)
        return "✓";
    if (status === false)
        return "✗";
    return "–";
}
function ageText(ageMs) {
    const ms = Number(ageMs || 0);
    if (!Number.isFinite(ms) || ms <= 0) {
        return "刚刚";
    }
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1)
        return "刚刚";
    if (minutes < 60)
        return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30)
        return `${days} 天前`;
    const months = Math.floor(days / 30);
    if (months < 12)
        return `${months} 个月前`;
    return `${Math.floor(months / 12)} 年前`;
}
function formatOptionalPercent(value) {
    return value === null || value === undefined ? "-" : `${Math.round(Number(value || 0))}%`;
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
    }
    catch (error) {
        throw new Error(formatShareApiNetworkError(error, requestPayload.apiUrl));
    }
    const text = await response.text();
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch {
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
    return normalizeUrl(apiUrl ||
        process.env.SNAPSHOT_SHARE_API_URL ||
        process.env.TOKEN_BOARD_API_URL ||
        process.env.NEXT_PUBLIC_TOKEN_BOARD_API_URL ||
        process.env.AGENT_SNAPSHOTS_SHARE_API_URL ||
        process.env.CODEX_SNAPSHOTS_SHARE_API_URL ||
        config.apiUrl ||
        DEFAULT_SNAPSHOT_SHARE_API_URL);
}
function resolveShareToken(token) {
    const config = readDefaultShareConfig();
    return (token ||
        process.env.SNAPSHOT_SHARE_TOKEN ||
        process.env.AGENT_SNAPSHOTS_SHARE_TOKEN ||
        process.env.CODEX_SNAPSHOTS_SHARE_TOKEN ||
        process.env.TOKEN_BOARD_AGENT_TOKEN ||
        process.env.TOKEN_BOARD_UPLOAD_TOKEN ||
        config.token ||
        "");
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
async function publishAllSnapshots({ codexHome, claudeHome, cwd, includeArchived, source, completeOnly, limit, includeTools, includeToolOutput, safety, }) {
    const sessions = await listSessions({
        codexHome,
        claudeHome,
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
        }
        catch (error) {
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
                apiUrl: firstNonEmptyString(payload.snapshotShareApiUrl, payload.snapshotSharePublicApiUrl, payload.shareApiUrl, payload.publicApiUrl, payload.apiUrl),
                siteUrl: firstNonEmptyString(payload.snapshotShareSiteUrl, payload.shareSiteUrl, payload.siteUrl),
                token: firstNonEmptyString(payload.snapshotShareToken, payload.agentToken, payload.token, payload.uploadToken),
            };
            if (config.apiUrl || config.siteUrl || config.token) {
                defaultShareConfigCache = config;
                return defaultShareConfigCache;
            }
        }
        catch { }
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
    }
    catch {
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
        }
        else {
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
            }
            else {
                lines.push("```text", turn.text, "```", "");
            }
        }
        else {
            const visibleText = stripCodexAppDirectives(turn.text);
            if (visibleText) {
                lines.push(visibleText, "");
            }
            for (const image of turn.images || []) {
                if (image.src) {
                    lines.push(`![${escapeMarkdown(image.alt || "Image attachment")}](${image.src})`, "");
                }
                else {
                    lines.push(`> [image unavailable: ${escapeMarkdown(image.unavailableReason || "unsupported image source")}]`, "");
                }
            }
        }
    }
    return lines.join("\n");
}
function renderHtml(snapshot) {
    const outlineItems = buildTranscriptOutlineItems(snapshot.turns || [], { anchorPrefix: "turn-" });
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
        turnAnchorPrefix: "turn-",
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
<body data-export-verbosity="standard" data-outline-open="${outlineItems.length ? "true" : "false"}">
  ${snapshotOutlineHtml(outlineItems)}
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
    <nav class="snapshot-controls" aria-label="Reading controls">
      <div class="verbosity-control" aria-label="Verbosity">
        <button type="button" data-export-verbosity="standard" aria-pressed="true">标准</button>
        <button type="button" data-export-verbosity="detailed" aria-pressed="false">详细</button>
        <button type="button" data-export-verbosity="summary" aria-pressed="false">摘要</button>
      </div>
      <button type="button" id="toggleAllDetails">全部展开</button>
      ${outlineItems.length ? `<button type="button" id="toggleOutline" aria-pressed="true">收起大纲</button>` : ""}
    </nav>
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
  <script>${snapshotInlineScript()}</script>
</body>
</html>`;
}
function snapshotOutlineHtml(items) {
    if (!items.length) {
        return "";
    }
    return `<aside class="snapshot-outline" id="snapshotOutline" aria-label="Outline">
    <div class="outline-head"><b>大纲</b><button type="button" id="closeOutline">收起</button></div>
    <div class="outline-list">${items.map((item) => `
      <a class="outline-item" href="#${escapeHtml(item.id)}" data-outline-target="${escapeHtml(item.id)}">
        <span class="outline-kind">用户 ${escapeHtml(item.turn)}</span>
        <span class="outline-text">${escapeHtml(item.label)}</span>
      </a>`).join("")}
    </div>
  </aside>`;
}
function snapshotInlineScript() {
    return `(()=>{const d=document,b=d.body,$=id=>d.getElementById(id),all=s=>Array.from(d.querySelectorAll(s)),m=["standard","detailed","summary"],reduced=()=>typeof matchMedia=="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches;function details(){return all("details.process-details,details.tool-details")}function syncAll(){const x=details(),o=x.length&&x.every(e=>e.open),t=$("toggleAllDetails");if(t){t.disabled=!x.length;t.textContent=o?"全部收起":"全部展开"}}function setMode(v){v=m.includes(v)?v:"standard";b.dataset.exportVerbosity=v;all("[data-export-verbosity]").forEach(e=>{const a=e.dataset.exportVerbosity===v;e.classList.toggle("active",a);e.setAttribute("aria-pressed",a?"true":"false")});details().forEach(e=>{e.open=v==="detailed"});syncAll();active()}function setOutline(o){b.dataset.outlineOpen=o?"true":"false";const p=$("snapshotOutline"),t=$("toggleOutline");if(p)p.setAttribute("aria-hidden",o?"false":"true");if(t){t.textContent=o?"收起大纲":"打开大纲";t.setAttribute("aria-pressed",o?"true":"false")}}function active(){let best="",dist=1/0;all("[data-outline-target]").forEach(a=>{const n=$(a.dataset.outlineTarget||"");if(!n||getComputedStyle(n).display==="none")return;const r=n.getBoundingClientRect(),v=Math.abs(r.top-innerHeight*.28);if(r.bottom>=0&&v<dist){dist=v;best=n.id}});all("[data-outline-target]").forEach(a=>a.classList.toggle("active",a.dataset.outlineTarget===best))}all("[data-export-verbosity]").forEach(e=>e.addEventListener("click",()=>setMode(e.dataset.exportVerbosity)));$("toggleAllDetails")?.addEventListener("click",()=>{const x=details(),open=!(x.length&&x.every(e=>e.open));x.forEach(e=>{e.open=open});syncAll()});$("toggleOutline")?.addEventListener("click",()=>setOutline(b.dataset.outlineOpen!=="true"));$("closeOutline")?.addEventListener("click",()=>setOutline(false));all("[data-outline-target]").forEach(a=>a.addEventListener("click",e=>{const n=$(a.dataset.outlineTarget||"");if(n){e.preventDefault();n.scrollIntoView({behavior:reduced()?"auto":"smooth",block:"center"});history.replaceState(null,"","#"+n.id);active()}}));details().forEach(e=>e.addEventListener("toggle",syncAll));addEventListener("scroll",active,{passive:true});addEventListener("resize",active);setMode("standard");setOutline(b.dataset.outlineOpen==="true");syncAll();active()})();`;
}
function snapshotCss() {
    return `
:root {
  color-scheme: light dark;
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
  --focus: rgba(36, 93, 131, 0.35);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
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
.snapshot-controls {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 253, 248, 0.94);
  padding: 8px;
  box-shadow: 0 18px 42px -36px rgba(22, 25, 31, 0.38);
}
.verbosity-control {
  display: inline-flex;
  gap: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(22, 25, 31, 0.04);
  padding: 3px;
}
.snapshot-controls button,
.outline-head button {
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel);
  color: var(--ink);
  padding: 0 11px;
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
}
.snapshot-controls button:hover,
.outline-head button:hover {
  border-color: rgba(36, 93, 131, 0.38);
  color: var(--blue);
}
.snapshot-controls button:focus-visible,
.outline-head button:focus-visible,
.outline-item:focus-visible,
.file-path-action:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.snapshot-controls button.active,
.snapshot-controls button[aria-pressed="true"] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--panel);
}
.snapshot-controls button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.snapshot-outline {
  position: fixed;
  top: 96px;
  right: 16px;
  bottom: 22px;
  z-index: 20;
  display: flex;
  width: min(312px, calc(100vw - 32px));
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--line);
  border-top: 3px solid var(--blue);
  border-radius: 10px;
  background: rgba(255, 253, 248, 0.96);
  padding: 12px;
  box-shadow: 0 34px 82px -46px rgba(22, 25, 31, 0.72);
  opacity: 0;
  pointer-events: none;
  transform: translateX(calc(100% + 24px));
  transition: opacity 180ms ease, transform 180ms ease;
}
body[data-outline-open="true"] .snapshot-outline {
  opacity: 1;
  pointer-events: auto;
  transform: none;
}
.outline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 9px;
}
.outline-head b {
  color: var(--ink);
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.outline-list {
  display: grid;
  gap: 2px;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
}
.outline-item {
  display: grid;
  min-height: 36px;
  align-items: start;
  gap: 5px;
  border-radius: 8px;
  color: var(--ink);
  padding: 8px 9px;
  text-decoration: none;
}
.outline-item:hover {
  background: rgba(36, 93, 131, 0.08);
}
.outline-item.active {
  background: rgba(36, 93, 131, 0.12);
  box-shadow: inset 3px 0 0 var(--blue);
}
.outline-kind {
  color: var(--muted);
  font: 800 10px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.outline-text {
  min-width: 0;
  overflow: hidden;
  font: 500 12.5px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}
body[data-export-verbosity="summary"] .turn-process,
body[data-export-verbosity="summary"] .turn.process,
body[data-export-verbosity="summary"] .turn-tool,
body[data-export-verbosity="summary"] .turn.tool,
body[data-export-verbosity="summary"] .turn-interrupt,
body[data-export-verbosity="summary"] .turn.interrupt {
  display: none !important;
}
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
.turn-meta-badge {
  min-height: 16px;
  margin: 0 0 7px auto;
  color: var(--muted);
  font: 800 11px/1.25 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
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
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  color: var(--amber);
  cursor: pointer;
  font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.tool-details summary::-webkit-details-marker { display: none; }
.tool-details summary::after {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  content: "";
  transform: translateY(-2px) rotate(45deg);
  transition: transform 0.16s ease;
}
.tool-details[open] summary::after {
  transform: translateY(2px) rotate(225deg);
}
.file-path-action {
  display: inline;
  border-radius: 4px;
  color: inherit;
  cursor: copy;
  text-decoration: underline;
  text-decoration-color: rgba(163, 58, 43, 0.4);
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}
.file-path-action:hover {
  color: var(--red);
  text-decoration-color: var(--red);
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
  .snapshot-outline {
    top: auto;
    right: 10px;
    bottom: 10px;
    left: 10px;
    width: auto;
    max-height: min(420px, 58dvh);
    transform: translateY(calc(100% + 18px));
  }
  body[data-outline-open="true"] .snapshot-outline { transform: none; }
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #f1eadc;
    --muted: #b5ad9e;
    --line: #3d3931;
    --paper: #181713;
    --panel: #211f1a;
    --panel-strong: #2c281f;
    --green: #76b39e;
    --red: #df887a;
    --amber: #e0b463;
    --blue: #8bb7d9;
    --focus: rgba(139, 183, 217, 0.48);
  }
  body {
    background:
      linear-gradient(90deg, rgba(241, 234, 220, 0.045) 1px, transparent 1px),
      linear-gradient(rgba(241, 234, 220, 0.035) 1px, transparent 1px),
      var(--paper);
  }
  .snapshot-controls,
  .snapshot-outline,
  .meta-grid div,
  .path-band,
  .goal-band,
  .risk-panel {
    background: rgba(33, 31, 26, 0.94);
  }
  .turn-user .message-card,
  .turn.user .message-card {
    border-color: rgba(118, 179, 158, 0.28);
    background: rgba(38, 68, 59, 0.42);
  }
  .turn-tool .message-card,
  .turn.tool .message-card {
    border-color: rgba(224, 180, 99, 0.34);
    background: rgba(76, 55, 21, 0.3);
  }
  .risk { background: rgba(24, 70, 45, 0.28); }
  .risk-high { background: rgba(115, 45, 38, 0.28); }
  .risk-medium { background: rgba(103, 72, 22, 0.28); }
  .markdown-body code { background: rgba(241, 234, 220, 0.08); }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .snapshot-outline,
  .process-summary::after,
  .tool-details summary::after { transition: none; }
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
function formatInteger(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat("zh-CN").format(Number.isFinite(number) ? Math.round(number) : 0);
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
async function serve({ codexHome, claudeHome, host, port }) {
    await serveLocalViewer({
        codexHome,
        claudeHome,
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
  agent-snapshot digest [--weeks N] [--json]
  agent-snapshot doctor [--json]
  agent-snapshot serve [--host 127.0.0.1] [--port 4321]
  agent-snapshot daemon install|status|logs|uninstall [--host 127.0.0.1] [--port 4321]

Options:
  --codex-home DIR         Use a custom Codex home. Defaults to $CODEX_HOME or ~/.codex
  --claude-home DIR        Use a custom Claude Code home. Defaults to $CLAUDE_HOME or ~/.claude
  --source codex|claude|all
                           Choose which local agent history to list or search. Serve shows all configured sources in the UI.
  --scan-limit N           For search only: number of recent sessions to scan. Defaults to 600
  --weeks N                For digest only: number of complete previous weeks to include. Defaults to 1
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
  -h, --help               Show this help

Examples:
  agent-snapshot list --limit 20
  agent-snapshot search "redis race condition" --source all
  agent-snapshot export 019e457b --html -o snapshot.html
  agent-snapshot export 019e457b --gist
  agent-snapshot publish 019e457b --api-url ${DEFAULT_SNAPSHOT_SHARE_API_URL} --site-url ${DEFAULT_SNAPSHOT_SHARE_SITE_URL}
  agent-snapshot digest --weeks 2
  agent-snapshot doctor
  agent-snapshot serve --port 4321
  agent-snapshot daemon install`);
}
function printDigestHelp() {
    console.log(`agent-snapshot digest

Usage:
  agent-snapshot digest [--weeks N] [--json]

Prints the weekly Agent usage digest without starting the local viewer.
By default it writes the same Markdown report used by the viewer's 周报 action.

Options:
  --weeks N     Number of complete previous weeks to include before 本周. Defaults to 1
  --json        Print the raw digest payload
  -h, --help    Show this help
`);
}
function printDoctorHelp() {
    console.log(`agent-snapshot doctor

Usage:
  agent-snapshot doctor [--json]

Prints local environment diagnostics as an informational checklist. Missing
optional tools are reported as ✗ or – but do not change the exit code.

Options:
  --json        Print the raw diagnostics payload
  -h, --help    Show this help
`);
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
export { renderHtml, renderMarkdown, };
