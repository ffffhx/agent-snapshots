#!/usr/bin/env node
// Unit tests for the redaction engine (dist/core/privacy.mjs). These lock in the
// secret shapes that previously leaked: spaced/short/quoted values, multiple
// secrets per line, prefixed tokens, connection strings, and the detect/redact
// drift where internal hosts were flagged but never scrubbed.

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { redactText, detectRisks } = await import(path.join(ROOT_DIR, "dist/core/privacy.js"));

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const REDACTED = "[REDACTED]";

// --- Value shapes that used to leak (M2) -----------------------------------

test("redacts a passphrase value containing spaces", () => {
  const out = redactText("password: correct horse battery staple");
  assert.ok(!out.includes("correct horse battery staple"), out);
});

test("redacts a short (<8 char) value", () => {
  const out = redactText("password=hunter2");
  assert.ok(!out.includes("hunter2"), out);
});

test("redacts every secret on a cookie line, not just the first", () => {
  const out = redactText("cookie: session=abc; csrf=xyz");
  assert.ok(!out.includes("xyz"), out);
  assert.ok(!out.includes("abc"), out);
});

test("redacts a quoted JSON value fully", () => {
  const out = redactText('{"password":"abc def"}');
  assert.ok(!out.includes("abc def"), out);
  assert.ok(!out.includes("def"), out);
});

// --- Key names / prefixed tokens that used to slip through (M3) -------------

test("redacts underscore-containing key names", () => {
  for (const line of ["client_secret: superlongsecretvalue", "db_password = anothersecret123", "aws_secret_access_key: wJalrXUtnFEMIabcdEXAMPLEKEY"]) {
    const out = redactText(line);
    assert.ok(out.includes(REDACTED), `not redacted: ${line} -> ${out}`);
    assert.ok(!/superlongsecretvalue|anothersecret123|wJalrXUtnFEMIabcdEXAMPLEKEY/.test(out), out);
  }
});

test("redacts prefixed token formats", () => {
  const cases = [
    "ghp_0123456789abcdef0123456789abcdefABCD",
    "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
    "xoxb-1234567890-abcdefghijkl",
    "AIza" + "B".repeat(35),
  ];
  for (const token of cases) {
    const out = redactText(`here is a token ${token} ok`);
    assert.ok(!out.includes(token), `leaked: ${token} -> ${out}`);
  }
});

test("redacts credentials embedded in a connection string", () => {
  const out = redactText("postgres://admin:s3cr3tpw@db.internal:5432/app");
  assert.ok(!out.includes("s3cr3tpw"), out);
  assert.ok(!out.includes("admin"), out);
});

// --- Private key without END marker (M10) ----------------------------------

test("redacts a private key block even without an END marker", () => {
  const out = redactText("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAtruncatedkeymaterial");
  assert.ok(out.includes("[REDACTED_PRIVATE_KEY]"), out);
  assert.ok(!out.includes("truncatedkeymaterial"), out);
});

// --- detect/redact parity (M5) ---------------------------------------------

test("internal-looking hosts are both detected AND redacted", () => {
  const risks = detectRisks("ping host.bytedance.com now");
  assert.ok(risks.some((r) => r.id === "internal-domain"), "should detect internal-domain");
  const out = redactText("ping host.bytedance.com now");
  assert.ok(!out.includes("host.bytedance.com"), out);
});

test("an .env mention is flagged but intentionally not scrubbed", () => {
  const risks = detectRisks("see .env.production for config");
  assert.ok(risks.some((r) => r.id === "env-file"), "should detect env-file");
  const out = redactText("see .env.production for config");
  assert.ok(out.includes(".env.production"), "env filename mention is detect-only");
});

// --- detection sees the high-severity secrets so the publish re-scan works ---

test("detectRisks flags high-severity secrets used by the publish gate", () => {
  for (const [text, id] of [
    ["password: hunter2", "api-key"],
    ["ghp_0123456789abcdef0123456789abcdefABCD", "github-token"],
    ["sk-0123456789abcdefghijABCDE", "openai-key"],
    ["AKIAIOSFODNN7EXAMPLE", "aws-key"],
  ]) {
    const risks = detectRisks(text);
    const hit = risks.find((r) => r.id === id);
    assert.ok(hit, `expected ${id} for: ${text}`);
    assert.equal(hit.severity, "high", `${id} should be high severity`);
  }
});

// --- the user's own home path still collapses to ~ --------------------------

test("the local home path collapses to ~", () => {
  const home = os.homedir();
  const out = redactText(`file at ${home}/secret.txt`);
  assert.ok(out.includes("~/secret.txt"), out);
  assert.ok(!out.includes(home), out);
});

test("other machines' home paths drop the username", () => {
  const out = redactText("on the box: /home/alice/.ssh/config and /Users/bob/work");
  assert.ok(!out.includes("alice"), out);
  assert.ok(!out.includes("bob"), out);
});

// --- Runner -----------------------------------------------------------------

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error instanceof Error ? error.message : error}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) {
  process.exit(1);
}
