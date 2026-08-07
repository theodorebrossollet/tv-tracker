// Rasterises the app icons in public/ (and the favicon) from the SVGs in
// scripts/icons/.
//
// The SVGs are the source of truth, and their text is OUTLINED — there is no
// live <text> in them and no font to install. That is deliberate and worth not
// undoing: the artwork came from the design handoff as live <text> in Geist,
// and a rasteriser that lays text out even slightly differently produces a
// different icon while reporting success. librsvg, which is what sharp uses and
// what the handoff's own pipeline recommended, does exactly that — it leaves
// the trailing letter-spacing out of the advance width it centres on, so the
// mark landed 15px left of centre on a 1024 canvas versus a browser. With the
// font missing entirely it is worse and just as quiet: a fallback face renders
// a plausible, wrong wordmark. Outlined paths render identically everywhere,
// measured at 0.27% of pixels differing between librsvg and Chromium, all of it
// antialiasing.
//
// So: edit the SVGs, re-run this. To change the wordmark itself you need Geist
// as a font file and a text-to-path step — that is a deliberate speed bump,
// not an oversight.
//
// sharp is a devDependency rather than something this file hand-rolls. The
// previous version of this script encoded PNGs inline to avoid adding an image
// library, which was reasonable when the icons were flat rectangles drawn in
// code; it cannot fill a bezier. sharp is already installed either way — Next
// depends on it for image optimisation — so declaring it costs nothing.
//
// Usage: node scripts/generate-icons.mjs

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (name) => readFileSync(join(root, "scripts/icons", name));

/**
 * Renders at 3x and downsamples.
 *
 * librsvg rasterises at the SVG's own pixel size before any resize, so asking
 * for 16px directly antialiases a 16px render rather than a good one — the
 * curve of the "v" turns to steps. `density` scales that internal render.
 */
async function png(svg, size) {
  return sharp(svg, { density: 96 * 3 })
    .resize(size, size, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * A .ico wrapping PNGs, which every browser in use has understood for years.
 *
 * Layout: a 6-byte ICONDIR, then one 16-byte ICONDIRENTRY per image, then the
 * image data. Width and height are single bytes, where 0 means 256.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size: not palettised
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const app = src("icon-app.svg");
const maskable = src("icon-maskable.svg");
const dark = src("icon-dark.svg");
const small = src("favicon-small.svg");

const outputs = [
  // Indigo for anything the user sees as *the app* — home screen, launcher,
  // install prompt. It carries --accent, which a dark tile does not.
  ["public/icon-192.png", await png(app, 192)],
  ["public/icon-512.png", await png(app, 512)],
  // Android crops these to a shape of its choosing, so the mark is inset.
  ["public/icon-maskable-192.png", await png(maskable, 192)],
  ["public/icon-maskable-512.png", await png(maskable, 512)],
  // iOS ignores the manifest's icons for the home screen and uses this one.
  ["public/apple-touch-icon.png", await png(app, 180)],
];

for (const [path, data] of outputs) {
  writeFileSync(join(root, path), data);
  console.log(`  ${String(data.length).padStart(7)} bytes  ${path}`);
}

// The favicon is dark rather than indigo: it sits in browser chrome, not on the
// app's surface. 32 and 16 come from the redraw — larger type, no dot — because
// the dot is roughly two pixels at 16 and reads as dirt, and the wordmark at
// the app icon's proportions reads as a smudge. Downscaling the app icon here
// was tried and is visibly worse.
const favicon = ico([
  { size: 48, data: await png(dark, 48) },
  { size: 32, data: await png(small, 32) },
  { size: 16, data: await png(small, 16) },
]);

// Lives in app/ rather than public/: it is the App Router file convention, and
// Next serves it at /favicon.ico and emits the <link> itself. A public/favicon.ico
// would be a second file claiming the same route.
writeFileSync(join(root, "src/app/favicon.ico"), favicon);
console.log(`  ${String(favicon.length).padStart(7)} bytes  src/app/favicon.ico`);

// Served as-is; Safari masks and recolours it for pinned tabs.
copyFileSync(join(root, "scripts/icons/icon-mono.svg"), join(root, "public/icon-mono.svg"));
console.log(`           copied  public/icon-mono.svg`);
