import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shows")>()),
  ensureShowCached: vi.fn(async () => true),
}));

const { getShowDetail, getTrackedShows } = await import("@/lib/queries");
const { TEST_USER_ID, resetDatabase, seedSeasonedShow, seedUser, watchEpisode } =
  await import("./helpers");

const B = "user-b";

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  await seedUser(B);
});

/** Detail and the summary for the same show, which must agree. */
async function both(userId = TEST_USER_ID, showId = "101") {
  const detail = await getShowDetail(userId, showId);
  const summary = (await getTrackedShows(userId)).find(
    (s) => s.showId === showId,
  );
  return { detail: detail!, summary: summary! };
}

describe("getShowDetail ratings", () => {
  it("reports the caller's rating per episode, null when unwatched or unrated", async () => {
    await seedSeasonedShow({ seasons: [3] });
    await watchEpisode("101-s1e1", 8);
    await watchEpisode("101-s1e2"); // watched, unrated

    const detail = await getShowDetail(TEST_USER_ID, "101");
    expect(detail!.seasons[0].episodes.map((e) => [e.watched, e.rating])).toEqual([
      [true, 8],
      [true, null],
      [false, null],
    ]);
  });

  it("averages per season and counts rated vs watched", async () => {
    await seedSeasonedShow({ seasons: [4] });
    await watchEpisode("101-s1e1", 6);
    await watchEpisode("101-s1e2", 9);
    await watchEpisode("101-s1e3");

    const season = (await getShowDetail(TEST_USER_ID, "101"))!.seasons[0];
    expect(season.ratingAverage).toBeCloseTo(7.5, 9);
    expect(season.ratedCount).toBe(2);
    expect(season.watchedEpisodeCount).toBe(3);
  });

  it("makes the show average the mean of season averages, not of episodes", async () => {
    // S1: one episode rated 10; S2: four rated 2. Mean of episodes is 3.6,
    // mean of season averages is 6.
    await seedSeasonedShow({ seasons: [1, 4] });
    await watchEpisode("101-s1e1", 10);
    for (let e = 1; e <= 4; e++) await watchEpisode(`101-s2e${e}`, 2);

    const detail = (await getShowDetail(TEST_USER_ID, "101"))!;
    expect(detail.ratingAverage).toBeCloseTo(6, 9);
    expect(detail.ratedCount).toBe(5);
    expect(detail.watchedEpisodeCount).toBe(5);
  });

  it("leaves a season with nothing rated out of the show average", async () => {
    await seedSeasonedShow({ seasons: [2, 2] });
    await watchEpisode("101-s1e1", 8);
    await watchEpisode("101-s2e1"); // watched, unrated

    const detail = (await getShowDetail(TEST_USER_ID, "101"))!;
    expect(detail.seasons[1].ratingAverage).toBeNull();
    expect(detail.seasons[1].ratedCount).toBe(0);
    expect(detail.seasons[1].watchedEpisodeCount).toBe(1);
    expect(detail.ratingAverage).toBe(8);
  });

  it("gives null averages and zero counts when nothing is rated", async () => {
    await seedSeasonedShow({ seasons: [2] });
    await watchEpisode("101-s1e1");

    const detail = (await getShowDetail(TEST_USER_ID, "101"))!;
    expect(detail.ratingAverage).toBeNull();
    expect(detail.ratedCount).toBe(0);
    expect(detail.watchedEpisodeCount).toBe(1);
    expect(detail.seasons[0].ratingAverage).toBeNull();
    expect(detail.seasons[0].ratedCount).toBe(0);
  });

  it("handles a single rated episode", async () => {
    await seedSeasonedShow({ seasons: [3, 2] });
    await watchEpisode("101-s2e2", 7);

    const detail = (await getShowDetail(TEST_USER_ID, "101"))!;
    expect(detail.ratingAverage).toBe(7);
    expect(detail.ratedCount).toBe(1);
    expect(detail.seasons[0].ratingAverage).toBeNull();
    expect(detail.seasons[1].ratingAverage).toBe(7);
  });
});

describe("getTrackedShows ratingAverage", () => {
  it("carries the average, and null for an unrated show", async () => {
    await seedSeasonedShow({ showId: "101", seasons: [1, 4] });
    await seedSeasonedShow({ showId: "102", seasons: [2] });
    await watchEpisode("101-s1e1", 10);
    for (let e = 1; e <= 4; e++) await watchEpisode(`101-s2e${e}`, 2);
    await watchEpisode("102-s1e1");

    const shows = await getTrackedShows(TEST_USER_ID);
    const byId = new Map(shows.map((s) => [s.showId, s.ratingAverage]));
    expect(byId.get("101")).toBeCloseTo(6, 9);
    expect(byId.get("102")).toBeNull();
  });
});

describe("detail and summary agree on the show average", () => {
  type Case = {
    name: string;
    seasons: number[];
    ratings: Record<string, number | null>;
    other?: Record<string, number | null>;
    seasonAverages: Array<number | null>;
  };

  const cases: Case[] = [
    {
      name: "several seasons of different sizes",
      seasons: [1, 5, 3],
      ratings: {
        "101-s1e1": 10,
        "101-s2e1": 2,
        "101-s2e2": 3,
        "101-s2e3": 4,
        "101-s2e4": 5,
        "101-s2e5": 6,
        "101-s3e1": 7,
        "101-s3e3": 8,
      },
      seasonAverages: [10, 4, 7.5],
    },
    {
      name: "one unrated season",
      seasons: [2, 3, 2],
      ratings: { "101-s1e1": 9, "101-s1e2": 8, "101-s2e1": null, "101-s3e2": 5 },
      seasonAverages: [8.5, null, 5],
    },
    {
      name: "none rated",
      seasons: [2, 2],
      ratings: { "101-s1e1": null, "101-s2e1": null },
      seasonAverages: [null, null],
    },
    {
      name: "a single rated episode",
      seasons: [4, 4],
      ratings: { "101-s2e3": 6 },
      seasonAverages: [null, 6],
    },
    {
      name: "another account rated the same show",
      seasons: [2, 3],
      ratings: { "101-s1e1": 4, "101-s2e1": 8 },
      other: { "101-s1e1": 10, "101-s1e2": 10, "101-s2e2": 1, "101-s2e3": 1 },
      seasonAverages: [4, 8],
    },
  ];

  it.each(cases)("$name", async ({ seasons, ratings, other, seasonAverages }) => {
    await seedSeasonedShow({ seasons });
    for (const [id, rating] of Object.entries(ratings)) {
      await watchEpisode(id, rating);
    }
    if (other) {
      await seedSeasonedShow({ seasons, userId: B });
      for (const [id, rating] of Object.entries(other)) {
        await watchEpisode(id, rating, B);
      }
    }

    const { detail, summary } = await both();

    detail.seasons.forEach((season, i) => {
      const expected = seasonAverages[i];
      if (expected === null) expect(season.ratingAverage).toBeNull();
      else expect(season.ratingAverage).toBeCloseTo(expected, 9);
    });

    const present = seasonAverages.filter((a): a is number => a !== null);
    if (present.length === 0) {
      expect(detail.ratingAverage).toBeNull();
      expect(summary.ratingAverage).toBeNull();
    } else {
      const expected = present.reduce((a, b) => a + b, 0) / present.length;
      expect(Math.abs(detail.ratingAverage! - summary.ratingAverage!)).toBeLessThan(1e-9);
      expect(detail.ratingAverage!).toBeCloseTo(expected, 9);
    }
  });
});
