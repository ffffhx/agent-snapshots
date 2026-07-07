// @ts-nocheck
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const RESUME_COMMAND = {
    codex: (id) => `codex resume ${id}`,
    claude: (id) => `claude --resume ${id}`,
};
const TERMINAL_TIMEOUT_MS = 8000;
export function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}
export function escapeAppleScriptString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
export function buildResumeShellCommand({ engine, sessionId, cwd }) {
    const buildCommand = RESUME_COMMAND[engine];
    if (!buildCommand) {
        throw new Error("unsupported engine");
    }
    const resumeCommand = buildCommand(sessionId);
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
export async function openResumeInTerminal({ engine, sessionId, cwd }) {
    if (process.platform !== "darwin") {
        return { ok: false, error: "当前平台不支持 Terminal 回退" };
    }
    const dir = await existingDirectoryOrNull(cwd);
    const command = buildResumeShellCommand({ engine, sessionId, cwd: dir });
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
