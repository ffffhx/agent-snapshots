import { spawnSync } from "node:child_process";

export function runBash(args, { label = "bash check" } = {}) {
  const result = spawnSync("bash", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error?.code === "ENOENT" && process.platform === "win32") {
    console.log(`[${label}] SKIP: bash is not installed on this Windows host`);
    return;
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
  }
}
