import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Route protection here is per-file convention: every page calls a `require*`
 * gate itself, and nothing sits above them enforcing it — no middleware, and
 * the shared `APP_PASSWORD` that used to catch a forgotten gate is gone. A page
 * added without one is silently public, and looks completely normal in review.
 *
 * This is a backstop for that, not proof of anything: it checks the gate is
 * *named* in the file. A page that imports one and never calls it, or calls it
 * down a branch that doesn't run, still passes. Treating a green run here as
 * "the route is protected" would be the wrong lesson — read the page.
 */
const APP_DIR = fileURLToPath(new URL("../src/app", import.meta.url));

/**
 * Routes deliberately reachable without a session.
 *
 * `login/` is the sign-in flow itself — gating it would lock everyone out. The
 * cron route is machine-facing and authorises with CRON_SECRET instead, in its
 * own `isAuthorized`.
 */
const UNGATED = [
  "api/cron/refresh-episodes/route.ts",
  "login/code/page.tsx",
  "login/page.tsx",
  "login/password/page.tsx",
];

const GATES = ["requireSession", "requireOnboardedSession"];

/** Every page and route handler under src/app, as paths relative to it. */
async function findRouteFiles(dir = APP_DIR, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      found.push(...(await findRouteFiles(join(dir, entry.name), relative)));
    } else if (entry.name === "page.tsx" || entry.name === "route.ts") {
      found.push(relative);
    }
  }

  return found.sort();
}

describe("every route is gated or deliberately open", () => {
  it("finds the routes at all", async () => {
    // Guards the walk itself: a glob that silently matched nothing would make
    // every assertion below vacuously true, which is the classic way a test
    // like this rots into decoration.
    const files = await findRouteFiles();

    expect(files.length).toBeGreaterThanOrEqual(UNGATED.length + 1);
    expect(files).toContain("page.tsx");
  });

  it("calls a session gate in every route that isn't allow-listed", async () => {
    const files = await findRouteFiles();
    const ungated: string[] = [];

    for (const file of files) {
      if (UNGATED.includes(file)) continue;

      const source = await readFile(join(APP_DIR, file), "utf8");
      if (!GATES.some((gate) => source.includes(gate))) ungated.push(file);
    }

    // Named in the failure rather than counted, so the message says which file
    // to go and look at.
    expect(ungated).toEqual([]);
  });

  it("keeps the allow-list honest", async () => {
    // An entry for a file that no longer exists is worse than useless: rename
    // `login/page.tsx` and the stale entry stops matching anything, while a new
    // page at the old path would be waved straight through.
    const files = await findRouteFiles();

    expect(UNGATED.filter((file) => !files.includes(file))).toEqual([]);
  });
});
