#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-snapshots-site-config-test-"));

try {
  await assertWritesEmptyConfigWhenUnset();
  await assertWritesNormalizedPublicApi();
  await assertRejectsUnsafePublicApis();
  await assertAllowLocalForLocalDevelopment();

  console.log("✓ site config generation checks passed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function assertWritesEmptyConfigWhenUnset() {
  const output = path.join(tempDir, "empty-config.js");
  await runConfig(["--output", output], {});
  const text = await readFile(output, "utf8");
  assert(text.includes('"apiUrl": ""'), "empty config should write an empty apiUrl");
}

async function assertWritesNormalizedPublicApi() {
  const output = path.join(tempDir, "public-config.js");
  await runConfig(["--output", output, "--api-url", "https://snapshots.mycompany.dev///"], {});
  const text = await readFile(output, "utf8");
  assert(text.includes('"apiUrl": "https://snapshots.mycompany.dev"'), "public config should normalize trailing slashes");
}

async function assertRejectsUnsafePublicApis() {
  const unsafeUrls = [
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "https://snapshots.example.com",
    "https://192.168.1.5",
    "ftp://snapshots.mycompany.dev",
  ];

  for (const unsafeUrl of unsafeUrls) {
    const output = path.join(tempDir, `unsafe-${unsafeUrls.indexOf(unsafeUrl)}.js`);
    const result = await runConfig(["--output", output, "--api-url", unsafeUrl], {}, { expectFailure: true });
    assert(result.stderr.includes("AGENT_SNAPSHOTS_PUBLIC_API_URL"), `unsafe URL should fail with config error: ${unsafeUrl}`);
  }
}

async function assertAllowLocalForLocalDevelopment() {
  const output = path.join(tempDir, "local-config.js");
  await runConfig(["--output", output, "--api-url", "http://127.0.0.1:8787", "--allow-local"], {});
  const text = await readFile(output, "utf8");
  assert(text.includes('"apiUrl": "http://127.0.0.1:8787"'), "allow-local should permit local API config");
}

async function runConfig(args, env, { expectFailure = false } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/write-site-config.mjs", ...args], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        AGENT_SNAPSHOTS_PUBLIC_API_URL: "",
        SNAPSHOT_SHARE_PUBLIC_API_URL: "",
        SNAPSHOT_SHARE_API_URL: "",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      const result = { code, stdout, stderr };
      if (expectFailure ? code !== 0 : code === 0) {
        resolve(result);
        return;
      }
      reject(new Error(`write-site-config ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
