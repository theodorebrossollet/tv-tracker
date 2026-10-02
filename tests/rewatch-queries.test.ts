import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/shows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shows")>()),
  ensureShowCached: vi.fn(async () => true),
}));

vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  getMovieDetails: vi.fn(async (id: string | number) => ({
    title: `Fetched ${id}`,
    posterPath: null,
    overview: null,
    releaseDate: null,
    runtime: null,
    genres: null,
  })),
}));

const { getMovieDetail, getShowDetail } = await import("@/lib/queries");
const { logger } = await import("@/lib/logger");
const { prisma } = await import("@/lib/prisma");
const { TEST_USER_ID, resetDatabase, seedSeasonedShow, seedUser } =
  await import("./helpers");

const B = "user-b";

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  await seedUser(B);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function archiveRun(
  userId: string,
  showId: string,
  runNumber: number,
  archivedAt: Date,
  watches: Array<{ episodeId: string; watchedAt: string; rating?: number }>,
) {
  const run = await prisma.showRun.create({
    data: { userId, showId, runNumber, archivedAt },
  });
  await prisma.archivedEpisodeWatch.createMany({
    data: watches.map((w) => ({
      runId: run.id,
      episodeId: w.episodeId,
      watchedAt: new Date(w.watchedAt),
      rating: w.rating ?? null,
    })),
  });
  return run;
}

describe("getShowDetail past runs", () => {
  it("lists archived runs newest first with dates, counts and averages", async () => {
    await seedSeasonedShow({ seasons: [1, 4] });
    // Run 1: S1 one episode rated 10, S2 four rated 2. Mean of season means is
    // 6; mean of all episodes would be 3.6.
    await archiveRun(TEST_USER_ID, "101", 1, new Date("2025-03-01T00:00:00Z"), [
      { episodeId: "101-s1e1", watchedAt: "2025-01-05T10:00:00Z", rating: 10 },
      { episodeId: "101-s2e1", watchedAt: "2025-01-06T10:00:00Z", rating: 2 },
      { episodeId: "101-s2e2", watchedAt: "2025-01-07T10:00:00Z", rating: 2 },
      { episodeId: "101-s2e3", watchedAt: "2025-01-08T10:00:00Z", rating: 2 },
      { episodeId: "101-s2e4", watchedAt: "2025-01-09T10:00:00Z", rating: 2 },
    ]);
    // Run 2: no ratings at all.
    await archiveRun(TEST_USER_ID, "101", 2, new Date("2025-09-01T00:00:00Z"), [
      { episodeId: "101-s2e1", watchedAt: "2025-06-02T10:00:00Z" },
      { episodeId: "101-s1e1", watchedAt: "2025-06-01T10:00:00Z" },
    ]);

    const detail = (await getShowDetail(TEST_USER_ID, "101"))!;
    expect(detail.runNumber).toBe(3);
    expect(detail.pastRuns).toEqual([
      {
        runNumber: 2,
        archivedAt: new Date("2025-09-01T00:00:00Z"),
        firstWatchedAt: new Date("2025-06-01T10:00:00Z"),
        lastWatchedAt: new Date("2025-06-02T10:00:00Z"),
        episodeCount: 2,
        ratingAverage: null,
      },
      {
        runNumber: 1,
        archivedAt: new Date("2025-03-01T00:00:00Z"),
        firstWatchedAt: new Date("2025-01-05T10:00:00Z"),
        lastWatchedAt: new Date("2025-01-09T10:00:00Z"),
        episodeCount: 5,
        ratingAverage: 6,
      },
    ]);
  });

  it("averages a run rated in only one season over that season alone", async () => {
    await seedSeasonedShow({ seasons: [2, 3] });
    await archiveRun(TEST_USER_ID, "101", 1, new Date("2025-03-01T00:00:00Z"), [
      { episodeId: "101-s1e1", watchedAt: "2025-01-05T10:00:00Z" },
      { episodeId: "101-s2e1", watchedAt: "2025-01-06T10:00:00Z", rating: 4 },
      { episodeId: "101-s2e2", watchedAt: "2025-01-07T10:00:00Z", rating: 7 },
    ]);

    const run = (await getShowDetail(TEST_USER_ID, "101"))!.pastRuns![0];
    expect(run.ratingAverage).toBeCloseTo(5.5, 9);
    expect(run.episodeCount).toBe(3);
  });

  it("reports a run with no archived rows as empty", async () => {
    await seedSeasonedShow({ seasons: [1] });
    await archiveRun(TEST_USER_ID, "101", 1, new Date("2025-03-01T00:00:00Z"), []);

    const run = (await getShowDetail(TEST_USER_ID, "101"))!.pastRuns![0];
    expect(run).toMatchObject({
      firstWatchedAt: null,
      lastWatchedAt: null,
      episodeCount: 0,
      ratingAverage: null,
    });
  });

  it("returns no runs and run number 1 for a show never started over", async () => {
    await seedSeasonedShow({ seasons: [2] });
    const detail = (await getShowDetail(TEST_USER_ID, "101"))!;
    expect(detail.pastRuns).toEqual([]);
    expect(detail.runNumber).toBe(1);
  });

  it("never shows another account's runs on the same show", async () => {
    await seedSeasonedShow({ seasons: [2], userId: TEST_USER_ID });
    await seedSeasonedShow({ seasons: [2], userId: B });
    await archiveRun(B, "101", 1, new Date("2025-03-01T00:00:00Z"), [
      { episodeId: "101-s1e1", watchedAt: "2025-01-05T10:00:00Z", rating: 9 },
    ]);
    await archiveRun(B, "101", 2, new Date("2025-04-01T00:00:00Z"), []);

    const detail = (await getShowDetail(TEST_USER_ID, "101"))!;
    expect(detail.pastRuns).toEqual([]);
    expect(detail.runNumber).toBe(1);
    expect((await getShowDetail(B, "101"))!.runNumber).toBe(3);
  });

  it("degrades to pastRuns null and logs when the run read fails", async () => {
    await seedSeasonedShow({ seasons: [2] });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(prisma.showRun, "findMany").mockRejectedValueOnce(
      new Error("no such table: ShowRun"),
    );

    const detail = (await getShowDetail(TEST_USER_ID, "101"))!;
    expect(detail.pastRuns).toBeNull();
    expect(detail.runNumber).toBe(1);
    expect(detail.name).toBe("Seasoned Show");
    expect(detail.seasons).toHaveLength(1);
    expect(detail.airedCount).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      "rewatch.past_runs_failed",
      expect.objectContaining({ errorMessage: "no such table: ShowRun" }),
    );
  });
});

async function seedMovie(id = "9") {
  await prisma.movie.create({ data: { id, title: "Movie" } });
  return id;
}

describe("getMovieDetail past watches", () => {
  it("lists past watches newest first with ratings or null", async () => {
    const id = await seedMovie();
    await prisma.trackedMovie.create({
      data: { userId: TEST_USER_ID, movieId: id, status: "watched", watchedAt: new Date() },
    });
    await prisma.pastMovieWatch.createMany({
      data: [
        { userId: TEST_USER_ID, movieId: id, watchedAt: new Date("2023-01-01T00:00:00Z"), rating: 7 },
        { userId: TEST_USER_ID, movieId: id, watchedAt: new Date("2024-06-01T00:00:00Z") },
      ],
    });

    const detail = (await getMovieDetail(TEST_USER_ID, id))!;
    expect(detail.pastWatches).toEqual([
      { watchedAt: new Date("2024-06-01T00:00:00Z"), rating: null },
      { watchedAt: new Date("2023-01-01T00:00:00Z"), rating: 7 },
    ]);
  });

  it("returns an empty list when there are none", async () => {
    const id = await seedMovie();
    expect((await getMovieDetail(TEST_USER_ID, id))!.pastWatches).toEqual([]);
  });

  it("returns an empty list for an uncached movie", async () => {
    expect((await getMovieDetail(TEST_USER_ID, "777"))!.pastWatches).toEqual([]);
  });

  it("never includes another account's past watches", async () => {
    const id = await seedMovie();
    await prisma.pastMovieWatch.create({
      data: { userId: B, movieId: id, watchedAt: new Date("2023-01-01T00:00:00Z"), rating: 3 },
    });
    expect((await getMovieDetail(TEST_USER_ID, id))!.pastWatches).toEqual([]);
    expect((await getMovieDetail(B, id))!.pastWatches).toHaveLength(1);
  });

  it("degrades to pastWatches null and logs when the read fails", async () => {
    const id = await seedMovie();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(prisma.pastMovieWatch, "findMany").mockRejectedValueOnce(
      new Error("no such table: PastMovieWatch"),
    );

    const detail = (await getMovieDetail(TEST_USER_ID, id))!;
    expect(detail.pastWatches).toBeNull();
    expect(detail.title).toBe("Movie");
    expect(warn).toHaveBeenCalledWith(
      "rewatch.past_watches_failed",
      expect.objectContaining({ errorMessage: "no such table: PastMovieWatch" }),
    );
  });
});
