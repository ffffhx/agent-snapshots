// @ts-nocheck
import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const RESUME_COMMAND = {
    codex: (id, codexHome = "") => `${codexEnvPrefix(codexHome)}codex resume --dangerously-bypass-approvals-and-sandbox ${id}`,
    claude: (id) => `claude --resume ${id}`,
};
const TERMINAL_TIMEOUT_MS = 8000;
const SESSION_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
function codexEnvPrefix(codexHome) {
    const home = String(codexHome || "").trim();
    return home ? `CODEX_HOME=${shellQuote(home)} ` : "";
}
export function escapeAppleScriptString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
export function buildResumeShellCommand({ engine, sessionId, cwd, codexHome = "" }) {
    const buildCommand = RESUME_COMMAND[engine];
    if (!buildCommand) {
        throw new Error("unsupported engine");
    }
    const resumeCommand = buildCommand(sessionId, codexHome);
    return cwd ? `cd ${shellQuote(cwd)} && ${resumeCommand}` : resumeCommand;
}
export function buildTerminalAppleScript(app, shellCommand) {
    const command = escapeAppleScriptString(shellCommand);
    if (app === "iTerm2") {
        return [
            'tell application "iTerm2"',
            "create window with default profile",
            `tell current session of current window to write text "${command}"`,
            "activate",
            "end tell",
        ];
    }
    return [
        'tell application "Terminal"',
        `do script "${command}"`,
        "activate",
        "end tell",
    ];
}
export function powershellQuote(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
}
export function buildWindowsResumePowerShellCommand({ engine, sessionId, codexHome = "" }) {
    const id = String(sessionId || "").trim();
    if (!SESSION_ID_RE.test(id)) {
        throw new Error("invalid session id");
    }
    let executable;
    let args;
    if (engine === "codex") {
        executable = "codex";
        args = ["resume", "--dangerously-bypass-approvals-and-sandbox", id];
    }
    else if (engine === "claude") {
        executable = "claude";
        args = ["--resume", id];
    }
    else {
        throw new Error("unsupported engine");
    }
    const commands = [];
    const home = String(codexHome || "").trim();
    if (home && engine === "codex") {
        commands.push(`$env:CODEX_HOME = ${powershellQuote(home)}`);
    }
    commands.push(`& ${powershellQuote(executable)} ${args.map(powershellQuote).join(" ")}`);
    return commands.join("; ");
}
function expandHomeDir(cwd) {
    const dir = String(cwd || "").trim();
    if (dir === "~" || dir.startsWith("~/")) {
        return path.join(os.homedir(), dir.slice(1));
    }
    return dir;
}
async function existingDirectoryOrNull(cwd) {
    const dir = expandHomeDir(cwd);
    if (!dir || !path.isAbsolute(dir)) {
        return null;
    }
    try {
        const info = await stat(dir);
        return info.isDirectory() ? dir : null;
    }
    catch {
        return null;
    }
}
async function isITerm2Running() {
    try {
        await execFileAsync("pgrep", ["-x", "iTerm2"], { timeout: 2000 });
        return true;
    }
    catch {
        return false;
    }
}
function osascriptArgs(lines) {
    const args = [];
    for (const line of lines) {
        args.push("-e", line);
    }
    return args;
}
function formatTerminalError(error) {
    return String((error && (error.stderr || error.message)) || error || "unknown error").trim().slice(0, 400);
}
function spawnDetached(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            ...options,
            detached: true,
            stdio: "ignore",
            windowsHide: false,
        });
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
    });
}
async function windowsTerminalAvailable() {
    try {
        await execFileAsync("where.exe", ["wt.exe"], { timeout: 2000, windowsHide: true });
        return true;
    }
    catch {
        return false;
    }
}
async function openResumeInWindowsTerminal({ engine, sessionId, cwd, codexHome }) {
    const dir = await existingDirectoryOrNull(cwd) || os.homedir();
    const command = buildWindowsResumePowerShellCommand({ engine, sessionId, codexHome });
    const powershellArgs = ["-NoLogo", "-NoExit", "-Command", command];
    if (await windowsTerminalAvailable()) {
        await spawnDetached("wt.exe", ["-d", dir, "powershell.exe", ...powershellArgs], { cwd: dir });
        return { ok: true, via: "terminal", app: "Windows Terminal", message: "Orca 不可用，已在 Windows Terminal 打开" };
    }
    await spawnDetached("powershell.exe", powershellArgs, { cwd: dir });
    return { ok: true, via: "terminal", app: "PowerShell", message: "Orca 不可用，已在 PowerShell 打开" };
}
export async function openResumeInTerminal({ engine, sessionId, cwd, codexHome = "" }) {
    if (process.platform === "win32") {
        try {
            return await openResumeInWindowsTerminal({ engine, sessionId, cwd, codexHome });
        }
        catch (error) {
            return { ok: false, error: formatTerminalError(error) || "打开 Windows Terminal 失败" };
        }
    }
    if (process.platform !== "darwin") {
        return { ok: false, error: "当前平台不支持 Terminal 回退" };
    }
    const dir = await existingDirectoryOrNull(cwd);
    const command = buildResumeShellCommand({ engine, sessionId, cwd: dir, codexHome });
    const app = (await isITerm2Running()) ? "iTerm2" : "Terminal";
    const script = buildTerminalAppleScript(app, command);
    try {
        await execFileAsync("osascript", osascriptArgs(script), { timeout: TERMINAL_TIMEOUT_MS });
        return { ok: true, via: "terminal", app, message: `Orca 不可用，已在 ${app} 打开` };
    }
    catch (error) {
        return { ok: false, error: formatTerminalError(error) || "打开 Terminal 失败" };
    }
}
