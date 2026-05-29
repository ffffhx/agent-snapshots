#!/usr/bin/env node

import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT_DIR, "site");
const ASSETS_DIR = path.join(OUT_DIR, "assets");

const entries = [
  {
    entry: path.join(ROOT_DIR, "src/site/main.tsx"),
    fileName: "site",
    globalName: "CodexSnapshotsSite",
  },
  {
    entry: path.join(ROOT_DIR, "src/site/share.tsx"),
    fileName: "share",
    globalName: "CodexSnapshotsShare",
  },
];

await Promise.all([
  rm(path.join(ASSETS_DIR, "site.js"), { force: true }),
  rm(path.join(ASSETS_DIR, "share.js"), { force: true }),
  rm(path.join(ASSETS_DIR, "site.css"), { force: true }),
]);

for (const item of entries) {
  await build({
    root: ROOT_DIR,
    configFile: false,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    publicDir: false,
    logLevel: "warn",
    plugins: [react(), tailwindcss()],
    build: {
      emptyOutDir: false,
      minify: true,
      outDir: OUT_DIR,
      sourcemap: false,
      target: "es2022",
      lib: {
        entry: item.entry,
        formats: ["iife"],
        name: item.globalName,
        fileName: () => `assets/${item.fileName}.js`,
        cssFileName: "assets/site",
      },
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith(".css")) {
              return "assets/site.css";
            }
            return "assets/[name][extname]";
          },
          extend: true,
        },
      },
    },
  });
}

console.log("Built React/Tailwind static site assets in site/assets");
