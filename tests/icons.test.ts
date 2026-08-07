import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SOURCES = "scripts/icons";

const sources = readdirSync(SOURCES).filter((f) => f.endsWith(".svg"));

describe("icon sources", () => {
  it("has the SVGs the generator reads", () => {
    // A rename here fails the build of every icon at once, silently, because
    // nothing runs the generator on CI.
    expect(sources.sort()).toEqual([
      "favicon-small.svg",
      "icon-app.svg",
      "icon-dark.svg",
      "icon-maskable.svg",
      "icon-mono.svg",
    ]);
  });

  it.each(sources)("%s has no live text", (name) => {
    const svg = readFileSync(`${SOURCES}/${name}`, "utf8");

    // The artwork is a wordmark, and it arrived from design as a <text> element
    // in Geist. Any rasteriser without that exact font — and librsvg even *with*
    // it, which centres text differently — renders a plausible but wrong mark
    // and reports success. Outlined paths are the only version that survives
    // the trip. Reintroducing <text> would not fail any other check.
    expect(svg).not.toMatch(/<text[\s>]/);
    expect(svg).not.toMatch(/font-family/);
  });

  it("draws the pinned-tab mask in black, not white", () => {
    const svg = readFileSync(`${SOURCES}/icon-mono.svg`, "utf8");

    // Safari recolours this itself and there is no background behind it, so a
    // white shape is invisible on every light surface rather than obviously
    // broken.
    expect(svg).toMatch(/fill="#000000"/);
    expect(svg).not.toMatch(/#ffffff/i);
  });

  it("keeps the maskable mark inside the launcher safe circle", () => {
    const svg = readFileSync(`${SOURCES}/icon-maskable.svg`, "utf8");

    const scale = Number(/scale\(([\d.]+)\)/.exec(svg)?.[1]);
    const [, cx, cy, r] = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/
      .exec(svg)!
      .map(Number);

    // The dot is the outermost part of the mark, so it is what decides this.
    // Android may crop anything outside a circle of radius 0.4 × the canvas.
    // Note the 0.8 scale is not what makes this safe — a full-bleed square
    // scaled 0.8 still has corners at 579 — so moving the dot outward can
    // break it while the transform still reads as correct.
    const dx = (cx - 512) * scale;
    const dy = (cy - 512) * scale;
    const reach = Math.hypot(dx, dy) + r * scale;

    expect(reach).toBeLessThan(0.4 * 1024);
  });
});

describe("favicon", () => {
  it("bundles 48, 32 and 16", () => {
    // Next serves src/app/favicon.ico at /favicon.ico by file convention. A
    // second copy in public/ would claim the same route.
    const ico = readFileSync("src/app/favicon.ico");

    expect(ico.readUInt16LE(0), "reserved").toBe(0);
    expect(ico.readUInt16LE(2), "type: 1 = icon").toBe(1);

    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) =>
      ico.readUInt8(6 + i * 16),
    );

    expect(sizes.sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });
});
