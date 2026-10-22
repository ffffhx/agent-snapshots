#!/usr/bin/env node

import { chmod, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

await cp(new URL("../src/server/hanlp/", import.meta.url), new URL("../dist/server/hanlp/", import.meta.url), { recursive: true, filter: (source) => !source.includes("__pycache__") });

if (process.platform !== "win32") {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await Promise.all([
    "dist/cli/agent-snapshot.mjs",
    "dist/server/share-api.mjs",
  ].map((relativePath) => chmod(path.join(rootDir, relativePath), 0o755)));
}
