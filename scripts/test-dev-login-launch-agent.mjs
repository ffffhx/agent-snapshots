#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEV_LOGIN_LAUNCH_AGENT_LABEL,
  devLoginLaunchAgentPaths,
  installDevLoginLaunchAgent,
  uninstallDevLoginLaunchAgent,
} from "../electron/dev-login-launch-agent.mjs";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "agent-snapshots-login-agent-"));
const homeDir = path.join(tempDir, "home");
const binDir = path.join(tempDir, "pnpm-bin");
const appRoot = path.join(tempDir, "Agent & Snapshots");
const pnpmPath = path.join(binDir, "pnpm");
mkdirSync(binDir, { recursive: true });
writeFileSync(pnpmPath, "#!/bin/sh\nexit 0\n", "utf8");
chmodSync(pnpmPath, 0o755);

const calls = [];
const unloadedLaunchctl = (args) => {
  calls.push(args);
  return { status: args[0] === "print" ? 1 : 0, stdout: "", stderr: "" };
};

const installed = installDevLoginLaunchAgent({
  appRoot,
  homeDir,
  environmentPath: `${binDir}:/usr/bin:/bin`,
  uid: 501,
  runLaunchctl: unloadedLaunchctl,
});
const paths = devLoginLaunchAgentPaths(homeDir);
assert.equal(installed.plistPath, paths.plistPath);
assert.equal(installed.changed, true);
assert.equal(installed.loaded, false);
assert.deepEqual(calls, [
  ["enable", `gui/501/${DEV_LOGIN_LAUNCH_AGENT_LABEL}`],
  ["print", `gui/501/${DEV_LOGIN_LAUNCH_AGENT_LABEL}`],
  ["bootstrap", "gui/501", paths.plistPath],
]);

const plist = readFileSync(paths.plistPath, "utf8");
assert.match(plist, /<string>exec pnpm app:dev<\/string>/);
assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
assert.match(plist, /<key>AGENT_SNAPSHOT_START_HIDDEN<\/key>\s*<string>1<\/string>/);
assert(plist.includes("<string>" + appRoot.replace("&", "&amp;") + "</string>"));
assert(plist.includes(`<string>${binDir}:/`));

const loadedCalls = [];
const loaded = installDevLoginLaunchAgent({
  appRoot,
  homeDir,
  environmentPath: `${binDir}:/usr/bin:/bin`,
  uid: 501,
  runLaunchctl: (args) => {
    loadedCalls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  },
});
assert.equal(loaded.changed, false);
assert.equal(loaded.loaded, true);
assert.deepEqual(loadedCalls, [
  ["enable", `gui/501/${DEV_LOGIN_LAUNCH_AGENT_LABEL}`],
  ["print", `gui/501/${DEV_LOGIN_LAUNCH_AGENT_LABEL}`],
]);

const uninstallCalls = [];
uninstallDevLoginLaunchAgent({
  homeDir,
  uid: 501,
  runLaunchctl: (args) => {
    uninstallCalls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  },
});
assert.deepEqual(uninstallCalls, [
  ["disable", `gui/501/${DEV_LOGIN_LAUNCH_AGENT_LABEL}`],
]);
assert.equal(existsSync(paths.plistPath), false);

rmSync(tempDir, { recursive: true, force: true });
console.log("[dev-login-launch-agent] PASS");
