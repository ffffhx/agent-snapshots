#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const parsed = parseArgs(process.argv.slice(2));

if (parsed.help) {
  printHelp();
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const apiUrl = normalizePublicApiUrl(
    parsed.options.apiUrl ||
      process.env.AGENT_SNAPSHOTS_PUBLIC_API_URL ||
      process.env.CODEX_SNAPSHOTS_PUBLIC_API_URL ||
      process.env.SNAPSHOT_SHARE_PUBLIC_API_URL ||
      process.env.SNAPSHOT_SHARE_API_URL ||
      "",
    { allowLocal: parsed.options.allowLocal }
  );
  const outputPath = path.resolve(parsed.options.output || "site/assets/config.js");

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `window.AGENT_SNAPSHOTS_CONFIG = ${inlineJson({ apiUrl })};\n`,
    "utf8"
  );

  console.log(`Wrote ${outputPath}`);
  console.log(`Public share API: ${apiUrl || "(not configured)"}`);
}

function normalizePublicApiUrl(value, { allowLocal }) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) {
    return "";
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`AGENT_SNAPSHOTS_PUBLIC_API_URL must be a valid URL: ${text}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`AGENT_SNAPSHOTS_PUBLIC_API_URL must start with http:// or https://: ${text}`);
  }

  if (!allowLocal && !isPublicHost(url.hostname)) {
    throw new Error(`AGENT_SNAPSHOTS_PUBLIC_API_URL must be a public API host, got ${text}`);
  }

  return url.toString().replace(/\/+$/, "");
}

function isPublicHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "[::1]") {
    return false;
  }
  if (host === "example.com" || host.endsWith(".example.com") || host === "snapshots.example.com") {
    return false;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    return !isPrivateIpv4(host);
  }
  if (ipVersion === 6) {
    return !isPrivateIpv6(host);
  }

  return true;
}

function isPrivateIpv4(host) {
  const parts = host.split(".").map((part) => Number(part));
  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(host) {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function inlineJson(value) {
  return JSON.stringify(value, null, 2).replace(/[<>&\u2028\u2029]/g, (char) => {
    if (char === "<") return "\\u003c";
    if (char === ">") return "\\u003e";
    if (char === "&") return "\\u0026";
    if (char === "\u2028") return "\\u2028";
    return "\\u2029";
  });
}

function parseArgs(args) {
  const options = {
    allowLocal: false,
    apiUrl: "",
    output: "",
  };
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--allow-local") {
      options.allowLocal = true;
      continue;
    }
    if (arg === "--api-url") {
      options.apiUrl = String(args[++index] || "");
      continue;
    }
    if (arg === "--output") {
      options.output = String(args[++index] || "");
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  return { help, options };
}

function printHelp() {
  console.log(`write-site-config

Usage:
  node scripts/write-site-config.mjs --api-url https://snapshots.example.com --output site/assets/config.js

Environment:
  AGENT_SNAPSHOTS_PUBLIC_API_URL  Public share API URL used by GitHub Pages.

Options:
  --api-url URL    Public share API URL. Defaults to AGENT_SNAPSHOTS_PUBLIC_API_URL.
  --output FILE    Config file to write. Defaults to site/assets/config.js.
  --allow-local    Allow localhost/private API URLs for local development only.
  -h, --help       Show help.
`);
}
