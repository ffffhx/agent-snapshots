// Rasterize an SVG to a TRANSPARENT PNG via a headless Electron window.
// (qlmanage flattens SVG transparency onto a white background; Electron/Chromium
// preserves the alpha channel, so the icon's margin stays transparent.)
import { app, BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";

const [svgPath, outPath, sizeArg] = process.argv.slice(2);
const size = Number(sizeArg) || 1024;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    useContentSize: true,
    webPreferences: { offscreen: false },
  });
  const svg = await readFile(svgPath, "utf8");
  const html =
    "<!doctype html><html><head><meta charset='utf-8'><style>" +
    "*{margin:0;padding:0;box-sizing:border-box}" +
    `html,body{width:${size}px;height:${size}px;background:transparent;overflow:hidden}` +
    `svg{width:${size}px;height:${size}px;display:block}` +
    "</style></head><body>" + svg + "</body></html>";
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 350));
  const image = await win.webContents.capturePage();
  await writeFile(outPath, image.toPNG());
  app.quit();
});
