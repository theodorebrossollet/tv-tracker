import { beforeEach, describe, expect, it, vi } from "vitest";

// Correctness at a size the rest of the suite never reaches.
//
// The aggregates are computed by the database now, so the failure mode changed:
// the old Node loop was obviously right and merely slow, while a GROUP BY that
// is subtly wrong returns a plausible number instead of an error. A show can
// then be filed under the wrong heading — `getShowBuckets` decides that from
// these counts — and nothing anywhere reports a problem. Small fixtures don't
// catch a smeared join; these do.
//
// 40,000 episodes is also past SQLite's 32,766 bind-variable cap, which is worth
// knowing about but is *not* what this guards: Prisma chunks a nested relation
// read at 999 binds per statement, so the old shape never reached the cap
// either. It paid 44 round trips for this fixture rather than throwing. Both
// numbers are measured; see the note on `loadShowProgress`.
//
// Slower than the rest of the suite because the rows have to be real.

vi.mock("@/lib/shows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shows")>()),
  ensureShowCached: vi.fn(async () => true),
}));

const { getTrackedShows } = await import("@/lib/queries");
const { prisma } = await import("@/lib/prisma");
const { TEST_USER_ID, resetDatabase, seedUser } = await import("./helpers");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Creates one tracked show with `count` aired episodes, `watched` of them seen. */
async function seedLargeShow(showId: string, count: number, watched: number) {
  await prisma.show.create({ data: { id: showId, name: `Show ${showId}` } });
  await prisma.trackedShow.create({
    data: { userId: TEST_USER_ID, showId, status: "watching" },
  });

  const episodes = Array.from({ length: count }, (_, i) => ({
    id: `${showId}-e${i + 1}`,
    showId,
    seasonNumber: Math.floor(i / 100) + 1,
    episodeNumber: (i % 100) + 1,
    name: `Episode ${i + 1}`,
    // All in the past, oldest first, so "next up" is deterministic.
    airDate: new Date(Date.now() - (count - i) * DAY_MS),
  }));

  // Chunked for the same reason the app's own writes are.
  for (let i = 0; i < episodes.length; i += 500) {
    await prisma.episode.createMany({ data: episodes.slice(i, i + 500) });
  }

  const marks = episodes.slice(0, watched).map((episode) => ({
    userId: TEST_USER_ID,
    episodeId: episode.id,
  }));

  for (let i = 0; i < marks.length; i += 500) {
    await prisma.watchedEpisode.createMany({ data: marks.slice(i, i + 500) });
  }
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("a library far larger than the other fixtures", () => {
  it("reads a show with tens of thousands of episodes", async () => {
    // A daytime soap. The counts have to stay exact at a size where an
    // off-by-a-join is invisible in the numbers themselves.
    const count = 40_000;
    await seedLargeShow("soap", count, 1_000);

    const [show] = await getTrackedShows(TEST_USER_ID, "watching");

    expect(show.airedCount).toBe(count);
    expect(show.watchedCount).toBe(1_000);
    expect(show.fullyWatched).toBe(false);
    // Episode 1001 is the first unwatched one, in season/episode order.
    expect(show.nextUnwatched?.id).toBe("soap-e1001");
    expect(show.lastWatchedAt).not.toBeNull();
  }, 120_000);

  it("keeps each show's counts separate across a wide library", async () => {
    // The aggregate groups by showId; a missing GROUP BY or a bad join would
    // smear one show's totals across the others and still return plausible
    // numbers.
    await seedLargeShow("a", 300, 300);
    await seedLargeShow("b", 200, 50);
    await seedLargeShow("c", 100, 0);

    const shows = await getTrackedShows(TEST_USER_ID, "watching");
    const by = new Map(shows.map((show) => [show.showId, show]));

    expect(by.get("a")).toMatchObject({
      airedCount: 300,
      watchedCount: 300,
      fullyWatched: true,
      nextUnwatched: null,
    });
    expect(by.get("b")).toMatchObject({ airedCount: 200, watchedCount: 50 });
    expect(by.get("b")!.nextUnwatched?.id).toBe("b-e51");
    expect(by.get("c")).toMatchObject({
      airedCount: 100,
      watchedCount: 0,
      fullyWatched: false,
    });
    expect(by.get("c")!.nextUnwatched?.id).toBe("c-e1");
    expect(by.get("c")!.lastWatchedAt).toBeNull();
  }, 120_000);
});
