import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { rasterizeSvgBytes } from "../../../packages/exporters/dist/node.js";

/**
 * Rasterise the application icon.
 *
 * Produces `build/icon.ico` (what electron-builder stamps into the Windows
 * executable and installer), `build/icon.png` (512 px, for anything that
 * wants a plain bitmap) and copies the source SVG into the editor's public
 * assets so the in-app brand mark is the same drawing as the taskbar icon.
 *
 * The ICO container is trivial enough to write by hand: a 6-byte header, one
 * 16-byte directory entry per image, then the PNG streams back to back.
 * Windows has accepted PNG-compressed entries at every size since Vista.
 */
const root = resolve(import.meta.dirname, "..");
const buildDir = resolve(root, "build");
const source = await readFile(resolve(buildDir, "icon.svg"), "utf8");

// The polarity marks inside the op-amp are a blur below roughly 40 px, so the
// small rasters come from a copy with that group removed.
const simplified = source.replace(
  /<g class="icon-detail"[\s\S]*?<\/g>\s*/u,
  "",
);
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function raster(size) {
  return rasterizeSvgBytes(size < 40 ? simplified : source, size);
}

function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(({ size, png }, index) => {
    const entry = index * 16;
    // 0 means 256 in the one-byte width/height fields.
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2); // palette size: none
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([
    header,
    directory,
    ...images.map((i) => Buffer.from(i.png)),
  ]);
}

await mkdir(buildDir, { recursive: true });
const images = ICO_SIZES.map((size) => ({ size, png: raster(size) }));
await writeFile(resolve(buildDir, "icon.ico"), packIco(images));
await writeFile(resolve(buildDir, "icon.png"), raster(512));
await writeFile(
  resolve(root, "../editor/public/schematic-draft-mark.svg"),
  source,
);

console.log(
  `icon.ico (${ICO_SIZES.join(", ")} px), icon.png (512 px) and the editor brand mark written`,
);
