import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readdirSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A Server Component may render a client component. It may not read a *value*
 * out of a `"use client"` module.
 *
 * The bundler replaces such a module with client references — stand-ins that
 * throw when called. A component is fine, because it is only ever rendered.
 * Anything else arrives as an object where a value was expected, and what
 * happens next depends entirely on what the server does with it. Nothing
 * fails: it compiles, it type checks, and TypeScript still believes the export
 * has its declared type.
 *
 * This shipped. `NEXT_UP_QUEUE = 8` lived in `next-up-card.tsx`, and the show
 * page did `.slice(0, NEXT_UP_QUEUE)`. The client reference coerced to `NaN`,
 * `slice(0, NaN)` returns `[]`, and so the Next-up card never rendered — for
 * any show, for anyone, for as long as it existed. What surfaced instead was
 * the caught-up card, which is a perfectly plausible thing for a show page to
 * say, so it read as a copy problem for weeks.
 *
 * Nothing else would catch it. `npm run build` is happy, the types are happy,
 * and no test renders a bundled page.
 */

const SRC = "src";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

const files = walk(SRC);
const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

const isClientModule = (text: string) => /^\s*["']use client["']/.test(text);

const clientModules = new Set(
  [...sources].filter(([, text]) => isClientModule(text)).map(([file]) => file),
);

/** `@/x` → the file it resolves to, or null for a package. */
function resolveAlias(spec: string): string | null {
  if (!spec.startsWith("@/")) return null;

  const base = join(SRC, spec.slice(2));
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.tsx"),
    join(base, "index.ts"),
  ]) {
    if (sources.has(candidate)) return candidate;
  }

  return null;
}

/**
 * A component, and so safe to import: PascalCase means an initial capital *and*
 * a lowercase letter somewhere. Testing only the capital passes
 * SCREAMING_SNAKE_CASE, which is exactly the shape of the export that shipped.
 */
const isComponentName = (name: string) =>
  /^[A-Z]/.test(name) && /[a-z]/.test(name);

interface Crossing {
  file: string;
  name: string;
  from: string;
}

function crossings(): Crossing[] {
  const found: Crossing[] = [];

  for (const [file, text] of sources) {
    // Client → client is fine: no boundary is crossed.
    if (clientModules.has(file)) continue;

    const imports = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;

    while ((match = imports.exec(text))) {
      const [, typeOnly, names, spec] = match;
      // Types are erased before the bundler sees them.
      if (typeOnly) continue;

      const target = resolveAlias(spec);
      if (!target || !clientModules.has(target)) continue;

      for (const entry of names.split(",")) {
        const name = entry.trim();
        if (!name || name.startsWith("type ")) continue;

        const local = name.split(/\s+as\s+/)[0].trim();
        if (!isComponentName(local)) {
          found.push({ file: relative(".", file), name: local, from: relative(".", target) });
        }
      }
    }
  }

  return found;
}

describe("the server/client module boundary", () => {
  it("finds the client modules to check against", () => {
    // A rename or a change in how the directive is written would empty the set
    // and make every assertion below vacuous.
    expect(clientModules.size).toBeGreaterThan(10);
  });

  it("never lets a server module import a value from a client module", () => {
    expect(crossings()).toEqual([]);
  });
});
