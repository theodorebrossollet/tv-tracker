// Generates the PWA icons in public/ from the shapes described below.
//
// Committed as a generator rather than as four opaque PNGs so the icons have a
// source: changing the accent colour or the glyph is an edit here and one
// command, not a round trip through a design tool. There is no image library in
// this project's dependencies and none is worth adding for four flat icons, so
// the PNG encoder is inline — it only needs the uncompressed, non-interlaced
// RGBA case.
//
// Usage: node scripts/generate-icons.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

/** Indigo, matching --accent in globals.css (the light-mode value). */
const ACCENT = [0x4f, 0x46, 0xe5];
const WHITE = [0xff, 0xff, 0xff];

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // bytes 10-12 stay zero: deflate, adaptive filtering, no interlacing.

  // Each scanline is prefixed with its filter type. Filter 0 (none) costs a
  // little size on flat art and keeps this readable.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- Drawing ---------------------------------------------------------------

function canvas(size, background) {
  const pixels = Buffer.alloc(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = background[0];
    pixels[i * 4 + 1] = background[1];
    pixels[i * 4 + 2] = background[2];
    pixels[i * 4 + 3] = 255;
  }

  return pixels;
}

const put = (pixels, size, x, y, colour) => {
  const i = (y * size + x) * 4;
  pixels[i] = colour[0];
  pixels[i + 1] = colour[1];
  pixels[i + 2] = colour[2];
  pixels[i + 3] = 255;
};

/** Rounded rectangle, corners approximated by a circle at each corner. */
function roundedRect(pixels, size, { x, y, w, h, r }, colour) {
  for (let py = Math.max(0, y); py < Math.min(size, y + h); py++) {
    for (let px = Math.max(0, x); px < Math.min(size, x + w); px++) {
      const dx = Math.max(x + r - px, px - (x + w - 1 - r), 0);
      const dy = Math.max(y + r - py, py - (y + h - 1 - r), 0);
      if (dx * dx + dy * dy <= r * r) put(pixels, size, px, py, colour);
    }
  }
}

/** Right-pointing triangle inscribed in the given box. */
function playTriangle(pixels, size, { x, y, w, h }, colour) {
  for (let py = y; py < y + h; py++) {
    // Distance from the vertical centre, 0 at the middle row and 1 at the tips.
    const t = Math.abs(py - (y + h / 2)) / (h / 2);
    const rowWidth = Math.round(w * (1 - t));

    for (let px = x; px < x + rowWidth; px++) {
      if (px >= 0 && px < size && py >= 0 && py < size) {
        put(pixels, size, px, py, colour);
      }
    }
  }
}

/**
 * A screen with a play triangle in it.
 *
 * `scale` is the glyph's share of the canvas. The maskable variant uses a
 * smaller one because launchers crop maskable icons to a shape of their
 * choosing — anything outside the middle 80% may be cut off, so the glyph has
 * to sit well inside that safe zone while the background bleeds to the edge.
 */
function drawIcon(size, scale) {
  const pixels = canvas(size, ACCENT);

  const w = Math.round(size * scale);
  const h = Math.round(w * 0.72);
  const x = Math.round((size - w) / 2);
  const y = Math.round((size - h) / 2);

  roundedRect(pixels, size, { x, y, w, h, r: Math.round(w * 0.12) }, WHITE);

  const tw = Math.round(w * 0.26);
  const th = Math.round(tw * 1.15);
  playTriangle(
    pixels,
    size,
    {
      x: Math.round(x + w / 2 - tw * 0.4),
      y: Math.round(y + h / 2 - th / 2),
      w: tw,
      h: th,
    },
    ACCENT,
  );

  return encodePng(size, size, pixels);
}

const icons = [
  ["public/icon-192.png", drawIcon(192, 0.62)],
  ["public/icon-512.png", drawIcon(512, 0.62)],
  // Smaller glyph: launchers crop this one to a mask of their choosing.
  ["public/icon-maskable-512.png", drawIcon(512, 0.46)],
  // iOS ignores the manifest's icons for the home screen and uses this tag's
  // image instead, at 180×180.
  ["public/apple-touch-icon.png", drawIcon(180, 0.62)],
];

for (const [path, data] of icons) {
  writeFileSync(path, data);
  console.log(`  ${String(data.length).padStart(7)} bytes  ${path}`);
}
