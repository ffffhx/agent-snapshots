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
// Full-bleed vermillion squircle (the 朱红印章 identity) holding a cream archived
// "session page" with a red wax seal — exactly what Codex Snapshots is: read-only
// snapshots of sessions, stamped. Bold, high-contrast, and unmistakably not a disc.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#e2593d"/>
      <stop offset="0.55" stop-color="#c33f28"/>
      <stop offset="1" stop-color="#9d2a1a"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.32" cy="0.2" r="0.95">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.26"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="page" x1="0.1" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#fffaf0"/>
      <stop offset="1" stop-color="#efe0c2"/>
    </linearGradient>
    <linearGradient id="seal" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#d8452e"/>
      <stop offset="1" stop-color="#a02c1a"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="230" fill="#7f2013"/>
  <rect width="1024" height="1024" rx="230" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="230" fill="url(#sheen)"/>
  <g transform="rotate(-5 512 512)">
    <rect x="300" y="266" width="424" height="516" rx="34" fill="#5c160c" opacity="0.26"/>
    <rect x="300" y="252" width="424" height="516" rx="34" fill="url(#page)"/>
    <g fill="#c9bb98">
      <rect x="352" y="330" width="320" height="26" rx="13"/>
      <rect x="352" y="392" width="292" height="26" rx="13"/>
      <rect x="352" y="454" width="320" height="26" rx="13"/>
      <rect x="352" y="516" width="228" height="26" rx="13"/>
    </g>
    <circle cx="648" cy="688" r="88" fill="#7f2013" opacity="0.2"/>
    <circle cx="640" cy="680" r="84" fill="url(#seal)"/>
    <circle cx="640" cy="680" r="84" fill="none" stroke="#fff3df" stroke-width="7" stroke-opacity="0.85"/>
    <circle cx="640" cy="680" r="60" fill="none" stroke="#fff3df" stroke-width="4" stroke-opacity="0.55"/>
    <circle cx="640" cy="680" r="15" fill="#fff3df" fill-opacity="0.85"/>
    <ellipse cx="612" cy="652" rx="26" ry="16" fill="#ffffff" opacity="0.18"/>
  </g>
  <rect x="16" y="16" width="992" height="992" rx="222" fill="none" stroke="#ffffff" stroke-width="3" stroke-opacity="0.12"/>
</svg>`;

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
