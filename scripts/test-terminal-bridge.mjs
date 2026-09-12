#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildResumeShellCommand,
  buildWindowsResumePowerShellCommand,
  powershellQuote,
} from "../dist/server/terminal-bridge.mjs";

const sessionId = "11111111-2222-4333-8444-555555555555";
const windowsCommand = buildWindowsResumePowerShellCommand({
  engine: "codex",
  sessionId,
  codexHome: "C:\\Users\\O'Brien\\.codex",
});
assert.match(windowsCommand, /\$env:CODEX_HOME/);
assert(windowsCommand.includes("O''Brien"));
assert(windowsCommand.includes(`'resume' '--dangerously-bypass-approvals-and-sandbox' '${sessionId}'`));
assert.equal(powershellQuote("a'b"), "'a''b'");
assert.throws(() => buildWindowsResumePowerShellCommand({ engine: "codex", sessionId: "bad" }), /invalid session id/);

const macCommand = buildResumeShellCommand({
  engine: "claude",
  sessionId,
  cwd: "/tmp/project with spaces",
});
assert.equal(macCommand, `cd '/tmp/project with spaces' && claude --resume ${sessionId}`);

console.log("[terminal-bridge] PASS");
