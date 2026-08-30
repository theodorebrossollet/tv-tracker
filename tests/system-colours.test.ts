import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The colours the *browser* picks, which this file's tokens do not control.
 *
 * `contrast.test.ts` measures the palette against itself. It cannot see the one
 * colour that shipped wrong, because that colour is not in the palette: the UA
 * stylesheet paints `<dialog>` with `color: CanvasText`, a system colour
 * resolved against the element's used colour scheme. Nothing had declared one,
 * so it was light — and every string inside the status sheet rendered pure
 * black on the dark panel, while any child that named a token (the row hints,
 * `text-muted`) stayed correct. A heading dimmer than its own subtitle.
 *
 * Nothing in the suite would catch it. jsdom has no system colours and no
 * cascade to resolve them through, so a test that renders the sheet and reads
 * `color` gets the empty string in both schemes — it cannot tell the fixed
 * version from the broken one. The defect only exists in a real engine, so the
 * test for it reads source, as `route-gates` and `client-boundary` do.
 */

const SRC = "src";
const CSS = join(SRC, "app/globals.css");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("system colours", () => {
  it("declares a colour scheme, so the UA's own colours follow ours", () => {
    const css = readFileSync(CSS, "utf8");

    // `light dark`, not bare `dark`: the palette still switches on
    // `prefers-color-scheme`, and pinning the scheme would leave a reader in
    // light mode with dark form controls.
    expect(css).toMatch(/color-scheme:\s*light dark;/);
  });

  it("names a text colour on every dialog", () => {
    // `<dialog>` is the outermost element in both components that use one, so
    // the first className after the tag is the dialog's own.
    const dialogs = walk(SRC)
      .map((file) => [file, readFileSync(file, "utf8")] as const)
      .filter(([, text]) => text.includes("<dialog"));

    // A rule that matched nothing would pass forever.
    expect(dialogs.length).toBeGreaterThan(0);

    for (const [file, text] of dialogs) {
      const className = text
        .slice(text.indexOf("<dialog"))
        .match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);

      const value = className?.[1] ?? className?.[2] ?? "";

      expect(value, `${file}: <dialog> has no className`).not.toBe("");
      expect(
        /\btext-[a-z-]+\b/.test(value),
        `${file}: <dialog> names no text colour, so it inherits CanvasText`,
      ).toBe(true);
    }
  });
});
