// @ts-nocheck
// Bridge to the local Orca runtime: resume a Codex session inside an Orca
// terminal. This is the only place the read-only viewer spawns a process, and
// it stays tightly scoped — it only ever runs `orca terminal create` with a
// validated session UUID and an existing directory, never a shell string.
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// A Codex/Claude session id is a UUID; accept only hex + dashes so it can never
// inject into the `codex resume <id>` command Orca runs in its terminal shell.
const SESSION_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// GUI-launched servers (Electron) get a minimal PATH, so resolve the orca
// binary by known locations before falling back to PATH.
const ORCA_CANDIDATES = [
    "/usr/local/bin/orca",
    "/opt/homebrew/bin/orca",
    "/Applications/Orca.app/Contents/Resources/bin/orca",
];
function resolveOrcaBinary() {
    for (const candidate of ORCA_CANDIDATES) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return "orca";
}
// The resume command per engine, run inside an Orca terminal in the session's
// project. Codex threads resume with `codex resume`; Claude Code conversations
// resume by session id with `claude --resume`. (Trae has no CLI resume.)
const RESUME_COMMAND = {
    codex: (id) => `codex resume ${id}`,
    claude: (id) => `claude --resume ${id}`,
};
export function resumeSessionInOrca({ engine, sessionId, cwd }) {
    return new Promise((resolve) => {
        const id = String(sessionId || "").trim();
        if (!SESSION_ID_RE.test(id)) {
            resolve({ ok: false, error: "无效的会话 ID" });
            return;
        }
        const buildCommand = RESUME_COMMAND[engine];
        if (!buildCommand) {
            resolve({ ok: false, error: "该会话无法在 Orca 中恢复（仅支持 Codex / Claude）" });
            return;
        }
        let dir = String(cwd || "").trim();
        // The viewer may only hold the redacted (~-prefixed) cwd; expand it.
        if (dir === "~" || dir.startsWith("~/")) {
            dir = path.join(os.homedir(), dir.slice(1));
        }
        if (!dir || !path.isAbsolute(dir)) {
            resolve({ ok: false, error: "缺少会话工作目录" });
            return;
        }
        let real;
        try {
            real = statSync(dir);
        }
        catch {
            resolve({ ok: false, error: "工作目录不存在：" + dir });
            return;
        }
        if (!real.isDirectory()) {
            resolve({ ok: false, error: "工作目录不是文件夹：" + dir });
            return;
        }
        const args = [
            "terminal",
            "create",
            "--worktree",
            `path:${dir}`,
            "--command",
            buildCommand(id),
            "--title",
            `resume ${id.slice(0, 8)}`,
            "--focus",
            "--json",
        ];
        let child;
        try {
            child = spawn(resolveOrcaBinary(), args, { stdio: ["ignore", "pipe", "pipe"] });
        }
        catch (error) {
            resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
            return;
        }
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk) => { out += chunk; });
        child.stderr.on("data", (chunk) => { err += chunk; });
        child.on("error", (error) => {
            const message = error && error.code === "ENOENT"
                ? "找不到 orca 命令（Orca 未安装或不在 PATH 中）"
                : (error instanceof Error ? error.message : String(error));
            resolve({ ok: false, error: message });
        });
        child.on("close", (code) => {
            if (code === 0) {
                resolve({ ok: true, message: "已在 Orca 中打开终端并恢复会话" });
            }
            else {
                resolve({ ok: false, error: (err || out || `orca 退出码 ${code}`).trim().slice(0, 400) });
            }
        });
    });
}
