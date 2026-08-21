import { constants as fsConstants } from "node:fs";
import {
  accessSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const DEV_LOGIN_LAUNCH_AGENT_LABEL = "com.ffffhx.agent-snapshots.dev";

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function executableOnPath(name, environmentPath) {
  for (const directory of String(environmentPath || "").split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = path.join(directory, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep searching the remaining PATH entries.
    }
  }
  return "";
}

export function devLoginLaunchAgentPaths(homeDir = os.homedir()) {
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  const logDir = path.join(homeDir, "Library", "Logs", "Agent Snapshots");
  return {
    launchAgentsDir,
    logDir,
    plistPath: path.join(launchAgentsDir, `${DEV_LOGIN_LAUNCH_AGENT_LABEL}.plist`),
    stdoutPath: path.join(logDir, "dev.stdout.log"),
    stderrPath: path.join(logDir, "dev.stderr.log"),
  };
}

export function devLoginLaunchPath({
  homeDir = os.homedir(),
  environmentPath = process.env.PATH || "",
} = {}) {
  const pnpmPath = executableOnPath("pnpm", environmentPath);
  if (!pnpmPath) {
    throw new Error("找不到 pnpm，无法配置开发版开机自启。");
  }
  return unique([
    path.dirname(pnpmPath),
    path.join(homeDir, "Library", "pnpm"),
    path.join(homeDir, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]).join(":");
}

export function devLoginLaunchAgentPlist({
  appRoot,
  homeDir = os.homedir(),
  environmentPath = process.env.PATH || "",
} = {}) {
  if (!appRoot) {
    throw new Error("appRoot is required");
  }
  const paths = devLoginLaunchAgentPaths(homeDir);
  const launchPath = devLoginLaunchPath({ homeDir, environmentPath });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(DEV_LOGIN_LAUNCH_AGENT_LABEL)}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>exec pnpm app:dev</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${xml(appRoot)}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT_SNAPSHOT_START_HIDDEN</key>
    <string>1</string>
    <key>PATH</key>
    <string>${xml(launchPath)}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>ProcessType</key>
  <string>Interactive</string>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>${xml(paths.stdoutPath)}</string>

  <key>StandardErrorPath</key>
  <string>${xml(paths.stderrPath)}</string>
</dict>
</plist>
`;
}

function defaultLaunchctl(args) {
  return spawnSync("/bin/launchctl", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function launchctlError(action, result) {
  if (result?.error) {
    return result.error;
  }
  const detail = String(result?.stderr || result?.stdout || "").trim();
  return new Error(detail ? `${action}: ${detail}` : `${action}失败`);
}

function runRequiredLaunchctl(runLaunchctl, args, action) {
  const result = runLaunchctl(args);
  if (result?.status !== 0) {
    throw launchctlError(action, result);
  }
  return result;
}

function writeFileAtomically(filePath, contents) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, contents, "utf8");
  renameSync(tempPath, filePath);
}

export function installDevLoginLaunchAgent({
  appRoot,
  homeDir = os.homedir(),
  environmentPath = process.env.PATH || "",
  uid = process.getuid?.(),
  runLaunchctl = defaultLaunchctl,
} = {}) {
  if (!Number.isInteger(uid)) {
    throw new Error("无法确定当前用户 ID。");
  }
  const paths = devLoginLaunchAgentPaths(homeDir);
  const plist = devLoginLaunchAgentPlist({ appRoot, homeDir, environmentPath });
  mkdirSync(paths.launchAgentsDir, { recursive: true });
  mkdirSync(paths.logDir, { recursive: true });

  const previous = existsSync(paths.plistPath) ? readFileSync(paths.plistPath, "utf8") : "";
  if (previous !== plist) {
    writeFileAtomically(paths.plistPath, plist);
  }

  const domain = `gui/${uid}`;
  const service = `${domain}/${DEV_LOGIN_LAUNCH_AGENT_LABEL}`;
  runRequiredLaunchctl(runLaunchctl, ["enable", service], "启用开发版 LaunchAgent");

  const loaded = runLaunchctl(["print", service])?.status === 0;
  if (!loaded) {
    runRequiredLaunchctl(
      runLaunchctl,
      ["bootstrap", domain, paths.plistPath],
      "加载开发版 LaunchAgent",
    );
  }
  return { ...paths, changed: previous !== plist, loaded };
}

export function uninstallDevLoginLaunchAgent({
  homeDir = os.homedir(),
  uid = process.getuid?.(),
  runLaunchctl = defaultLaunchctl,
} = {}) {
  if (!Number.isInteger(uid)) {
    throw new Error("无法确定当前用户 ID。");
  }
  const paths = devLoginLaunchAgentPaths(homeDir);
  const service = `gui/${uid}/${DEV_LOGIN_LAUNCH_AGENT_LABEL}`;

  // Disabling first prevents KeepAlive from relaunching the current process.
  // We intentionally do not bootout here because that would also terminate the
  // app from which the user just unchecked "开机自启".
  runRequiredLaunchctl(runLaunchctl, ["disable", service], "禁用开发版 LaunchAgent");
  rmSync(paths.plistPath, { force: true });
  return paths;
}
