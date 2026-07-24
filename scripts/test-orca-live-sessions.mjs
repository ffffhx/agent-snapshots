#!/usr/bin/env node

import assert from "node:assert/strict";
import { matchOrcaProcessesToSessions } from "../electron/orca-live-sessions.mjs";

const sessions = [
  {
    ref: "codex:11111111-2222-4333-8444-555555555555",
    engine: "codex",
    cwd: "/tmp/project",
    createdAt: "2026-07-24T02:45:20.000Z",
    mtime: "2026-07-24T03:00:00.000Z",
  },
  {
    ref: "codex:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    engine: "codex",
    cwd: "/tmp/project",
    createdAt: "2026-07-20T02:45:20.000Z",
    mtime: "2026-07-20T03:00:00.000Z",
  },
  {
    ref: "claude:99999999-8888-4777-8666-555555555555",
    engine: "claude",
    cwd: "/tmp/claude",
    createdAt: "2026-07-24T04:00:10.000Z",
    mtime: "2026-07-24T04:30:00.000Z",
  },
];

const matchedFresh = matchOrcaProcessesToSessions([
  {
    engine: "codex",
    cwd: "/tmp/project",
    startedAtMs: new Date("2026-07-24T02:44:50.000Z").getTime(),
  },
], sessions);
assert.deepEqual(matchedFresh.map((session) => session.ref), [sessions[0].ref]);

const matchedResume = matchOrcaProcessesToSessions([
  {
    engine: "claude",
    cwd: "/different/path",
    startedAtMs: Date.now(),
    resumeId: "99999999-8888-4777-8666-555555555555",
  },
], sessions);
assert.deepEqual(matchedResume.map((session) => session.ref), [sessions[2].ref]);

const unmatchedStale = matchOrcaProcessesToSessions([
  {
    engine: "codex",
    cwd: "/tmp/project",
    startedAtMs: new Date("2026-07-24T10:00:00.000Z").getTime(),
  },
], sessions);
assert.deepEqual(unmatchedStale, []);

console.log("[orca-live-sessions] PASS");
