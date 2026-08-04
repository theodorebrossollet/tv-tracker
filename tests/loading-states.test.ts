import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every screen in this app is `force-dynamic`, so a tap on the tab bar waits on
 * a server render before anything can change. Without a `loading.tsx` beside
 * the page, Next has no fallback to show and the browser keeps displaying the
 * *previous* screen for that whole time — the tap looks ignored.
 *
 * That is not hypothetical: it shipped, and came back as "slow when switching
 * between tabs" from someone using the app on a phone. The wait was never the
 * problem; the silence was.
 *
 * This is a backstop, not proof. It checks a file exists, not that it renders
 * anything resembling the page — a `loading.tsx` returning null would pass here
 * and help nobody.
 */
const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));

/**
 * Pages that legitimately have no loading state.
 *
 * The sign-in flow reads one row and renders a form — there is nothing to wait
 * for, and a skeleton would flash for a few milliseconds and look like a fault.
 * `welcome` is the same. Everything else is a tab destination or reached from
 * one, and every one of those does real work first.
 */
const NO_LOADING_NEEDED = [
  "login",
  "login/code",
  "login/password",
  "welcome",
];

/** Directories holding a `page.tsx`, relative to `src/app`. */
async function findRouteDirs(dir = APP_DIR, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];

  if (entries.some((entry) => entry.name === "page.tsx")) {
    found.push(prefix);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    found.push(...(await findRouteDirs(join(dir, entry.name), relative)));
  }

  return found.sort();
}

async function hasLoading(routeDir: string): Promise<boolean> {
  const entries = await readdir(join(APP_DIR, routeDir), {
    withFileTypes: true,
  });

  return entries.some((entry) => entry.name === "loading.tsx");
}

describe("every slow screen says it is loading", () => {
  it("finds the routes at all", async () => {
    // Guards the walk itself: a version that silently matched nothing would
    // make the assertion below vacuously true.
    const routes = await findRouteDirs();

    expect(routes.length).toBeGreaterThan(5);
    expect(routes).toContain("");
    expect(routes).toContain("settings");
  });

  it("gives every tab destination a loading boundary", async () => {
    const routes = await findRouteDirs();
    const missing: string[] = [];

    for (const route of routes) {
      if (NO_LOADING_NEEDED.includes(route)) continue;
      if (!(await hasLoading(route))) missing.push(route || "/");
    }

    expect(missing).toEqual([]);
  });

  it("does not carry loading files for routes that were excused", async () => {
    // Keeps the allow-list honest. If one of these grows a loading state, the
    // entry is stale and the next reader should not have to work that out.
    for (const route of NO_LOADING_NEEDED) {
      expect(await hasLoading(route)).toBe(false);
    }
  });
});
