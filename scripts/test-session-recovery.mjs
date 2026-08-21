#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  excludeLiveRecoverySessions,
  mergeRecoverySessions,
  normalizeRecoverySession,
  readSessionRecoveryState,
  storedSessionRecoveryState,
} from "../electron/session-recovery.mjs";

const first = {
  ref: "codex:11111111-2222-4333-8444-555555555555",
  cwd: "/tmp/project-one",
  title: "First session",
  observedAt: "2026-07-24T01:00:00.000Z",
};
const second = {
  ref: "claude:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  cwd: "/tmp/project-two",
  title: "Second session",
  observedAt: "2026-07-24T02:00:00.000Z",
};

assert.deepEqual(normalizeRecoverySession(first), first);
assert.equal(normalizeRecoverySession({ ref: "codex:bad", cwd: "" }), null);
assert.equal(normalizeRecoverySession({ ref: "shell:anything", cwd: "/tmp" }), null);

const merged = mergeRecoverySessions(
  [first],
  [{ ...first, title: "Latest title" }, second],
);
assert.equal(merged.length, 2);
assert.equal(merged[0].title, "Latest title");

const crashed = readSessionRecoveryState({
  monitoring: true,
  liveSessions: [first, second],
  recoverableSessions: [{ ...first, title: "Older title" }],
});
assert.deepEqual(crashed.recoverableSessions, [first, second]);

const clean = readSessionRecoveryState({
  monitoring: false,
  liveSessions: [first],
  recoverableSessions: [second],
});
assert.deepEqual(clean.recoverableSessions, [second]);

assert.deepEqual(excludeLiveRecoverySessions([first, second], [second]), [first]);

const stored = storedSessionRecoveryState({
  monitoring: true,
  liveSessions: [first],
  recoverableSessions: [second],
});
assert.equal(stored.version, 1);
assert.equal(stored.monitoring, true);
assert.deepEqual(stored.liveSessions, [first]);
assert.deepEqual(stored.recoverableSessions, [second]);
assert(Number.isFinite(new Date(stored.updatedAt).getTime()));

console.log("[session-recovery] PASS");
