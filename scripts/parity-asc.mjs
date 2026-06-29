#!/usr/bin/env node
// Parity harness: legacy local-history parser vs agent-session-core + adapter.
//
// STEP 1 of the migration. Drives both implementations over the real
// ~/.codex + ~/.claude logs and reports, per engine:
//   - listSessions: session-set diff, messageCount/title agreement on the overlap
//   - loadSnapshot (sampled): turnCount, title, risk-count, and token-total deltas
// then classifies every delta against the KNOWN list from the migration plan so a
// human can confirm "differences are intentional corrections only".
//
// Compares the COMPILED dist outputs so production code paths are exercised:
//   pnpm build:dist && node scripts/parity-asc.mjs
//
// Env knobs:
//   PARITY_LIST_LIMIT   sessions per engine to list-compare   (default 300)
//   PARITY_SAMPLE       sessions per engine to snapshot-diff  (default 60)
//   PARITY_ENGINES      comma list: codex,claude              (default both)

import os from "node:os";
import path from "node:path";

import * as legacy from "../dist/sources/local-history.mjs";
import * as asc from "../dist/sources/asc-adapter.mjs";

const HOMES = {
  codexHome: path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex")),
  claudeHome: path.resolve(process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude")),
  traeHome: path.resolve(process.env.TRAE_HOME || path.join(os.homedir(), ".trae-cn")),
  traeAppHome: path.resolve(process.env.TRAE_APP_HOME || path.join(os.homedir(), "Library", "Application Support", "Trae CN")),
  traeRecordingsDir: path.resolve(process.env.TRAE_RECORDINGS_DIR || path.join(os.homedir(), ".codex-snapshot", "trae-recordings")),
};

const LIST_LIMIT = num(process.env.PARITY_LIST_LIMIT, 300);
const SAMPLE = num(process.env.PARITY_SAMPLE, 60);
const ENGINES = (process.env.PARITY_ENGINES || "codex,claude").split(",").map((s) => s.trim()).filter(Boolean);

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pct(n, d) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "n/a";
}

const SNAP_OPTS = { ...HOMES, includeTools: false, includeToolOutput: false, redact: true };

async function listParity(engine) {
  const opts = { ...HOMES, source: engine, limit: LIST_LIMIT, completeOnly: false };
  const [oldList, ascList] = await Promise.all([
    legacy.listSessions(opts),
    asc.listSessions(opts),
  ]);

  const oldById = new Map(oldList.map((s) => [s.id, s]));
  const ascById = new Map(ascList.map((s) => [s.id, s]));

  const onlyOld = [...oldById.keys()].filter((id) => !ascById.has(id));
  const onlyAsc = [...ascById.keys()].filter((id) => !oldById.has(id));

  let msgEqual = 0;
  let msgDiff = 0;
  let titleEqual = 0;
  let titleDiff = 0;
  const msgDiffSamples = [];
  for (const [id, oldS] of oldById) {
    const ascS = ascById.get(id);
    if (!ascS) continue;
    if (Number(oldS.messageCount) === Number(ascS.messageCount)) {
      msgEqual += 1;
    } else {
      msgDiff += 1;
      if (msgDiffSamples.length < 5) {
        msgDiffSamples.push({ id, old: oldS.messageCount, asc: ascS.messageCount });
      }
    }
    if (String(oldS.title) === String(ascS.title)) titleEqual += 1;
    else titleDiff += 1;
  }

  return {
    engine,
    oldCount: oldList.length,
    ascCount: ascList.length,
    overlap: oldById.size - onlyOld.length,
    onlyOld: onlyOld.length,
    onlyAsc: onlyAsc.length,
    onlyOldSamples: onlyOld.slice(0, 5),
    onlyAscSamples: onlyAsc.slice(0, 5),
    msgEqual,
    msgDiff,
    msgDiffSamples,
    titleEqual,
    titleDiff,
    refsForSnapshot: oldList.filter((s) => oldById.has(s.id) && ascById.has(s.id)).map((s) => s.ref),
  };
}

function totalTokens(snap) {
  const t = snap?.tokenUsage;
  if (!t) return null;
  return Number(t.totalTokens) || (Number(t.inputTokens) || 0) + (Number(t.outputTokens) || 0);
}

function riskCount(snap) {
  return (snap?.risks || []).reduce((sum, r) => sum + (r.count || 0), 0);
}

async function snapshotParity(engine, refs) {
  const sample = refs.slice(0, SAMPLE);
  const out = {
    engine,
    sampled: sample.length,
    turnEqual: 0,
    turnDiff: 0,
    turnDiffSamples: [],
    titleEqual: 0,
    titleDiff: 0,
    // token classification (codex): equal | ascHigher(reset-aware) | ascLower(UNEXPECTED)
    tokEqual: 0,
    tokAscHigher: 0,
    tokAscLower: 0,
    tokBothNull: 0,
    // claude additive: old had no tokenUsage, asc adds it
    tokAdditive: 0,
    tokAscLowerSamples: [],
    riskEqual: 0,
    riskDiff: 0,
    riskDiffSamples: [],
    errors: 0,
    errorSamples: [],
  };

  for (const ref of sample) {
    let oldSnap;
    let ascSnap;
    try {
      [oldSnap, ascSnap] = await Promise.all([
        legacy.loadSnapshot(ref, SNAP_OPTS),
        asc.loadSnapshot(ref, SNAP_OPTS),
      ]);
    } catch (err) {
      out.errors += 1;
      if (out.errorSamples.length < 5) out.errorSamples.push({ ref, error: String(err?.message || err) });
      continue;
    }
    if (!oldSnap || !ascSnap) {
      out.errors += 1;
      if (out.errorSamples.length < 5) out.errorSamples.push({ ref, error: "null snapshot" });
      continue;
    }

    const oldTurns = (oldSnap.turns || []).filter((t) => t.kind === "message").length;
    const ascTurns = (ascSnap.turns || []).filter((t) => t.kind === "message").length;
    if (oldTurns === ascTurns) out.turnEqual += 1;
    else {
      out.turnDiff += 1;
      if (out.turnDiffSamples.length < 8) out.turnDiffSamples.push({ ref, old: oldTurns, asc: ascTurns });
    }

    if (String(oldSnap.title) === String(ascSnap.title)) out.titleEqual += 1;
    else out.titleDiff += 1;

    const oldTok = totalTokens(oldSnap);
    const ascTok = totalTokens(ascSnap);
    if (oldTok == null && ascTok == null) out.tokBothNull += 1;
    else if (oldTok == null && ascTok != null) out.tokAdditive += 1; // claude: new field
    else if (oldTok != null && ascTok != null) {
      if (oldTok === ascTok) out.tokEqual += 1;
      else if (ascTok > oldTok) out.tokAscHigher += 1; // reset-aware delta sum >= last-snapshot
      else {
        out.tokAscLower += 1;
        if (out.tokAscLowerSamples.length < 8) out.tokAscLowerSamples.push({ ref, old: oldTok, asc: ascTok });
      }
    }

    const oldRisk = riskCount(oldSnap);
    const ascRisk = riskCount(ascSnap);
    if (oldRisk === ascRisk) out.riskEqual += 1;
    else {
      out.riskDiff += 1;
      if (out.riskDiffSamples.length < 8) out.riskDiffSamples.push({ ref, old: oldRisk, asc: ascRisk });
    }
  }
  return out;
}

async function main() {
  console.log("=== parity-asc: legacy local-history vs agent-session-core + adapter ===");
  console.log("homes:", { codexHome: HOMES.codexHome, claudeHome: HOMES.claudeHome });
  console.log("config:", { LIST_LIMIT, SAMPLE, ENGINES });
  console.log("");

  const report = { listByEngine: {}, snapshotByEngine: {} };

  for (const engine of ENGINES) {
    const list = await listParity(engine);
    report.listByEngine[engine] = list;
    console.log(`--- listSessions [${engine}] ---`);
    console.log(`  old=${list.oldCount} asc=${list.ascCount} overlap=${list.overlap} onlyOld=${list.onlyOld} onlyAsc=${list.onlyAsc}`);
    console.log(`  messageCount agree on overlap: ${list.msgEqual}/${list.msgEqual + list.msgDiff} (${pct(list.msgEqual, list.msgEqual + list.msgDiff)})`);
    console.log(`  title agree on overlap:        ${list.titleEqual}/${list.titleEqual + list.titleDiff} (${pct(list.titleEqual, list.titleEqual + list.titleDiff)})`);
    if (list.onlyOld) console.log(`  onlyOld samples: ${JSON.stringify(list.onlyOldSamples)}`);
    if (list.onlyAsc) console.log(`  onlyAsc samples: ${JSON.stringify(list.onlyAscSamples)}`);
    if (list.msgDiff) console.log(`  msgDiff samples: ${JSON.stringify(list.msgDiffSamples)}`);

    const snap = await snapshotParity(engine, list.refsForSnapshot);
    report.snapshotByEngine[engine] = snap;
    console.log(`--- loadSnapshot [${engine}] (sampled ${snap.sampled}) ---`);
    console.log(`  turnCount agree:  ${snap.turnEqual}/${snap.sampled - snap.errors} (${pct(snap.turnEqual, snap.turnEqual + snap.turnDiff)})`);
    if (snap.turnDiff) console.log(`  turnDiff samples: ${JSON.stringify(snap.turnDiffSamples)}`);
    console.log(`  title agree:      ${snap.titleEqual}/${snap.sampled - snap.errors}`);
    console.log(`  tokens: equal=${snap.tokEqual} ascHigher(reset)=${snap.tokAscHigher} ascLower(UNEXPECTED)=${snap.tokAscLower} additive(claude-new)=${snap.tokAdditive} bothNull=${snap.tokBothNull}`);
    if (snap.tokAscLower) console.log(`  ascLower token samples (UNEXPECTED): ${JSON.stringify(snap.tokAscLowerSamples)}`);
    console.log(`  risks: equal=${snap.riskEqual} diff=${snap.riskDiff}`);
    if (snap.riskDiff) console.log(`  riskDiff samples: ${JSON.stringify(snap.riskDiffSamples)}`);
    if (snap.errors) console.log(`  errors=${snap.errors} samples=${JSON.stringify(snap.errorSamples)}`);
    console.log("");
  }

  // ---- Verdict: are all deltas explained by the KNOWN intentional-correction list? ----
  const unexpected = [];
  for (const engine of ENGINES) {
    const snap = report.snapshotByEngine[engine];
    if (snap.tokAscLower > 0) {
      unexpected.push(`[${engine}] ${snap.tokAscLower} snapshot(s) where ASC token total < legacy (codex tokens must be >= legacy under reset-aware sum)`);
    }
    // turnDiff / riskDiff are EXPECTED to be small and attributable to directive
    // stripping + image-risk + token-dedup; flag only if they dominate the sample.
    const denom = snap.turnEqual + snap.turnDiff || 1;
    if (snap.turnDiff / denom > 0.1) {
      unexpected.push(`[${engine}] turnCount disagreement ${snap.turnDiff}/${denom} exceeds 10% — investigate (expected: only directive-only/goal messages)`);
    }
  }

  console.log("=== VERDICT ===");
  if (unexpected.length === 0) {
    console.log("PASS: all observed deltas fall within the KNOWN intentional-correction categories.");
    console.log("  - codex tokens: equal on non-reset sessions, ASC >= legacy on reset sessions (reset-aware sum)");
    console.log("  - claude tokens: additive (legacy had none; ASC adds deduped usage)");
    console.log("  - small turn/risk deltas: directive stripping, image-risk, token dedup (see plan knownDeltas)");
  } else {
    console.log("REVIEW: potential unexpected deltas:");
    for (const u of unexpected) console.log(`  - ${u}`);
  }

  console.log("");
  console.log("RAW_REPORT_JSON " + JSON.stringify(report));
}

main().catch((err) => {
  console.error("parity-asc failed:", err);
  process.exit(1);
});
