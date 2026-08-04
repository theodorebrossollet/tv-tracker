import { beforeEach, describe, expect, it, vi } from "vitest";

// getShowDetail reaches for TMDB when a show isn't cached; these tests seed the
// cache directly and only care about the aggregation.
vi.mock("@/lib/shows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shows")>()),
  ensureShowCached: vi.fn(async () => true),
}));

const { getShowDetail, getTrackedShows, getUpcomingEpisodes } = await import(
  "@/lib/queries"
);
const { TEST_USER_ID, resetDatabase, seedShow, seedUser } = await import(
  "./helpers"
);

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("watch progress", () => {
  it("counts only aired episodes, so upcoming ones don't drag progress down", async () => {
    // Three aired (one watched), two still to come.
    await seedShow({
      offsets: [-30, -20, -10, 3, 10],
      status: "watching",
      watched: [0],
    });

    const [show] = await getTrackedShows(TEST_USER_ID, "watching");

    expect(show.airedCount).toBe(3);
    expect(show.watchedCount).toBe(1);
  });

  it("marks a show finished only when every aired episode is watched", async () => {
    await seedShow({
      offsets: [-30, -20, 10],
      status: "watching",
      watched: [0, 1],
    });

    const [show] = await getTrackedShows(TEST_USER_ID, "watching");

    // The upcoming episode must not stop it counting as finished.
    expect(show.fullyWatched).toBe(true);
  });

  it("is not finished while an aired episode is unwatched", async () => {
    await seedShow({
      offsets: [-30, -20],
      status: "watching",
      watched: [0],
    });

    const [show] = await getTrackedShows(TEST_USER_ID, "watching");

    expect(show.fullyWatched).toBe(false);
  });

  it("is not finished when nothing has aired yet", async () => {
    await seedShow({ offsets: [5, 10], status: "watching" });

    const [show] = await getTrackedShows(TEST_USER_ID, "watching");

    expect(show.airedCount).toBe(0);
    expect(show.fullyWatched).toBe(false);
  });

  it("reports the first unwatched aired episode as next up", async () => {
    await seedShow({
      offsets: [-30, -20, -10],
      status: "watching",
      watched: [0],
    });

    const [show] = await getTrackedShows(TEST_USER_ID, "watching");

    expect(show.nextUnwatched?.episodeNumber).toBe(2);
  });

  it("carries that episode's id, not just its number", async () => {
    // The dashboard's inline tick marks this episode without leaving the list,
    // and `markEpisodeWatched` is keyed by id. A wrong id here doesn't fail —
    // it silently marks a different episode, which is why this asserts the id
    // rather than that one merely exists.
    const { episodeIds } = await seedShow({
      offsets: [-30, -20, -10],
      status: "watching",
      watched: [0],
    });

    const [show] = await getTrackedShows(TEST_USER_ID, "watching");

    expect(show.nextUnwatched?.id).toBe(episodeIds[1]);
  });

  it("has no next episode once everything aired is watched", async () => {
    await seedShow({
      offsets: [-30, -20],
      status: "watching",
      watched: [0, 1],
    });

    const [show] = await getTrackedShows(TEST_USER_ID, "watching");

    expect(show.nextUnwatched).toBeNull();
  });

  it("ignores episodes with no announced air date", async () => {
    const { showId } = await seedShow({ offsets: [-10], status: "watching" });
    const { prisma } = await import("@/lib/prisma");

    await prisma.episode.create({
      data: {
        id: "no-date",
        showId,
        seasonNumber: 1,
        episodeNumber: 99,
        name: "Unscheduled",
        airDate: null,
      },
    });

    const [show] = await getTrackedShows(TEST_USER_ID, "watching");

    // Counting it would leave progress permanently short of 100%.
    expect(show.airedCount).toBe(1);
  });

  it("separates the two lists", async () => {
    await seedShow({ showId: "a", offsets: [-1], status: "watching" });
    await seedShow({ showId: "b", offsets: [-1], status: "watchlist" });

    expect((await getTrackedShows(TEST_USER_ID, "watching")).map((s) => s.showId)).toEqual([
      "a",
    ]);
    expect((await getTrackedShows(TEST_USER_ID, "watchlist")).map((s) => s.showId)).toEqual([
      "b",
    ]);
  });
});

describe("upcoming episodes", () => {
  it("includes shows on the watchlist as well as those being watched", async () => {
    await seedShow({ showId: "w", offsets: [5], status: "watching" });
    await seedShow({ showId: "l", offsets: [7], status: "watchlist" });

    const upcoming = await getUpcomingEpisodes(TEST_USER_ID);

    expect(upcoming.map((episode) => episode.showId).sort()).toEqual(["l", "w"]);
  });

  it("excludes shows that aren't tracked at all", async () => {
    await seedShow({ showId: "untracked", offsets: [5], status: null });

    expect(await getUpcomingEpisodes(TEST_USER_ID)).toEqual([]);
  });

  it("excludes episodes that have already aired", async () => {
    await seedShow({ offsets: [-5, 5], status: "watching" });

    const upcoming = await getUpcomingEpisodes(TEST_USER_ID);

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].episodeNumber).toBe(2);
  });

  it("orders soonest first", async () => {
    await seedShow({ showId: "far", offsets: [30], status: "watching" });
    await seedShow({ showId: "soon", offsets: [2], status: "watching" });

    const upcoming = await getUpcomingEpisodes(TEST_USER_ID);

    expect(upcoming.map((episode) => episode.showId)).toEqual(["soon", "far"]);
  });

  it("labels which list each episode came from", async () => {
    await seedShow({ showId: "l", offsets: [3], status: "watchlist" });

    const [episode] = await getUpcomingEpisodes(TEST_USER_ID);

    expect(episode.status).toBe("watchlist");
  });

  it("respects the limit", async () => {
    await seedShow({ offsets: [1, 2, 3, 4, 5], status: "watching" });

    expect(await getUpcomingEpisodes(TEST_USER_ID, 2)).toHaveLength(2);
  });
});

describe("show detail", () => {
  it("groups episodes into seasons in order", async () => {
    const { showId } = await seedShow({ offsets: [-5], status: "watching" });
    const { prisma } = await import("@/lib/prisma");

    for (const [season, episode] of [
      [2, 1],
      [3, 1],
    ]) {
      await prisma.episode.create({
        data: {
          id: `s${season}e${episode}`,
          showId,
          seasonNumber: season,
          episodeNumber: episode,
          name: `S${season}`,
          airDate: new Date(),
        },
      });
    }

    const show = await getShowDetail(TEST_USER_ID, showId);

    expect(show?.seasons.map((season) => season.seasonNumber)).toEqual([
      1, 2, 3,
    ]);
  });

  it("reports the tracked status, or null when untracked", async () => {
    await seedShow({ showId: "tracked", offsets: [-1], status: "watchlist" });
    await seedShow({ showId: "loose", offsets: [-1], status: null });

    expect((await getShowDetail(TEST_USER_ID, "tracked"))?.status).toBe("watchlist");
    expect((await getShowDetail(TEST_USER_ID, "loose"))?.status).toBeNull();
  });
});

describe("watching order", () => {
  it("puts shows with something to watch above ones that are caught up", async () => {
    // Seeded so that ordering by "recently added" alone would put the
    // caught-up show first — the test would pass by accident otherwise.
    await seedShow({
      showId: "behind",
      offsets: [-10, -3],
      status: "watching",
      watched: [0],
    });
    await seedShow({
      showId: "caughtup",
      offsets: [-10],
      status: "watching",
      watched: [0],
    });

    const order = (await getTrackedShows(TEST_USER_ID, "watching")).map((s) => s.showId);

    expect(order).toEqual(["behind", "caughtup"]);
  });

  it("sinks finished shows to the bottom", async () => {
    // The original complaint: a show finished months ago sat above one with
    // unwatched episodes purely because it was added later.
    // Added last, so add-order would float it to the top.
    await seedShow({
      showId: "active",
      offsets: [-10, -3],
      status: "watching",
      watched: [0],
    });
    await seedShow({
      showId: "finished",
      offsets: [-30],
      status: "watching",
      watched: [0],
      showStatus: "Ended",
    });

    const order = (await getTrackedShows(TEST_USER_ID, "watching")).map((s) => s.showId);

    expect(order).toEqual(["active", "finished"]);
  });

  it("orders by most recent activity within a band", async () => {
    // "fresh" is added first, so add-order would rank it last.
    const b = await seedShow({
      showId: "fresh",
      offsets: [-40, -3],
      status: "watching",
      watched: [0],
    });
    const a = await seedShow({
      showId: "stale",
      offsets: [-40, -3],
      status: "watching",
      watched: [0],
    });

    const { setWatchedAt } = await import("./helpers");
    await setWatchedAt(a.episodeIds[0], 90);
    await setWatchedAt(b.episodeIds[0], 1);

    const order = (await getTrackedShows(TEST_USER_ID, "watching")).map((s) => s.showId);

    expect(order).toEqual(["fresh", "stale"]);
  });

  it("falls back to when a show was added if it has no watch history", async () => {
    await seedShow({ showId: "older", offsets: [-10], status: "watching" });
    await seedShow({ showId: "newer", offsets: [-10], status: "watching" });

    const order = (await getTrackedShows(TEST_USER_ID, "watching")).map((s) => s.showId);

    // Both are equally actionable and unwatched, so the later addition wins.
    expect(order).toEqual(["newer", "older"]);
  });
});

describe("upcoming excludes paused shows", () => {
  it("drops episodes of a paused show", async () => {
    // If you've set a show aside, its next episode isn't something you're
    // waiting for.
    await seedShow({ showId: "w", offsets: [5], status: "watching" });
    await seedShow({
      showId: "p",
      offsets: [3],
      status: "paused",
      watched: [],
    });

    const upcoming = await getUpcomingEpisodes(TEST_USER_ID);

    expect(upcoming.map((e) => e.showId)).toEqual(["w"]);
  });
});

describe("bucketing", () => {
  it("puts each show in exactly one bucket", async () => {
    const { getShowBuckets } = await import("@/lib/queries");

    await seedShow({ showId: "a", offsets: [-10, -3], status: "watching", watched: [0] });
    await seedShow({ showId: "b", offsets: [-10], status: "watchlist" });
    await seedShow({ showId: "c", offsets: [-10, -3], status: "paused", watched: [0] });
    await seedShow({ showId: "d", offsets: [-10], status: "watching", watched: [0] });
    await seedShow({ showId: "e", offsets: [-10], status: "stopped", watched: [0] });

    const buckets = await getShowBuckets(TEST_USER_ID);
    const ids = (list: { showId: string }[]) => list.map((s) => s.showId);

    expect(ids(buckets.watching)).toEqual(["a"]);
    expect(ids(buckets.watchlist)).toEqual(["b"]);
    expect(ids(buckets.paused)).toEqual(["c"]);
    expect(ids(buckets.finished)).toEqual(["d"]);
    expect(ids(buckets.stopped)).toEqual(["e"]);

    // The real invariant: no show is listed twice.
    const all = [...ids(buckets.watching), ...ids(buckets.watchlist),
                 ...ids(buckets.paused), ...ids(buckets.finished), ...ids(buckets.stopped)];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(5);
  });

  it("finished wins over paused", async () => {
    // A paused show you'd already completed belongs in the Archive, not in the
    // list of things you mean to get back to.
    await seedShow({ offsets: [-10], status: "paused", watched: [0] });

    const { getShowBuckets } = await import("@/lib/queries");
    const buckets = await getShowBuckets(TEST_USER_ID);

    expect(buckets.finished.map((s) => s.showId)).toEqual(["101"]);
    expect(buckets.paused).toEqual([]);
  });

  it("stopped wins over finished", async () => {
    // Abandoning a show is a decision; finishing it is an episode count. The
    // decision is the more useful label.
    await seedShow({ offsets: [-10], status: "stopped", watched: [0] });

    const { getShowBuckets } = await import("@/lib/queries");
    const buckets = await getShowBuckets(TEST_USER_ID);

    expect(buckets.stopped.map((s) => s.showId)).toEqual(["101"]);
    expect(buckets.finished).toEqual([]);
  });

  it("keeps finished shows out of Watching entirely", async () => {
    // This is what replaced the "hide finished shows" toggle.
    await seedShow({ showId: "done", offsets: [-10], status: "watching", watched: [0] });
    await seedShow({ showId: "going", offsets: [-10, -3], status: "watching", watched: [0] });

    const { getShowBuckets } = await import("@/lib/queries");

    expect((await getShowBuckets(TEST_USER_ID)).watching.map((s) => s.showId)).toEqual(["going"]);
  });

  it("returns a finished show to Watching when a new episode airs", async () => {
    // Finished is derived, not stored — that's what makes this work with no
    // action from the user.
    const { showId } = await seedShow({
      offsets: [-10],
      status: "watching",
      watched: [0],
    });

    const { getShowBuckets } = await import("@/lib/queries");
    expect((await getShowBuckets(TEST_USER_ID)).finished.map((s) => s.showId)).toEqual([showId]);

    const { prisma } = await import("@/lib/prisma");
    await prisma.episode.create({
      data: {
        id: "new-season",
        showId,
        seasonNumber: 2,
        episodeNumber: 1,
        name: "Return",
        airDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    const after = await getShowBuckets(TEST_USER_ID);
    expect(after.finished).toEqual([]);
    expect(after.watching.map((s) => s.showId)).toEqual([showId]);
  });
});
