#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const parsed = parseArgs(process.argv.slice(2));
const host = parsed.host || "127.0.0.1";
const port = Number(parsed.port || 4323);

if (parsed.help) {
  printHelp();
  process.exit(0);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
    const filePath = await resolveFile(url.pathname);
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end("not found");
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolve);
});

console.log(`Codex Snapshots website is running at http://${host}:${port}`);

async function resolveFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const requested = path.join(root, normalized);
  const safePath = requested.startsWith(root) ? requested : root;
  const info = await stat(safePath);

  if (info.isDirectory()) {
    return path.join(safePath, "index.html");
  }

  return safePath;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function parseArgs(args) {
  const options = {
    help: false,
    host: "",
    port: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--host") {
      options.host = String(args[++index] || "");
      continue;
    }
    if (arg === "--port" || arg === "-p") {
      options.port = String(args[++index] || "");
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`codex-snapshots site server

Usage:
  node scripts/serve-site.mjs [--host 127.0.0.1] [--port 4323]
`);
}
