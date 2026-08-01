import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("src/app/manifest.json", "utf8"));

/** Width and height straight out of a PNG's IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  expect(buffer.subarray(1, 4).toString("ascii"), `${path} is a PNG`).toBe("PNG");

  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("web app manifest", () => {
  it("has what a browser needs to offer installation", () => {
    // Per Next's PWA guide the criteria are a valid manifest plus HTTPS —
    // offline support is explicitly not required, which is what makes the
    // shell-only service worker a legitimate choice rather than a compromise.
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("points at icons that exist, at the sizes it claims", () => {
    // A renamed or resized icon breaks installation silently — the manifest
    // still parses and the browser simply declines to offer it.
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split("x").map(Number);
      const actual = pngSize(`public${icon.src}`);

      expect(actual, `${icon.src}`).toEqual({ width: w, height: h });
    }
  });

  it("ships a maskable icon as well as a plain one", () => {
    const purposes = manifest.icons.map((icon: { purpose: string }) => icon.purpose);

    // Without a maskable variant, Android crops the square icon into its own
    // shape and clips the artwork.
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });

  it("ships the apple-touch-icon iOS uses instead of the manifest", () => {
    // iOS ignores manifest icons for the home screen entirely.
    expect(pngSize("public/apple-touch-icon.png")).toEqual({
      width: 180,
      height: 180,
    });
  });
});
