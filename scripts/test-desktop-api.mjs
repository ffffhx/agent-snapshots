#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSRF_HEADER = "x-agent-snapshot-csrf";
const SESSION_ID = "desktop-api-session-001";
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const PEEK_SECRET = "sk-desktopPeekSecretToken1234567890";
const LONG_EMOJI_TEXT = "\u{1F600}".repeat(405);

const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-snapshots-desktop-api-"));
let serverProcess;

try {
  const codexHome = path.join(tempDir, "codex");
  const extraCodexHome = path.join(tempDir, "orca", "home");
  const claudeHome = path.join(tempDir, "claude");
  const traeHome = path.join(tempDir, "trae");
  const traeAppHome = path.join(tempDir, "trae-app");
  const traeRecordingsDir = path.join(tempDir, "trae-recordings");
  const prefsDir = path.join(tempDir, "prefs");
  const cacheHome = path.join(tempDir, "cache");

  await writeCodexFixture(extraCodexHome, {
    firstUserText: "Inspect this extra-home Codex fixture with unique keyword multiHomeCodexNeedle.",
    assistantText: "The extra-home fixture is visible.",
    startedAt: "2026-05-31T00:00:00.000Z",
    sessionDate: "2026-05-31",
  });
  await writeCodexFixture(codexHome);
  await mkdir(claudeHome, { recursive: true });
  await mkdir(traeHome, { recursive: true });
  await mkdir(traeAppHome, { recursive: true });
  await mkdir(traeRecordingsDir, { recursive: true });
  await mkdir(prefsDir, { recursive: true });
  await mkdir(cacheHome, { recursive: true });

  const port = await getFreePort();
  const viewerUrl = `http://127.0.0.1:${port}`;
  const origin = new URL(viewerUrl).origin;

  serverProcess = spawn(process.execPath, [
    "dist/cli/agent-snapshot.mjs",
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      AGENT_SNAPSHOT_PREFS_DIR: prefsDir,
      AGENT_SNAPSHOT_EXTRA_CODEX_HOMES: extraCodexHome,
      CLAUDE_HOME: claudeHome,
      CODEX_HOME: codexHome,
      HOME: tempDir,
      TRAE_APP_HOME: traeAppHome,
      TRAE_HOME: traeHome,
      TRAE_RECORDINGS_DIR: traeRecordingsDir,
      XDG_CACHE_HOME: cacheHome,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = collectChildOutput(serverProcess);
  await waitForJson(`${viewerUrl}/api/sessions?source=all&limit=1&completeOnly=0`, output, serverProcess);

  const csrfToken = extractCsrfToken(await fetchText(viewerUrl));
  const tests = [
    ["GET /api/quota returns unavailable or quota window shape", () => assertQuota(viewerUrl)],
    ["GET /api/activity returns per-day engine aggregations", () => assertActivity(viewerUrl)],
    ["GET /api/weekly-digest returns weekly markdown shape", () => assertWeeklyDigest(viewerUrl)],
    ["GET /api/images and /api/image return image entries safely", () => assertImages(viewerUrl)],
    ["GET /api/session-head validates missing and real ids", () => assertSessionHead(viewerUrl)],
    ["multi-home Codex sessions list and round-trip refs", () => assertMultiHomeCodex(viewerUrl)],
    ["GET /api/session-peek returns lightweight redacted turns", () => assertSessionPeek(viewerUrl)],
    ["launcher prefs reject missing CSRF and persist pin changes", () => assertLauncherPrefs(viewerUrl, origin, csrfToken)],
    ["session notes CRUD is local-only and capped", () => assertSessionNotes(viewerUrl, origin, csrfToken)],
    ["reveal-in-file rejects unsafe requests without opening Finder", () => assertRevealInFile(viewerUrl, origin, csrfToken)],
    ["POST routes reject disallowed origins", () => assertBadOriginRejected(viewerUrl, csrfToken)],
    ["claude quota starts a new block at the exact 5h boundary", () => assertClaudeQuotaBlockBoundary(path.join(tempDir, "claude-block-home"))],
    ["cold session cache applies liveOnly before returning fallback rows", () => assertColdSessionCacheLiveOnly(path.join(tempDir, "cache-cold-live"))],
  ];

  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${name}`);
      console.error(`  ${error instanceof Error ? error.message : error}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log(`\n✓ desktop API integration checks passed (${tests.length}/${tests.length})`);
  }
} finally {
  await stopChild(serverProcess);
  await rm(tempDir, { recursive: true, force: true });
}

async function assertQuota(viewerUrl) {
  const { response, payload } = await fetchJsonResponse(`${viewerUrl}/api/quota`);
  assert(response.status === 200, `/api/quota should return 200, got ${response.status}`);
  assert(typeof payload.available === "boolean", "quota payload should include boolean available");

  if (!payload.available) {
    return;
  }

  assert(typeof payload.updatedAt === "string", "available quota should include updatedAt string");
  assert(Object.hasOwn(payload, "primary"), "available quota should include primary window");
  assert(Object.hasOwn(payload, "secondary"), "available quota should include secondary window");
  assert(typeof payload.planType === "string", "available quota should include planType string");
  assertQuotaWindow(payload.primary, "primary");
  assertQuotaWindow(payload.secondary, "secondary");
}

async function assertActivity(viewerUrl) {
  const { response, payload } = await fetchJsonResponse(`${viewerUrl}/api/activity?limit=20`);
  assert(response.status === 200, `/api/activity should return 200, got ${response.status}`);
  assertValidIso(payload.generatedAt, "activity generatedAt");
  assert(payload.range && typeof payload.range === "object", "activity should include range object");
  assert(typeof payload.range.startDate === "string", "activity range should include startDate");
  assert(typeof payload.range.endDate === "string", "activity range should include endDate");
  assertEngineCounts(payload.engines, "activity engines");

  assert(Array.isArray(payload.days) && payload.days.length > 0, "activity should include per-day rows");
  for (const day of payload.days) {
    assert(typeof day.date === "string", "activity day should include date string");
    assertEngineCounts(day, `activity day ${day.date}`);
  }

  assert(Array.isArray(payload.hours) && payload.hours.length === 24, "activity should include 24 hourly rows");
  for (const hour of payload.hours) {
    assert(Number.isInteger(hour.hour) && hour.hour >= 0 && hour.hour <= 23, "activity hour should be 0-23");
    assertEngineCounts(hour, `activity hour ${hour.hour}`);
  }
}

async function assertWeeklyDigest(viewerUrl) {
  const { response, payload } = await fetchJsonResponse(`${viewerUrl}/api/weekly-digest?weeks=1&limit=20`);
  assert(response.status === 200, `/api/weekly-digest should return 200, got ${response.status}`);
  assertValidIso(payload.generatedAt, "weekly digest generatedAt");
  assert(typeof payload.generatedDate === "string", "weekly digest should include generatedDate");
  assert(payload.range && typeof payload.range === "object", "weekly digest should include range object");
  assert(typeof payload.range.startDate === "string", "weekly digest range should include startDate");
  assert(typeof payload.range.endDate === "string", "weekly digest range should include endDate");
  assert(Array.isArray(payload.weeks) && payload.weeks.length === 2, "weeks=1 should return last complete week plus current week");
  assert(typeof payload.markdown === "string" && payload.markdown.includes("# Agent 使用周报"), "weekly digest should include markdown title");
  assert(payload.markdown.includes("### 概览"), "weekly markdown should include overview section");
  assert(payload.markdown.includes("### Top 项目"), "weekly markdown should include top projects section");

  for (const week of payload.weeks) {
    assert(week.range && typeof week.range === "object", "weekly row should include range");
    assert(typeof week.range.startDate === "string", "weekly row range should include startDate");
    assert(typeof week.range.endDate === "string", "weekly row range should include endDate");
    assert(typeof week.range.label === "string", "weekly row range should include label");
    assertEngineCounts(week.sessionCount, `weekly ${week.range.label} sessionCount`);
    assertTokenCounts(week.totalTokens, `weekly ${week.range.label} totalTokens`);
    assert(Array.isArray(week.topProjects), "weekly row should include topProjects array");
    assert(week.topProjects.length <= 5, "weekly topProjects should be capped at 5");
    if (week.busiestDay !== null) {
      assert(typeof week.busiestDay.date === "string", "weekly busiestDay should include date");
      assert(typeof week.busiestDay.sessions === "number", "weekly busiestDay should include session count");
    }
    if (week.longestSession !== null) {
      assert(typeof week.longestSession.title === "string", "weekly longestSession should include title");
      assert(typeof week.longestSession.ref === "string", "weekly longestSession should include ref");
      assert(typeof week.longestSession.turns === "number", "weekly longestSession should include turns");
    }
  }
}

async function assertImages(viewerUrl) {
  const { response, payload } = await fetchJsonResponse(`${viewerUrl}/api/images?limit=3`);
  assert(response.status === 200, `/api/images should return 200, got ${response.status}`);
  assert(Array.isArray(payload.entries), "/api/images should return entries array");
  assert(payload.entries.length > 0, "fixture session should produce at least one image entry");

  const [entry] = payload.entries;
  assert(typeof entry.id === "string" && entry.id, "image entry should include id");
  assert(typeof entry.mime === "string" && entry.mime.startsWith("image/"), "image entry should include image mime");

  const imageResponse = await fetch(`${viewerUrl}/api/image?ref=${encodeURIComponent(entry.id)}`, {
    signal: AbortSignal.timeout(2000),
  });
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  assert(imageResponse.status === 200, `/api/image should return 200 for real ref, got ${imageResponse.status}`);
  assert(String(imageResponse.headers.get("content-type") || "").startsWith("image/"), "/api/image should return image content-type");
  assert(bytes.length > 0, "/api/image should return image bytes");

  const bogus = await fetch(`${viewerUrl}/api/image?ref=not-a-valid-image-ref`, {
    signal: AbortSignal.timeout(2000),
  });
  assert(bogus.status >= 400 && bogus.status < 500, `bogus image ref should return 4xx, got ${bogus.status}`);

  const forged = await fetch(`${viewerUrl}/api/image?ref=${encodeURIComponent(encodeImageId({
    sessionRef: `codex:${path.join(tempDir, "outside-codex-home.jsonl")}`,
    turnIndex: 0,
    imageIndex: 0,
  }))}`, {
    signal: AbortSignal.timeout(2000),
  });
  assert(forged.status >= 400 && forged.status < 500, `forged path image ref should return 4xx, got ${forged.status}`);
}

async function assertSessionHead(viewerUrl) {
  const missing = await fetch(`${viewerUrl}/api/session-head`, {
    signal: AbortSignal.timeout(2000),
  });
  assert(missing.status === 400, `missing session-head id should return 400, got ${missing.status}`);

  const sessions = await fetchJson(`${viewerUrl}/api/sessions?source=all&limit=1&completeOnly=0`);
  assert(Array.isArray(sessions) && sessions.length > 0, "fixture should provide a real session");
  const id = sessions[0].ref || `codex:${sessions[0].id}`;
  const { response, payload } = await fetchJsonResponse(`${viewerUrl}/api/session-head?id=${encodeURIComponent(id)}`);
  assert(response.status === 200, `/api/session-head should return 200 for ${id}, got ${response.status}`);
  assert(typeof payload.complete === "boolean", "session head should include complete boolean");
  assert(typeof payload.turnCount === "number" && payload.turnCount >= 0, "session head should include numeric turnCount");
}

async function assertMultiHomeCodex(viewerUrl) {
  const sessions = await fetchJson(`${viewerUrl}/api/sessions?source=codex&all=1&completeOnly=0`);
  const matching = sessions.filter((session) => session.id === SESSION_ID);
  assert(matching.length === 2, `same Codex session id should be listed from two homes: ${JSON.stringify(matching)}`);
  const primary = matching.find((session) => session.ref === `codex:${SESSION_ID}`);
  const extra = matching.find((session) => /^codex:home-[0-9a-f]{12}:/.test(session.ref || ""));
  assert(primary, "primary home session should keep the backward-compatible ref");
  assert(extra, "extra home session should use an expanded ref with a home key");
  assert(extra.codexHomeLabel === "orca", `extra home should carry origin label, got ${JSON.stringify(extra.codexHomeLabel)}`);

  const { response, payload } = await fetchJsonResponse(`${viewerUrl}/api/session-head?id=${encodeURIComponent(extra.ref)}`);
  assert(response.status === 200, `/api/session-head should round-trip expanded ref, got ${response.status}`);
  assert(typeof payload.complete === "boolean", "expanded-ref session head should include complete boolean");

  const search = await fetchJson(`${viewerUrl}/api/search?source=codex&noIndex=1&q=${encodeURIComponent("multiHomeCodexNeedle")}&limit=5`);
  assert(Array.isArray(search.results), "multi-home search should return a results array");
  assert(search.results.some((result) => result.ref === extra.ref), `live search should find extra home ref: ${JSON.stringify(search.results)}`);
}

async function assertSessionPeek(viewerUrl) {
  const missing = await fetch(`${viewerUrl}/api/session-peek`, {
    signal: AbortSignal.timeout(2000),
  });
  assert(missing.status === 400, `missing session-peek id should return 400, got ${missing.status}`);

  const invalid = await fetch(`${viewerUrl}/api/session-peek?id=${encodeURIComponent("codex:../../outside.jsonl")}`, {
    signal: AbortSignal.timeout(2000),
  });
  assert(invalid.status === 400, `invalid session-peek id should return 400, got ${invalid.status}`);

  const notFound = await fetch(`${viewerUrl}/api/session-peek?id=${encodeURIComponent("codex:not-a-real-session")}`, {
    signal: AbortSignal.timeout(2000),
  });
  assert(notFound.status === 404, `unknown session-peek id should return 404, got ${notFound.status}`);

  const sessions = await fetchJson(`${viewerUrl}/api/sessions?source=all&limit=1&completeOnly=0`);
  assert(Array.isArray(sessions) && sessions.length > 0, "fixture should provide a real session");
  const id = sessions[0].ref || `codex:${sessions[0].id}`;
  const { response, payload } = await fetchJsonResponse(`${viewerUrl}/api/session-peek?id=${encodeURIComponent(id)}&turns=1`);
  assert(response.status === 200, `/api/session-peek should return 200 for ${id}, got ${response.status}`);
  assert(typeof payload.title === "string" && payload.title.length > 0, "session peek should include title");
  assert(typeof payload.project === "string", "session peek should include project string");
  assertValidIso(payload.mtime, "session peek mtime");
  assert(Array.isArray(payload.turns), "session peek should include turns array");
  assert(payload.turns.length === 1, `turns=1 should return one turn, got ${payload.turns.length}`);
  assert(payload.turns[0].role === "assistant", "turns=1 should return the last assistant message from the fixture");
  assert(payload.turns[0].text === "The image fixture is available.", "session peek should return plain turn text");
  assert(payload.turns.every((turn) => typeof turn.text === "string" && turn.text.length <= 400), "peek turn text should be capped at 400 chars");

  const allTurns = await fetchJson(`${viewerUrl}/api/session-peek?id=${encodeURIComponent(id)}&turns=3`);
  const redactedTurn = allTurns.turns.find((turn) => String(turn.text || "").includes("REDACTED"));
  assert(redactedTurn, "peek should use the same text redaction policy as snapshots");
  assert(!JSON.stringify(allTurns).includes(PEEK_SECRET), "peek payload should not leak raw secrets");
  const emojiTurn = allTurns.turns.find((turn) => Array.from(String(turn.text || "")).every((char) => char === "\u{1F600}"));
  assert(emojiTurn, "peek should include the long emoji fixture turn");
  assert(Array.from(emojiTurn.text).length === 400, `peek should truncate by code point, got ${Array.from(emojiTurn.text).length}`);
  assert(!emojiTurn.text.includes("\uFFFD"), "peek truncation should not introduce replacement characters");
}

async function assertLauncherPrefs(viewerUrl, origin, csrfToken) {
  const initial = await fetchJson(`${viewerUrl}/api/launcher-prefs`);
  assert(Array.isArray(initial.pinned), "launcher prefs should include pinned array");

  const noCsrf = await fetch(`${viewerUrl}/api/launcher-prefs/pin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ ref: "codex:desktop-api-prefs-fake", engine: "codex", pinned: true }),
    signal: AbortSignal.timeout(2000),
  });
  assert([400, 403].includes(noCsrf.status), `launcher prefs pin without CSRF should be rejected, got ${noCsrf.status}`);

  const noTouchCsrf = await fetch(`${viewerUrl}/api/launcher-prefs/touch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ ref: "codex:desktop-api-prefs-fake", cwd: path.join(tempDir, "fake-project") }),
    signal: AbortSignal.timeout(2000),
  });
  assert([400, 403].includes(noTouchCsrf.status), `launcher prefs touch without CSRF should be rejected, got ${noTouchCsrf.status}`);

  const touchRef = `codex:${SESSION_ID}`;
  const touchCwd = path.join(tempDir, "codex", "fixture-project");
  const touch = await fetchJson(`${viewerUrl}/api/launcher-prefs/touch`, {
    method: "POST",
    headers: mutationHeaders(origin, csrfToken),
    body: JSON.stringify({ ref: touchRef, cwd: touchCwd }),
  });
  assert(touch.ok === true, `touch should return ok=true: ${JSON.stringify(touch)}`);

  const afterTouch = await fetchJson(`${viewerUrl}/api/launcher-prefs`);
  assert(afterTouch.accesses?.[touchRef]?.count === 1, "touched ref should persist access count");
  assert(afterTouch.projects?.[touchCwd]?.count === 1, "touched cwd should persist project count");

  const ref = "codex:desktop-api-prefs-fake";
  const pin = await fetchJson(`${viewerUrl}/api/launcher-prefs/pin`, {
    method: "POST",
    headers: mutationHeaders(origin, csrfToken),
    body: JSON.stringify({ ref, engine: "codex", pinned: true }),
  });
  assert(pin.ok === true, `pin should return ok=true: ${JSON.stringify(pin)}`);

  const afterPin = await fetchJson(`${viewerUrl}/api/launcher-prefs`);
  assert(afterPin.pinned.some((item) => item.ref === ref && item.engine === "codex"), "pinned ref should persist after pin");

  const unpin = await fetchJson(`${viewerUrl}/api/launcher-prefs/pin`, {
    method: "POST",
    headers: mutationHeaders(origin, csrfToken),
    body: JSON.stringify({ ref, engine: "codex", pinned: false }),
  });
  assert(unpin.ok === true, `unpin should return ok=true: ${JSON.stringify(unpin)}`);

  const afterUnpin = await fetchJson(`${viewerUrl}/api/launcher-prefs`);
  assert(!afterUnpin.pinned.some((item) => item.ref === ref), "pinned ref should be removed after unpin");

  const concurrentPins = Array.from({ length: 6 }, (_, index) => `codex:desktop-api-race-pin-${index}`);
  const concurrentTouches = Array.from({ length: 6 }, (_, index) => ({
    ref: `codex:desktop-api-race-touch-${index}`,
    cwd: path.join(tempDir, "race-project", String(index)),
  }));
  await Promise.all([
    ...concurrentPins.map((pinRef) => fetchJson(`${viewerUrl}/api/launcher-prefs/pin`, {
      method: "POST",
      headers: mutationHeaders(origin, csrfToken),
      body: JSON.stringify({ ref: pinRef, engine: "codex", pinned: true }),
    })),
    ...concurrentTouches.map((touchItem) => fetchJson(`${viewerUrl}/api/launcher-prefs/touch`, {
      method: "POST",
      headers: mutationHeaders(origin, csrfToken),
      body: JSON.stringify(touchItem),
    })),
  ]);
  const afterConcurrent = await fetchJson(`${viewerUrl}/api/launcher-prefs`);
  for (const pinRef of concurrentPins) {
    assert(afterConcurrent.pinned.some((item) => item.ref === pinRef), `concurrent pin should persist ${pinRef}`);
  }
  for (const touchItem of concurrentTouches) {
    assert(afterConcurrent.accesses?.[touchItem.ref]?.count === 1, `concurrent touch ref should persist ${touchItem.ref}`);
    assert(afterConcurrent.projects?.[touchItem.cwd]?.count === 1, `concurrent touch cwd should persist ${touchItem.cwd}`);
  }
}

async function assertSessionNotes(viewerUrl, origin, csrfToken) {
  const noteRef = `codex:${SESSION_ID}`;
  const initial = await fetchJson(`${viewerUrl}/api/session-notes?id=${encodeURIComponent(noteRef)}`);
  assert(Object.keys(initial).length === 0, `empty note response should be {}, got ${JSON.stringify(initial)}`);

  const noCsrf = await fetch(`${viewerUrl}/api/session-notes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ id: noteRef, text: "missing csrf" }),
    signal: AbortSignal.timeout(2000),
  });
  assert([400, 403].includes(noCsrf.status), `session notes without CSRF should be rejected, got ${noCsrf.status}`);

  const sentinel = "LOCAL_ONLY_NOTE_SENTINEL";
  const longText = `${sentinel} ${"x".repeat(2100)}`;
  const saved = await fetchJson(`${viewerUrl}/api/session-notes`, {
    method: "POST",
    headers: mutationHeaders(origin, csrfToken),
    body: JSON.stringify({ id: noteRef, text: longText }),
  });
  assert(saved.ok === true, `note save should return ok=true: ${JSON.stringify(saved)}`);
  assert(Array.from(saved.text || "").length === 2000, "note text should be capped at 2000 code points");
  assertValidIso(saved.updatedAt, "note updatedAt");

  const loaded = await fetchJson(`${viewerUrl}/api/session-notes?id=${encodeURIComponent(noteRef)}`);
  assert(loaded.text === saved.text, "GET session note should return saved text");
  assert(loaded.updatedAt === saved.updatedAt, "GET session note should return saved updatedAt");

  const prefs = await fetchJson(`${viewerUrl}/api/launcher-prefs`);
  assert(Array.isArray(prefs.noteRefs), "launcher prefs should include noteRefs");
  assert(prefs.noteRefs.includes(noteRef), "launcher prefs noteRefs should include saved note ref");
  assert(typeof prefs.notePreviews?.[noteRef] === "string", "launcher prefs should include note preview text");
  assert(prefs.notePreviews[noteRef].includes(sentinel), "note preview should include the note summary");
  assert(Array.from(prefs.notePreviews[noteRef]).length <= 80, "note preview should be capped at 80 chars");

  const exportHtml = await fetchText(`${viewerUrl}/export?id=${encodeURIComponent(noteRef)}&format=html&redact=1&includeTools=1&includeToolOutput=0`);
  assert(!exportHtml.includes(sentinel), "HTML export should not include local session notes");

  const sharePayload = await fetchJson(`${viewerUrl}/api/share-payload?id=${encodeURIComponent(noteRef)}&redact=1&includeTools=1&includeToolOutput=0`, {
    method: "POST",
    headers: mutationHeaders(origin, csrfToken),
  });
  assert(!JSON.stringify(sharePayload).includes(sentinel), "share payload should not include local session notes");

  const deleted = await fetchJson(`${viewerUrl}/api/session-notes`, {
    method: "POST",
    headers: mutationHeaders(origin, csrfToken),
    body: JSON.stringify({ id: noteRef, text: "  \n  " }),
  });
  assert(deleted.ok === true && deleted.deleted === true, `empty note text should delete: ${JSON.stringify(deleted)}`);

  const afterDelete = await fetchJson(`${viewerUrl}/api/session-notes?id=${encodeURIComponent(noteRef)}`);
  assert(Object.keys(afterDelete).length === 0, "deleted note should return empty object");

  for (let index = 0; index < 501; index += 1) {
    const capRef = `codex:desktop-note-cap-${String(index).padStart(3, "0")}`;
    const result = await fetchJson(`${viewerUrl}/api/session-notes`, {
      method: "POST",
      headers: mutationHeaders(origin, csrfToken),
      body: JSON.stringify({ id: capRef, text: `cap note ${index}` }),
    });
    assert(result.ok === true, `cap note write should succeed for ${capRef}: ${JSON.stringify(result)}`);
  }

  const afterCap = await fetchJson(`${viewerUrl}/api/launcher-prefs`);
  assert(afterCap.noteRefs.length === 500, `noteRefs should be capped at 500, got ${afterCap.noteRefs.length}`);
  assert(!afterCap.noteRefs.includes("codex:desktop-note-cap-000"), "oldest note should be dropped after cap");
  assert(afterCap.noteRefs.includes("codex:desktop-note-cap-500"), "newest note should remain after cap");
}

async function assertRevealInFile(viewerUrl, origin, csrfToken) {
  const withoutCsrf = await fetch(`${viewerUrl}/api/reveal-in-file?path=${encodeURIComponent("relative/path.txt")}`, {
    method: "POST",
    headers: { origin },
    signal: AbortSignal.timeout(2000),
  });
  assert([400, 403].includes(withoutCsrf.status), `reveal without CSRF should be rejected, got ${withoutCsrf.status}`);

  const relative = await fetch(`${viewerUrl}/api/reveal-in-file?path=${encodeURIComponent("relative/path.txt")}`, {
    method: "POST",
    headers: {
      [CSRF_HEADER]: csrfToken,
      origin,
    },
    signal: AbortSignal.timeout(2000),
  });
  assert(relative.status === 400, `reveal with relative path should return 400, got ${relative.status}`);

  const missingPath = path.join(tempDir, "does-not-exist", "missing.txt");
  const missing = await fetch(`${viewerUrl}/api/reveal-in-file?path=${encodeURIComponent(missingPath)}`, {
    method: "POST",
    headers: {
      [CSRF_HEADER]: csrfToken,
      origin,
    },
    signal: AbortSignal.timeout(2000),
  });
  assert(missing.status === 404, `reveal with nonexistent absolute path should return 404, got ${missing.status}`);
}

async function assertBadOriginRejected(viewerUrl, csrfToken) {
  const response = await fetch(`${viewerUrl}/api/launcher-prefs/pin`, {
    method: "POST",
    headers: {
      [CSRF_HEADER]: csrfToken,
      "content-type": "application/json",
      origin: "http://evil.example",
    },
    body: JSON.stringify({ ref: "codex:evil-origin", engine: "codex", pinned: true }),
    signal: AbortSignal.timeout(2000),
  });
  assert(response.status === 403, `evil Origin POST should return 403, got ${response.status}`);
}

async function assertColdSessionCacheLiveOnly(cacheDir) {
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cacheDir;
  try {
    const moduleUrl = pathToFileURL(path.join(ROOT_DIR, "dist/server/session-list-cache.mjs")).href + `?cold-live=${Date.now()}`;
    const { listSessionsWithCache } = await import(moduleUrl);
    const rows = await listSessionsWithCache({
      listSessions: async () => [
        {
          engine: "claude",
          ref: "claude:history-only",
          id: "history-only",
          title: "History only",
          sourceKind: "history",
          historyOnly: true,
          complete: false,
          messageCount: 1,
          mtime: "2026-06-01T00:00:00.000Z",
        },
        {
          engine: "claude",
          ref: "claude:live-transcript",
          id: "live-transcript",
          title: "Live transcript",
          sourceKind: "transcript",
          complete: false,
          messageCount: 1,
          mtime: "2026-06-01T00:00:01.000Z",
        },
        {
          engine: "trae",
          ref: "trae:input-history",
          id: "input-history",
          title: "Input history",
          sourceKind: "input-history",
          complete: false,
          messageCount: 1,
          mtime: "2026-06-01T00:00:02.000Z",
        },
      ],
      codexHome: path.join(cacheDir, "codex"),
      claudeHome: path.join(cacheDir, "claude"),
      traeHome: path.join(cacheDir, "trae"),
      traeAppHome: path.join(cacheDir, "trae-app"),
      traeRecordingsDir: path.join(cacheDir, "trae-recordings"),
      source: "all",
      limit: 20,
      offset: 0,
      completeOnly: false,
      liveOnly: true,
    });
    const refs = rows.map((row) => row.ref);
    assert(JSON.stringify(refs) === JSON.stringify(["claude:live-transcript"]), `cold liveOnly returned wrong rows: ${JSON.stringify(rows)}`);
  } finally {
    if (previousXdgCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = previousXdgCacheHome;
    }
  }
}

async function assertClaudeQuotaBlockBoundary(claudeHome) {
  const sessionDir = path.join(claudeHome, "projects", "-tmp-quota-boundary");
  await mkdir(sessionDir, { recursive: true });
  const now = Date.now();
  const firstTime = now - (5 * 60 * 60 * 1000) - (30 * 60 * 1000);
  const boundaryTime = firstTime + (5 * 60 * 60 * 1000);
  const sessionPath = path.join(sessionDir, "boundary.jsonl");
  const rows = [
    claudeAssistantUsageRow("msg-before-boundary", firstTime, { input_tokens: 1, output_tokens: 2 }),
    claudeAssistantUsageRow("msg-at-boundary", boundaryTime, {
      input_tokens: 10,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 4,
      output_tokens: 5,
    }),
  ];
  await writeFile(sessionPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");

  const moduleUrl = pathToFileURL(path.join(ROOT_DIR, "dist/server/quota-meter.mjs")).href + `?claude-boundary=${Date.now()}`;
  const { readClaudeBlockUsageEstimate } = await import(moduleUrl);
  const estimate = await readClaudeBlockUsageEstimate({ claudeHome });
  assert(estimate.active === true, `Claude block should be active: ${JSON.stringify(estimate)}`);
  assert(new Date(estimate.blockStart).getTime() === boundaryTime, "boundary event should start the active block");
  assert(estimate.messages === 1, "active block should only count the boundary event");
  assert(JSON.stringify(estimate.tokens) === JSON.stringify({ input: 10, output: 5, cacheCreation: 4, cacheRead: 3 }), `active block tokens were wrong: ${JSON.stringify(estimate.tokens)}`);
}

async function writeCodexFixture(codexHome, options = {}) {
  const sessionDate = options.sessionDate || "2026-06-01";
  const [year, month, day] = sessionDate.split("-");
  const startedAt = options.startedAt || "2026-06-01T00:00:00.000Z";
  const sessionDir = path.join(codexHome, "sessions", year, month, day);
  await mkdir(sessionDir, { recursive: true });
  const sessionPath = path.join(sessionDir, `rollout-${sessionDate}T00-00-00-${SESSION_ID}.jsonl`);
  const rows = [
    {
      type: "session_meta",
      timestamp: startedAt,
      payload: {
        id: SESSION_ID,
        cwd: path.join(codexHome, "fixture-project"),
        timestamp: startedAt,
        model: "gpt-5",
        model_provider: "openai",
        originator: "codex",
      },
    },
    {
      type: "response_item",
      timestamp: "2026-06-01T00:00:01.000Z",
      payload: {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: options.firstUserText || "Inspect this desktop API fixture image." },
          { type: "input_image", image_url: PNG_DATA_URL, detail: "low" },
        ],
      },
    },
    {
      type: "response_item",
      timestamp: "2026-06-01T00:00:01.500Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `Use this API key only in tests: ${PEEK_SECRET}` }],
      },
    },
    {
      type: "response_item",
      timestamp: "2026-06-01T00:00:01.750Z",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: LONG_EMOJI_TEXT }],
      },
    },
    {
      type: "response_item",
      timestamp: "2026-06-01T00:00:02.000Z",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: options.assistantText || "The image fixture is available." }],
      },
    },
    {
      type: "event_msg",
      timestamp: "2026-06-01T00:00:03.000Z",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 120,
            cached_input_tokens: 20,
            output_tokens: 30,
            reasoning_output_tokens: 5,
            total_tokens: 150,
          },
          rate_limits: {
            updated_at: "2026-06-01T00:00:03.000Z",
            plan_type: "test",
            primary: {
              used_percent: 12.5,
              resets_at: "2026-06-01T04:00:00.000Z",
              window_minutes: 240,
            },
            secondary: {
              used_percent: 3,
              resets_at: "2026-06-01T00:15:00.000Z",
              window_minutes: 15,
            },
          },
        },
      },
    },
  ];
  await writeFile(sessionPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

function claudeAssistantUsageRow(messageId, timestampMs, usage) {
  return {
    type: "assistant",
    requestId: `req-${messageId}`,
    timestamp: new Date(timestampMs).toISOString(),
    message: {
      id: messageId,
      role: "assistant",
      model: "claude-sonnet-4",
      content: [{ type: "text", text: "ok" }],
      usage,
    },
  };
}

function encodeImageId({ sessionRef, turnIndex, imageIndex }) {
  return Buffer.from(JSON.stringify({ v: 1, r: sessionRef, t: turnIndex, i: imageIndex }), "utf8").toString("base64url");
}

function assertQuotaWindow(value, label) {
  if (value === null) {
    return;
  }
  assert(value && typeof value === "object", `${label} quota window should be an object when present`);
  assert(typeof value.usedPercent === "number" && Number.isFinite(value.usedPercent), `${label}.usedPercent should be a number`);
  assert(typeof value.resetsAt === "string", `${label}.resetsAt should be a string`);
  assert(typeof value.windowMinutes === "number" && Number.isFinite(value.windowMinutes), `${label}.windowMinutes should be a number`);
}

function assertEngineCounts(value, label) {
  assert(value && typeof value === "object", `${label} should be an object`);
  for (const key of ["total", "codex", "claude", "trae"]) {
    assert(typeof value[key] === "number" && Number.isFinite(value[key]), `${label}.${key} should be a number`);
  }
}

function assertTokenCounts(value, label) {
  assert(value && typeof value === "object", `${label} should be an object`);
  for (const key of ["total", "input", "output", "indexedSessions"]) {
    assert(typeof value[key] === "number" && Number.isFinite(value[key]), `${label}.${key} should be a number`);
  }
}

function mutationHeaders(origin, csrfToken) {
  return {
    [CSRF_HEADER]: csrfToken,
    "content-type": "application/json",
    origin,
  };
}

async function waitForJson(url, output, childProcess) {
  const deadline = Date.now() + 7000;
  let lastError;

  while (Date.now() < deadline) {
    if (childProcess?.exitCode !== null) {
      throw new Error(`local viewer exited early with code ${childProcess.exitCode}\n${output.text()}`);
    }

    try {
      await fetchJson(url, { timeoutMs: 500 });
      return;
    } catch (error) {
      lastError = error;
    }

    await sleep(120);
  }

  throw new Error(`local viewer did not become ready: ${lastError?.message || "timeout"}\n${output.text()}`);
}

async function fetchJson(url, options = {}) {
  const { response, payload, text } = await fetchJsonResponse(url, options);
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${payload?.error || text}`);
  }
  return payload;
}

async function fetchJsonResponse(url, options = {}) {
  const { timeoutMs = 2000, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, got ${text.slice(0, 200)}`);
  }

  return { response, payload, text };
}

async function fetchText(url, options = {}) {
  const { timeoutMs = 2000, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

function extractCsrfToken(html) {
  const match = html.match(/AGENT_SNAPSHOT_CSRF_TOKEN=("(?:\\.|[^"])*")/) || html.match(/window\.CSRF=("(?:\\.|[^"])*")/);
  assert(match, "viewer HTML should expose a JSON-encoded CSRF token");
  const token = JSON.parse(match[1]);
  assert(typeof token === "string" && token.length >= 32, "CSRF token should be a strong string");
  return token;
}

function assertValidIso(value, label) {
  assert(typeof value === "string" && Number.isFinite(new Date(value).getTime()), `${label} should be an ISO date string`);
}

function collectChildOutput(child) {
  const chunks = { stdout: "", stderr: "" };
  child?.stdout?.setEncoding("utf8");
  child?.stderr?.setEncoding("utf8");
  child?.stdout?.on("data", (chunk) => {
    chunks.stdout += chunk;
  });
  child?.stderr?.on("data", (chunk) => {
    chunks.stderr += chunk;
  });

  return {
    text() {
      return [chunks.stdout, chunks.stderr].filter(Boolean).join("\n");
    },
  };
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Could not allocate a local test port"));
        }
      });
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(1500).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
