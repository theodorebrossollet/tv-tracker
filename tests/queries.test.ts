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
const { resetDatabase, seedShow } = await import("./helpers");

beforeEach(resetDatabase);

describe("watch progress", () => {
  it("counts only aired episodes, so upcoming ones don't drag progress down", async () => {
    // Three aired (one watched), two still to come.
    await seedShow({
      offsets: [-30, -20, -10, 3, 10],
      status: "watching",
      watched: [0],
    });

    const [show] = await getTrackedShows("watching");

    expect(show.airedCount).toBe(3);
    expect(show.watchedCount).toBe(1);
  });

  it("marks a show finished only when every aired episode is watched", async () => {
    await seedShow({
      offsets: [-30, -20, 10],
      status: "watching",
      watched: [0, 1],
    });

    const [show] = await getTrackedShows("watching");

    // The upcoming episode must not stop it counting as finished.
    expect(show.fullyWatched).toBe(true);
  });

  it("is not finished while an aired episode is unwatched", async () => {
    await seedShow({
      offsets: [-30, -20],
      status: "watching",
      watched: [0],
    });

    const [show] = await getTrackedShows("watching");

    expect(show.fullyWatched).toBe(false);
  });

  it("is not finished when nothing has aired yet", async () => {
    await seedShow({ offsets: [5, 10], status: "watching" });

    const [show] = await getTrackedShows("watching");

    expect(show.airedCount).toBe(0);
    expect(show.fullyWatched).toBe(false);
  });

  it("reports the first unwatched aired episode as next up", async () => {
    await seedShow({
      offsets: [-30, -20, -10],
      status: "watching",
      watched: [0],
    });

    const [show] = await getTrackedShows("watching");

    expect(show.nextUnwatched?.episodeNumber).toBe(2);
  });

  it("has no next episode once everything aired is watched", async () => {
    await seedShow({
      offsets: [-30, -20],
      status: "watching",
      watched: [0, 1],
    });

    const [show] = await getTrackedShows("watching");

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

    const [show] = await getTrackedShows("watching");

    // Counting it would leave progress permanently short of 100%.
    expect(show.airedCount).toBe(1);
  });

  it("separates the two lists", async () => {
    await seedShow({ showId: "a", offsets: [-1], status: "watching" });
    await seedShow({ showId: "b", offsets: [-1], status: "watchlist" });

    expect((await getTrackedShows("watching")).map((s) => s.showId)).toEqual([
      "a",
    ]);
    expect((await getTrackedShows("watchlist")).map((s) => s.showId)).toEqual([
      "b",
    ]);
  });
});

describe("upcoming episodes", () => {
  it("includes shows on the watchlist as well as those being watched", async () => {
    await seedShow({ showId: "w", offsets: [5], status: "watching" });
    await seedShow({ showId: "l", offsets: [7], status: "watchlist" });

    const upcoming = await getUpcomingEpisodes();

    expect(upcoming.map((episode) => episode.showId).sort()).toEqual(["l", "w"]);
  });

  it("excludes shows that aren't tracked at all", async () => {
    await seedShow({ showId: "untracked", offsets: [5], status: null });

    expect(await getUpcomingEpisodes()).toEqual([]);
  });

  it("excludes episodes that have already aired", async () => {
    await seedShow({ offsets: [-5, 5], status: "watching" });

    const upcoming = await getUpcomingEpisodes();

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].episodeNumber).toBe(2);
  });

  it("orders soonest first", async () => {
    await seedShow({ showId: "far", offsets: [30], status: "watching" });
    await seedShow({ showId: "soon", offsets: [2], status: "watching" });

    const upcoming = await getUpcomingEpisodes();

    expect(upcoming.map((episode) => episode.showId)).toEqual(["soon", "far"]);
  });

  it("labels which list each episode came from", async () => {
    await seedShow({ showId: "l", offsets: [3], status: "watchlist" });

    const [episode] = await getUpcomingEpisodes();

    expect(episode.status).toBe("watchlist");
  });

  it("respects the limit", async () => {
    await seedShow({ offsets: [1, 2, 3, 4, 5], status: "watching" });

    expect(await getUpcomingEpisodes(2)).toHaveLength(2);
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

    const show = await getShowDetail(showId);

    expect(show?.seasons.map((season) => season.seasonNumber)).toEqual([
      1, 2, 3,
    ]);
  });

  it("reports the tracked status, or null when untracked", async () => {
    await seedShow({ showId: "tracked", offsets: [-1], status: "watchlist" });
    await seedShow({ showId: "loose", offsets: [-1], status: null });

    expect((await getShowDetail("tracked"))?.status).toBe("watchlist");
    expect((await getShowDetail("loose"))?.status).toBeNull();
  });
});
