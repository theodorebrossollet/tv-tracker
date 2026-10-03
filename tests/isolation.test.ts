import { beforeEach, describe, expect, it, vi } from "vitest";

// The sharpest regression risk in v2: a forgotten `userId` filter leaks another
// account's data on a read and corrupts it on a write. Each test here is
// written so it FAILS against the mechanical version of the fix — the one that
// compiles and type-checks but drops the user from the filter.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/shows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shows")>()),
  syncShowFromTmdb: vi.fn(async () => ({ name: "Test Show", episodeCount: 0 })),
  ensureShowCached: vi.fn(async () => true),
}));

// `searchSuggestions` badges each result with the caller's own tracked status,
// which is a per-user read like any other. The TMDB half is stubbed; what is
// under test is which account's rows get attached to the results.
vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  searchMulti: vi.fn(async () => [
    {
      kind: "tv",
      id: 500,
      name: "Test Show",
      posterPath: null,
      overview: null,
      year: "2020",
    },
  ]),
}));

// Actions run as user A throughout; user B is the bystander whose data must
// never appear or change.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "session-a",
    user: { id: "user-a", nickname: "user-a", hasPassword: true },
  })),
}));

const {
  clearAllData,
  markEpisodeWatched,
  pauseShow,
  removeShow,
  resumeShow,
  searchSuggestions,
  setSeasonWatched,
  unmarkEpisodeWatched,
} = await import("@/app/actions");
const { getListDetail, getLists, getListsForTitle, getMovieBuckets, getMovieDetail, getShowBuckets, getShowDetail, getTrackedShows, getUpcomingEpisodes } =
  await import("@/lib/queries");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedSeasonedShow, seedShow, seedUser, statusOf, watchEpisode } =
  await import("./helpers");

const A = "user-a";
const B = "user-b";

beforeEach(async () => {
  await resetDatabase();
  await seedUser(A);
  await seedUser(B);
});

describe("reads never cross accounts", () => {
  it("keeps each account's tracked shows separate", async () => {
    await seedShow({ showId: "100", offsets: [-1], status: "watching", userId: A });
    await seedShow({ showId: "200", offsets: [-1], status: "watching", userId: B });

    expect((await getTrackedShows(A)).map((s) => s.showId)).toEqual(["100"]);
    expect((await getTrackedShows(B)).map((s) => s.showId)).toEqual(["200"]);
  });

  it("does not count another account's watch marks as progress", async () => {
    // One shared show, tracked by both. B has watched it; A has not.
    await seedShow({ showId: "500", offsets: [-2, -1], status: "watching", userId: A });
    await seedShow({
      showId: "500",
      offsets: [-2, -1],
      status: "watching",
      watched: [0, 1],
      userId: B,
    });

    const [forA] = await getTrackedShows(A);
    const [forB] = await getTrackedShows(B);

    // Without `where: { userId }` on the `watched` relation, A reads B's marks
    // and appears to have finished a show they've never started.
    expect(forA.watchedCount).toBe(0);
    expect(forA.fullyWatched).toBe(false);
    expect(forA.nextUnwatched).not.toBeNull();

    expect(forB.watchedCount).toBe(2);
    expect(forB.fullyWatched).toBe(true);
  });

  it("does not show upcoming episodes for a show only someone else tracks", async () => {
    // THE trap. `tracked: { some: { status } }` without userId compiles, type
    // checks, and puts B's show on A's home page.
    await seedShow({ showId: "200", offsets: [7], status: "watching", userId: B });

    expect(await getUpcomingEpisodes(A)).toEqual([]);
    expect((await getUpcomingEpisodes(B)).map((e) => e.showId)).toEqual(["200"]);
  });

  it("reports a shared show's tracked status per account", async () => {
    await seedShow({ showId: "500", offsets: [-1], status: "paused", userId: B });

    // A doesn't track it at all; B has it paused.
    expect((await getShowDetail(A, "500"))?.status).toBeNull();
    expect((await getShowDetail(B, "500"))?.status).toBe("paused");
  });

  it("resolves each episode's watched flag per account", async () => {
    // This is the one that shipped broken. `watched` is a relation *list*, so
    // `episode.watched !== null` is true for every episode — including
    // unwatched ones — and TypeScript accepts comparing an array to null. The
    // show page rendered every episode as watched, for everyone.
    await seedShow({ showId: "500", offsets: [-2, -1], status: "watching", watched: [0], userId: A });
    await seedShow({ showId: "500", offsets: [-2, -1], status: "watching", userId: B });

    const forA = await getShowDetail(A, "500");
    const forB = await getShowDetail(B, "500");

    expect(forA?.seasons[0].episodes.map((e) => e.watched)).toEqual([true, false]);
    expect(forB?.seasons[0].episodes.map((e) => e.watched)).toEqual([false, false]);
  });

  it("badges search results with the caller's own tracked status", async () => {
    // The suggestion list reads TrackedShow to decide what the "+" says. Drop
    // the userId and A is told they are already watching a show B tracks.
    await seedShow({ showId: "500", offsets: [-1], status: "watching", userId: B });

    const { results } = await searchSuggestions("test");

    expect(results).toMatchObject([{ id: "500", status: null }]);
  });

  it("buckets each account independently", async () => {
    await seedShow({ showId: "500", offsets: [-1], status: "watching", watched: [0],
                     showStatus: "Ended", userId: A });
    await seedShow({ showId: "500", offsets: [-1], status: "watchlist", userId: B });

    const forA = await getShowBuckets(A);
    const forB = await getShowBuckets(B);

    // Same show, two accounts, two different buckets.
    expect(forA.finished.map((s) => s.showId)).toEqual(["500"]);
    expect(forB.watchlist.map((s) => s.showId)).toEqual(["500"]);
    expect(forB.finished).toEqual([]);
  });
});

describe("movie reads never cross accounts", () => {
  it("keeps each account's movie lists separate", async () => {
    // One shared Movie row, two accounts, different statuses; plus a movie only
    // B tracks. Without `where: { userId }` A sees B's rows.
    await prisma.movie.createMany({
      data: [
        { id: "10", title: "Shared" },
        { id: "20", title: "Only B" },
      ],
    });
    await prisma.trackedMovie.createMany({
      data: [
        { movieId: "10", userId: A, status: "watchlist" },
        { movieId: "10", userId: B, status: "watched", watchedAt: new Date() },
        { movieId: "20", userId: B, status: "not_interested" },
      ],
    });

    const forA = await getMovieBuckets(A);
    const forB = await getMovieBuckets(B);

    expect(forA.watchlist.map((m) => m.movieId)).toEqual(["10"]);
    expect(forA.watched).toEqual([]);
    expect(forA.notInterested).toEqual([]);

    expect(forB.watchlist).toEqual([]);
    expect(forB.watched.map((m) => m.movieId)).toEqual(["10"]);
    expect(forB.notInterested.map((m) => m.movieId)).toEqual(["20"]);
  });
});

describe("writes never touch another account", () => {
  it("removes a shared show for the caller only", async () => {
    await seedShow({ showId: "500", offsets: [-1], status: "watching", userId: A });
    await seedShow({ showId: "500", offsets: [-1], status: "watching", userId: B });

    expect((await removeShow("500")).ok).toBe(true);

    await expect(
      prisma.trackedShow.findMany({ select: { userId: true } }),
    ).resolves.toEqual([{ userId: B }]);
  });

  it("marks an episode watched for the caller only", async () => {
    const { episodeIds } = await seedShow({
      showId: "500",
      offsets: [-1],
      status: "watching",
      userId: B,
    });

    expect((await markEpisodeWatched(episodeIds[0])).ok).toBe(true);

    await expect(
      prisma.watchedEpisode.findMany({ select: { userId: true } }),
    ).resolves.toEqual([{ userId: A }]);
  });

  it("clears only the caller's data", async () => {
    await seedShow({ showId: "100", offsets: [-1], status: "watching", watched: [0], userId: A });
    await seedShow({ showId: "200", offsets: [-1], status: "watching", watched: [0], userId: B });
    await prisma.settings.createMany({
      data: [
        { userId: A, country: "FR" },
        { userId: B, country: "GB" },
      ],
    });

    expect((await clearAllData()).ok).toBe(true);

    // B keeps everything. The `where` clauses are the only thing making this
    // "wipe my data" rather than "wipe everyone's".
    await expect(prisma.trackedShow.findMany({ select: { userId: true } })).resolves.toEqual([
      { userId: B },
    ]);
    await expect(prisma.watchedEpisode.findMany({ select: { userId: true } })).resolves.toEqual([
      { userId: B },
    ]);
    await expect(prisma.settings.findMany({ select: { userId: true } })).resolves.toEqual([
      { userId: B },
    ]);
  });

  it("demotes on the caller's own remaining progress, not the household's", async () => {
    // `demoteIfNothingWatched` counts what is left before sending a show back
    // to the watchlist, and that count runs through a relation
    // (`{ userId, episode: { showId } }`) — the shape this whole file exists
    // for. Without its userId, A unmarking their last episode finds B's mark,
    // decides there is progress left, and silently leaves A's show under
    // Watching with nothing watched: the exact stuck state the demotion rule
    // was written to fix.
    const { episodeIds } = await seedShow({
      showId: "500",
      offsets: [-1],
      status: "watching",
      watched: [0],
      userId: A,
    });
    await seedShow({
      showId: "500",
      offsets: [-1],
      status: "watching",
      watched: [0],
      userId: B,
    });

    expect((await unmarkEpisodeWatched(episodeIds[0])).ok).toBe(true);

    expect(await statusOf("500", A)).toBe("watchlist");
    // B watched nothing differently and must not be moved.
    expect(await statusOf("500", B)).toBe("watching");
  });

  it("sets aside and resumes a shared show for the caller only", async () => {
    await seedShow({ showId: "500", offsets: [-1], status: "watching", userId: A });
    await seedShow({ showId: "500", offsets: [-1], status: "watching", userId: B });

    expect((await pauseShow("500")).ok).toBe(true);
    expect(await statusOf("500", A)).toBe("paused");
    expect(await statusOf("500", B)).toBe("watching");

    expect((await resumeShow("500")).ok).toBe(true);
    expect(await statusOf("500", A)).toBe("watching");
    expect(await statusOf("500", B)).toBe("watching");
  });

  it("unmarks a season for the caller only", async () => {
    await seedShow({ showId: "500", offsets: [-2, -1], status: "watching", watched: [0, 1], userId: A });
    await seedShow({ showId: "500", offsets: [-2, -1], status: "watching", watched: [0, 1], userId: B });

    expect((await setSeasonWatched("500", 1, false)).ok).toBe(true);

    await expect(
      prisma.watchedEpisode.count({ where: { userId: A } }),
    ).resolves.toBe(0);
    await expect(
      prisma.watchedEpisode.count({ where: { userId: B } }),
    ).resolves.toBe(2);
  });
});

describe("list reads never cross accounts", () => {
  it("shows the caller's own tracking, not another account's", async () => {
    await prisma.movie.create({ data: { id: "9", title: "Nine" } });
    const list = await prisma.list.create({ data: { userId: A, name: "L" } });
    await prisma.listItem.create({ data: { listId: list.id, movieId: "9" } });
    await prisma.trackedMovie.create({
      data: { userId: B, movieId: "9", status: "watched" },
    });

    const detail = await getListDetail(A, list.id);
    expect(detail?.items[0]).toMatchObject({ status: null, watched: false });
  });

  it("does not take a show's finished state from another account", async () => {
    // The first seed creates the shared Show row (later upserts leave it
    // alone), so the series must be ended here for a leak to matter.
    await seedShow({
      showId: "500",
      offsets: [-1],
      status: "watching",
      showStatus: "Ended",
      userId: A,
    });
    await seedShow({
      showId: "500",
      offsets: [-1],
      status: "watching",
      watched: [0],
      userId: B,
    });
    const list = await prisma.list.create({ data: { userId: A, name: "L" } });
    await prisma.listItem.create({ data: { listId: list.id, showId: "500" } });

    const detail = await getListDetail(A, list.id);
    expect(detail?.items[0]).toMatchObject({
      status: "watching",
      finished: false,
      watched: false,
    });
  });

  it("hides another account's lists from every list read", async () => {
    const theirs = await prisma.list.create({ data: { userId: B, name: "T" } });
    await prisma.movie.create({ data: { id: "9", title: "Nine" } });
    await prisma.listItem.create({ data: { listId: theirs.id, movieId: "9" } });

    expect(await getLists(A)).toEqual([]);
    expect(await getListDetail(A, theirs.id)).toBeNull();
    expect(await getListsForTitle(A, "movie", "9")).toEqual([]);
  });
});

describe("rating reads never cross accounts", () => {
  it("keeps B's ratings out of A's episode ratings, averages and summary", async () => {
    await seedSeasonedShow({ showId: "300", seasons: [1, 3], userId: A });
    await seedSeasonedShow({ showId: "300", seasons: [1, 3], userId: B });
    await watchEpisode("300-s1e1", 4, A);
    await watchEpisode("300-s2e1", 8, A);
    await watchEpisode("300-s2e2", null, A);
    // B rates everything, differently, including episodes A has not watched.
    await watchEpisode("300-s1e1", 10, B);
    await watchEpisode("300-s2e1", 1, B);
    await watchEpisode("300-s2e2", 1, B);
    await watchEpisode("300-s2e3", 1, B);

    const detail = (await getShowDetail(A, "300"))!;
    expect(detail.seasons[0].episodes[0].rating).toBe(4);
    expect(detail.seasons[1].episodes.map((e) => e.rating)).toEqual([8, null, null]);
    expect(detail.seasons.map((s) => s.ratingAverage)).toEqual([4, 8]);
    expect(detail.seasons.map((s) => s.ratedCount)).toEqual([1, 1]);
    expect(detail.seasons.map((s) => s.watchedEpisodeCount)).toEqual([1, 2]);
    expect(detail.ratingAverage).toBe(6);
    expect(detail.ratedCount).toBe(2);

    const summary = (await getTrackedShows(A)).find((s) => s.showId === "300");
    expect(summary?.ratingAverage).toBe(6);
  });

  it("gives a user who rated nothing no average even if others rated", async () => {
    await seedSeasonedShow({ showId: "300", seasons: [2], userId: A });
    await seedSeasonedShow({ showId: "300", seasons: [2], userId: B });
    await watchEpisode("300-s1e1", 9, B);

    expect((await getShowDetail(A, "300"))!.ratingAverage).toBeNull();
    expect((await getTrackedShows(A))[0].ratingAverage).toBeNull();
  });
});

describe("movie and list ratings never cross accounts", () => {
  async function sharedMovie() {
    await prisma.movie.create({ data: { id: "9", title: "Nine" } });
    await prisma.trackedMovie.create({
      data: { userId: A, movieId: "9", status: "watched", rating: 4 },
    });
    await prisma.trackedMovie.create({
      data: { userId: B, movieId: "9", status: "watched", rating: 10 },
    });
  }

  it("keeps the movie rating per account in buckets and detail", async () => {
    await sharedMovie();
    expect((await getMovieBuckets(A)).watched[0].rating).toBe(4);
    expect((await getMovieBuckets(B)).watched[0].rating).toBe(10);
    expect((await getMovieDetail(A, "9"))!.rating).toBe(4);
    expect((await getMovieDetail(B, "9"))!.rating).toBe(10);
  });

  it("shows the caller's movie rating on a list, not another account's", async () => {
    await sharedMovie();
    await prisma.movie.create({ data: { id: "8", title: "Eight" } });
    await prisma.trackedMovie.create({
      data: { userId: B, movieId: "8", status: "watched", rating: 9 },
    });
    const list = await prisma.list.create({ data: { userId: A, name: "L" } });
    await prisma.listItem.create({ data: { listId: list.id, movieId: "9" } });
    await prisma.listItem.create({ data: { listId: list.id, movieId: "8" } });

    const byId = new Map(
      (await getListDetail(A, list.id))!.items.map((i) => [i.titleId, i.rating]),
    );
    expect(byId.get("9")).toBe(4);
    expect(byId.get("8")).toBeNull();
  });
});

describe("rewatch history reads never cross accounts", () => {
  it("keeps B's archived runs and past watches out of A's detail", async () => {
    await seedSeasonedShow({ showId: "310", seasons: [2], userId: A });
    await seedSeasonedShow({ showId: "310", seasons: [2], userId: B });
    const run = await prisma.showRun.create({
      data: { userId: B, showId: "310", runNumber: 1 },
    });
    await prisma.archivedEpisodeWatch.create({
      data: { runId: run.id, episodeId: "310-s1e1", watchedAt: new Date(), rating: 9 },
    });
    await prisma.movie.create({ data: { id: "311", title: "Shared" } });
    await prisma.pastMovieWatch.create({
      data: { userId: B, movieId: "311", watchedAt: new Date(), rating: 2 },
    });

    const forA = (await getShowDetail(A, "310"))!;
    expect(forA.pastRuns).toEqual([]);
    expect(forA.runNumber).toBe(1);
    expect((await getMovieDetail(A, "311"))!.pastWatches).toEqual([]);

    expect((await getShowDetail(B, "310"))!.pastRuns).toHaveLength(1);
    expect((await getMovieDetail(B, "311"))!.pastWatches).toHaveLength(1);
  });
});

describe("discover reads never cross accounts", () => {
  it("builds A's seeds and own titles from A's rows only", async () => {
    // B rated a shared show and a shared movie highly and has a watchlist.
    await seedSeasonedShow({ showId: "320", seasons: [1], userId: A });
    await seedSeasonedShow({ showId: "320", seasons: [1], userId: B });
    await watchEpisode("320-s1e1", 10, B);
    await prisma.movie.create({ data: { id: "321", title: "Shared" } });
    await prisma.trackedMovie.create({
      data: { userId: B, movieId: "321", status: "watched", rating: 10 },
    });
    await prisma.movie.create({ data: { id: "322", title: "B's pick" } });
    await prisma.trackedMovie.create({
      data: { userId: B, movieId: "322", status: "watchlist" },
    });
    const theirs = await prisma.list.create({ data: { userId: B, name: "T" } });
    await prisma.listItem.create({ data: { listId: theirs.id, movieId: "322" } });

    const { getDeck, getSeeds } = await import("@/lib/discover");
    const any = { kind: "any", short: false, listId: null } as const;

    expect(await getSeeds(A)).toEqual([]);
    expect(await getDeck(A, any)).toEqual({
      cards: [],
      seedCount: 0,
      recommendationsUnavailable: false,
    });
    expect((await getDeck(A, { ...any, listId: theirs.id })).cards).toEqual([]);

    expect((await getSeeds(B)).map((s) => s.id).sort()).toEqual(["320", "321"]);
  });
});
