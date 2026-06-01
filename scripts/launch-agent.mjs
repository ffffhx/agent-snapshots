#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const cliPath = path.join(repoRoot, "dist", "cli", "codex-snapshot.mjs");
const legacyCommand = process.argv[2] || "status";
const args = ["daemon", legacyCommand, ...process.argv.slice(3)];

if (legacyCommand === "help" || legacyCommand === "--help" || legacyCommand === "-h") {
  args.splice(1, 1, "help");
}

const child = spawn(process.execPath, [cliPath, ...args], {
  cwd: repoRoot,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code || 0;
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
