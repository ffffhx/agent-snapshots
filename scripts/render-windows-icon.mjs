// Convert the shared logo to a multi-resolution Windows icon using Electron.
import { app, nativeImage } from "electron";
import { writeFile } from "node:fs/promises";

app.whenReady().then(async () => {
  const [source, destination] = process.argv.slice(2);
  const logo = nativeImage.createFromPath(source);
  if (logo.isEmpty()) throw new Error(`Cannot load app logo: ${source}`);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => logo.resize({ width: size, height: size, quality: "best" }).toPNG());
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2); // ICO, not a cursor.
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  images.forEach((png, index) => {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = sizes[index] % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await writeFile(destination, Buffer.concat([directory, ...images]));
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
