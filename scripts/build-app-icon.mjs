#!/usr/bin/env node
// Generate the desktop app icons (build/icon.png + build/icon.icns) from the
// Codex Snapshots logo SVG. Uses macOS-native tooling (qlmanage/sips/iconutil)
// to rasterize; on other platforms it produces the PNG only when a rasterizer
// is available and skips the .icns step.

import { execFile } from "node:child_process";
import { mkdir, writeFile, rm, copyFile, access } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, "build");

// Kept in sync with SNAPSHOT_LOGO_SVG in src/cli/codex-snapshot.mts.
// A solid background is added so the icon fills its rounded macOS mask.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#231d12"/><circle cx="32" cy="32" r="20" fill="none" stroke="#4f4533" stroke-width="1.6"/><g transform="translate(32,32)"><path d="M -12.71 -14.12 A 19 19 0 0 1 12.71 -14.12 L 5.48 -2.44 A 6 6 0 0 0 -1.85 -5.71 Z" fill="#c9bd9f"/><path d="M 5.87 -18.07 A 19 19 0 0 1 18.58 3.95 L 4.85 3.53 A 6 6 0 0 0 4.01 -4.46 Z" fill="#e7dcc4"/><path d="M 18.58 -3.95 A 19 19 0 0 1 5.87 18.07 L -0.63 5.97 A 6 6 0 0 0 5.87 1.25 Z" fill="#c9bd9f"/><path d="M 12.71 14.12 A 19 19 0 0 1 -12.71 14.12 L -5.48 2.44 A 6 6 0 0 0 1.85 5.71 Z" fill="#e7dcc4"/><path d="M -5.87 18.07 A 19 19 0 0 1 -18.58 -3.95 L -4.85 -3.53 A 6 6 0 0 0 -4.01 4.46 Z" fill="#c9bd9f"/><path d="M -18.58 3.95 A 19 19 0 0 1 -5.87 -18.07 L 0.63 -5.97 A 6 6 0 0 0 -5.87 -1.25 Z" fill="#e7dcc4"/></g><circle cx="32" cy="32" r="3.4" fill="#b23a2b"/></svg>`;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function rasterizeWithQuicklook(svgPath, outPng, size) {
  // qlmanage writes "<basename>.png" into the -o directory.
  const outDir = path.dirname(outPng);
  await execFileAsync("qlmanage", ["-t", "-s", String(size), "-o", outDir, svgPath]);
  const produced = path.join(outDir, `${path.basename(svgPath)}.png`);
  if (!(await exists(produced))) {
    throw new Error(`qlmanage did not produce ${produced}`);
  }
  await copyFile(produced, outPng);
  await rm(produced, { force: true });
}

async function buildIcns(basePng) {
  const iconset = path.join(BUILD_DIR, "icon.iconset");
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  const specs = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of specs) {
    await execFileAsync("sips", ["-z", String(size), String(size), basePng, "--out", path.join(iconset, name)]);
  }
  await execFileAsync("iconutil", ["-c", "icns", iconset, "-o", path.join(BUILD_DIR, "icon.icns")]);
  await rm(iconset, { recursive: true, force: true });
}

async function main() {
  await mkdir(BUILD_DIR, { recursive: true });
  const tmpDir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(path.join(os.tmpdir(), "codex-snapshots-icon-")),
  );
  const svgPath = path.join(tmpDir, "icon.svg");
  await writeFile(svgPath, LOGO_SVG, "utf8");

  const pngPath = path.join(BUILD_DIR, "icon.png");
  if (process.platform === "darwin") {
    await rasterizeWithQuicklook(svgPath, pngPath, 1024);
    await buildIcns(pngPath);
    console.log("Generated build/icon.png and build/icon.icns");
  } else {
    console.warn(
      "Icon generation currently requires macOS tooling (qlmanage/sips/iconutil).\n" +
        "Skipping icon generation; place build/icon.png (1024x1024) and build/icon.icns manually if needed.",
    );
  }
  await rm(tmpDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
