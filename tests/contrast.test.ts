import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The colour tokens, checked as numbers rather than by eye.
 *
 * Three separate rounds of "the colours are not great, we can't see much" came
 * back from a phone, and each time the values had looked reasonable in the
 * file. They were reasonable *individually* — what was wrong was the distance
 * between them, which is exactly the thing you cannot judge by reading a hex
 * code, and which nothing was checking.
 *
 * WCAG's 4.5:1 is the bar for body text at these sizes. The elevation checks
 * have no standard behind them; they encode the lesson that two surfaces four
 * units apart per channel are the same colour on a dimmed phone screen.
 */
const CSS = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;

  const [r, g, b] = [0, 2, 4].map((i) =>
    channel(parseInt(full.slice(i, i + 2), 16)),
  );

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Reads the tokens straight out of the stylesheet, so the test measures what
 * ships rather than a copy that can drift away from it. The app is dark only,
 * so there is one palette, declared once.
 */
async function readTokens() {
  const css = await readFile(CSS, "utf8");

  const tokens: Record<string, string> = {};
  for (const [, name, value] of css.matchAll(
    /--([a-z-]+):\s*(#[0-9a-f]{3,8});/gi,
  )) {
    tokens[name] ??= value;
  }

  return tokens;
}

/** Backgrounds that body text is actually drawn on. */
const TEXT_SURFACES = ["background", "surface", "surface-raised"];

describe("the palette", () => {
  it("defines every token the app uses", async () => {
    // Guards the parse itself: a regex that silently matched nothing would make
    // every assertion below vacuously true.
    const tokens = await readTokens();

    for (const name of [...TEXT_SURFACES, "foreground", "muted", "faint", "highlight"]) {
      expect(tokens[name], `${name} missing`).toBeDefined();
    }
  });

  it("keeps every text colour readable on every surface", async () => {
    const tokens = await readTokens();

    for (const text of ["foreground", "muted", "faint", "highlight"]) {
      for (const surface of TEXT_SURFACES) {
        const ratio = contrast(tokens[text], tokens[surface]);

        expect(
          Number(ratio.toFixed(2)),
          `${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the elevation levels far enough apart to see", async () => {
    // Not a WCAG rule — a lesson. Near-blacks are perceptually compressed on
    // an emissive screen, so steps that read clearly on white vanish on black:
    // the dark palette that came back as "can't see much" measured 1.099 and
    // 1.146 here. The floor sits above that.
    const floor = 1.15;
    const tokens = await readTokens();

    for (const [under, over] of [
      ["background", "surface"],
      ["surface", "surface-raised"],
    ]) {
      const ratio = contrast(tokens[under], tokens[over]);

      expect(
        Number(ratio.toFixed(3)),
        `${under} vs ${over}`,
      ).toBeGreaterThan(floor);
    }
  });

  it("keeps borders visible against what they enclose", async () => {
    const tokens = await readTokens();

    expect(
      Number(contrast(tokens.border, tokens.surface).toFixed(3)),
      `border on surface`,
    ).toBeGreaterThan(1.1);
  });
});
