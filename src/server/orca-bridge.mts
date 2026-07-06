// @ts-nocheck

// Bridge to the local Orca runtime: resume a Codex session inside an Orca
// terminal. This is the only place the read-only viewer spawns a process, and
// it stays tightly scoped — it only ever runs `orca terminal create` with a
// validated session UUID and an existing directory, never a shell string.

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

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

// `orca terminal switch/create --focus` only select the tab inside Orca; if the
// Orca window sits behind other apps the user still sees nothing. `open -a`
// activates the already-running app without launching a second instance.
// Best-effort: failing to raise the window must not fail the resume itself.
async function bringOrcaToFront() {
  if (process.platform !== "darwin") {
    return;
  }
  try {
    await execFileAsync("open", ["-a", "Orca"]);
  } catch {
    // Ignore: the tab switch already succeeded; the window just stays behind.
  }
}

// The resume command per engine, run inside an Orca terminal in the session's
// project. Codex threads resume with `codex resume`; Claude Code conversations
// resume by session id with `claude --resume`. (Trae has no CLI resume.)
const RESUME_COMMAND = {
  codex: (id) => `codex resume ${id}`,
  claude: (id) => `claude --resume ${id}`,
};

// Strip Orca's activity markers (✳ ✻ ● …) and collapse whitespace so a live
// terminal's title can be compared to a session's title.
function normTitle(t) {
  return String(t || "")
    .replace(/^[\s✳✻✽●•·*⋯…\-]+/u, "")
    .replace(/[\s…]+$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Is a live Orca terminal already running this session? Match by worktree path
// (the project) and title (which Codex/Claude set to the session title). Returns
// the terminal handle to switch to, or null. Titles in the list can be
// truncated ("..name") or marker-prefixed, so match loosely but require the
// same worktree to avoid switching to an unrelated session.
async function findRunningTerminalHandle(orca, dir, title) {
  const want = normTitle(title);
  if (!want) {
    return null;
  }
  let data;
  try {
    const { stdout } = await execFileAsync(orca, ["terminal", "list", "--json"]);
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  const terminals = (data && data.result && Array.isArray(data.result.terminals)) ? data.result.terminals : [];
  const inWorktree = terminals.filter((t) => t && t.worktreePath === dir && t.handle);
  for (const t of inWorktree) {
    const have = normTitle(t.title);
    if (!have) continue;
    if (have === want) return t.handle;
    // Truncated forms: the visible title may be a "..tail" or a leading slice.
    const bare = have.replace(/^[.…]+/, "").replace(/[.…]+$/, "");
    if (bare.length >= 5 && (want.includes(bare) || bare.includes(want))) return t.handle;
  }
  return null;
}

export async function resumeSessionInOrca({ engine, sessionId, cwd, title }) {
  const id = String(sessionId || "").trim();
  if (!SESSION_ID_RE.test(id)) {
    return { ok: false, error: "无效的会话 ID" };
  }
  const buildCommand = RESUME_COMMAND[engine];
  if (!buildCommand) {
    return { ok: false, error: "该会话无法在 Orca 中恢复（仅支持 Codex / Claude）" };
  }
  let dir = String(cwd || "").trim();
  // The viewer may only hold the redacted (~-prefixed) cwd; expand it.
  if (dir === "~" || dir.startsWith("~/")) {
    dir = path.join(os.homedir(), dir.slice(1));
  }
  if (!dir || !path.isAbsolute(dir)) {
    return { ok: false, error: "缺少会话工作目录" };
  }
  try {
    if (!statSync(dir).isDirectory()) {
      return { ok: false, error: "工作目录不是文件夹：" + dir };
    }
  } catch {
    return { ok: false, error: "工作目录不存在：" + dir };
  }

  const orca = resolveOrcaBinary();

  // Already running in Orca? Jump to that tab instead of resuming a duplicate.
  const existing = await findRunningTerminalHandle(orca, dir, title);
  if (existing) {
    try {
      await execFileAsync(orca, ["terminal", "switch", "--terminal", existing, "--json"]);
      await bringOrcaToFront();
      return { ok: true, message: "已切换到 Orca 中正在运行的会话" };
    } catch {
      // Fall through to creating a fresh resume if the switch failed.
    }
  }

  // Otherwise open a fresh terminal and resume there. No custom title, so
  // Codex/Claude name the tab by the session title (making the next resume
  // matchable and switch-to instead of duplicating).
  try {
    await execFileAsync(orca, [
      "terminal", "create",
      "--worktree", `path:${dir}`,
      "--command", buildCommand(id),
      "--focus",
      "--json",
    ]);
    await bringOrcaToFront();
    return { ok: true, message: "已在 Orca 中打开终端并恢复会话" };
  } catch (error) {
    const message = error && error.code === "ENOENT"
      ? "找不到 orca 命令（Orca 未安装或不在 PATH 中）"
      : String((error && (error.stderr || error.message)) || error).trim().slice(0, 400);
    return { ok: false, error: message };
  }
}
