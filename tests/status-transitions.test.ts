import { beforeEach, describe, expect, it, vi } from "vitest";

// Same three doubles as tracking.test.ts: no request scope for revalidatePath,
// no session to build, and no TMDB to reach. The status rules are what's under
// test, and each has its own coverage elsewhere.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: "test-user", nickname: "test-user", hasPassword: true },
  })),
}));

vi.mock("@/lib/shows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shows")>()),
  syncShowFromTmdb: vi.fn(async () => ({ name: "Test Show", episodeCount: 0 })),
}));

const { statusTargets, explainsPromotion } = await import(
  "@/lib/status-transitions"
);
const { STATUS_ACTIONS } = await import("@/components/status-actions");
const { resetDatabase, seedShow, seedUser, statusOf } = await import(
  "./helpers"
);

import type { TrackStatus } from "@/lib/types";

const TRACKED: TrackStatus[] = ["watching", "watchlist", "paused", "stopped"];

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("what the sheet offers", () => {
  it("never offers the status a show is already in", () => {
    // Every row is a real change: the current value is rendered separately as
    // the checked row, so a duplicate here would be a no-op twin of it.
    for (const status of TRACKED) {
      expect(statusTargets(status)).not.toContain(status);
    }
  });

  it("offers only the watchlist for a show that isn't tracked", () => {
    // "+" putting a show on the watchlist is the single entry point; nothing
    // can be paused or stopped before it has been started.
    expect(statusTargets(null)).toEqual(["watchlist"]);
  });

  it("offers nothing but removal for a watchlist show", () => {
    expect(statusTargets("watchlist")).toEqual([]);
  });

  it("explains the promotion rule exactly where Watching is missing", () => {
    // Saying it on a show that is already watching answers a question nobody
    // asked; withholding it where the row is absent is where people look for
    // it and find nothing.
    expect(explainsPromotion(null)).toBe(true);
    expect(explainsPromotion("watchlist")).toBe(true);
    expect(explainsPromotion("watching")).toBe(false);
    expect(explainsPromotion("paused")).toBe(false);
    expect(explainsPromotion("stopped")).toBe(false);
  });
});

describe("every offered transition actually works", () => {
  // The point of these: `statusTargets` mirrors guards that live in
  // actions.ts, and nothing but this test ties the two together. A guard
  // tightened without updating the rules leaves a row that does nothing when
  // tapped — which looks like a broken button, not like a rule.
  for (const from of TRACKED) {
    for (const to of statusTargets(from)) {
      it(`moves a show from ${from} to ${to}`, async () => {
        await seedShow({ offsets: [-10, -3], status: from });

        const result = await STATUS_ACTIONS[to]("101");

        expect(result.ok).toBe(true);
        expect(await statusOf("101")).toBe(to);
      });
    }
  }

  it("adds an untracked show to the watchlist", async () => {
    await seedShow({ offsets: [-10], status: null });

    const result = await STATUS_ACTIONS.watchlist("101");

    expect(result.ok).toBe(true);
    expect(await statusOf("101")).toBe("watchlist");
  });

  it("removes a show from every status it can be in", async () => {
    for (const from of TRACKED) {
      await resetDatabase();
      await seedUser();
      await seedShow({ offsets: [-10], status: from });

      const result = await STATUS_ACTIONS.remove("101");

      expect(result.ok).toBe(true);
      expect(await statusOf("101")).toBeNull();
    }
  });
});

describe("every withheld transition really is refused", () => {
  // The other half. Without this the rules could quietly narrow to nothing and
  // the tests above would still pass, because they only walk what's offered.
  const WITHHELD: Array<{ from: TrackStatus; to: TrackStatus }> = [
    // A show never started can't be set aside — `setAside` requires one that
    // is already being watched.
    { from: "watchlist", to: "paused" },
    { from: "watchlist", to: "stopped" },
    // `resumeShow` only accepts a paused or stopped show.
    { from: "watchlist", to: "watching" },
  ];

  for (const { from, to } of WITHHELD) {
    it(`refuses ${from} to ${to}`, async () => {
      await seedShow({ offsets: [-10, -3], status: from });

      const result = await STATUS_ACTIONS[to]("101");

      expect(result.ok).toBe(false);
      expect(await statusOf("101")).toBe(from);
    });
  }

  it("leaves a tracked show where it is rather than demoting it", async () => {
    // addToWatchlist returns ok for an already-tracked show — it is idempotent
    // by design, not a transition. If it ever started demoting, "Watchlist"
    // would belong in `statusTargets("watching")`.
    await seedShow({ offsets: [-10], status: "watching" });

    const result = await STATUS_ACTIONS.watchlist("101");

    expect(result.ok).toBe(true);
    expect(await statusOf("101")).toBe("watching");
  });
});
