import { beforeEach, describe, expect, it, vi } from "vitest";

// Server actions call revalidatePath, which needs a request scope that doesn't
// exist here. The cache behaviour isn't what these tests are about.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Every action now opens with requireOnboardedSession. Sessions and cookies
// have their own coverage in auth.test.ts; stubbing the gate here keeps these
// tests about the tracking rules rather than re-testing login. Note the gate
// itself is NOT bypassed in production by this — it is a test double.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: "test-user", nickname: "test-user", hasPassword: true },
  })),
}));

// addToWatchlist fetches from TMDB; the tracking rules are what's under test,
// so the sync is stubbed and the show is seeded directly instead.
vi.mock("@/lib/shows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shows")>()),
  syncShowFromTmdb: vi.fn(async () => ({ name: "Test Show", episodeCount: 0 })),
}));

const {
  addToWatchlist,
  markEpisodeWatched,
  unmarkEpisodeWatched,
  removeShow,
  setSeasonWatched,
} = await import("@/app/actions");

const { TEST_USER_ID, resetDatabase, seedShow, seedUser, statusOf, watchedCount } =
  await import("./helpers");

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("promotion to watching", () => {
  it("moves a watchlist show to watching when an episode is marked", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-10, -3],
      status: "watchlist",
    });

    await markEpisodeWatched(episodeIds[0]);

    expect(await statusOf("101")).toBe("watching");
  });

  it("tracks an untracked show when an episode is marked", async () => {
    // Marking an episode on a show you never added states intent more clearly
    // than pressing "+", so it should start tracking rather than silently
    // recording progress for a show on no list.
    const { episodeIds } = await seedShow({ offsets: [-10], status: null });

    await markEpisodeWatched(episodeIds[0]);

    expect(await statusOf("101")).toBe("watching");
  });

  it("keeps a show on watching when a further episode is marked", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-10, -3],
      status: "watching",
      watched: [0],
    });

    await markEpisodeWatched(episodeIds[1]);

    expect(await statusOf("101")).toBe("watching");
    expect(await watchedCount("101")).toBe(2);
  });
});

describe("demotion back to the watchlist", () => {
  it("returns a show to the watchlist when its last watched episode is undone", async () => {
    // The case that prompted this rule: marking an episode by mistake used to
    // strand the show under Watching with zero progress.
    const { episodeIds } = await seedShow({
      offsets: [-10, -3],
      status: "watching",
      watched: [0],
    });

    await unmarkEpisodeWatched(episodeIds[0]);

    expect(await statusOf("101")).toBe("watchlist");
    expect(await watchedCount("101")).toBe(0);
  });

  it("does not demote while other episodes remain watched", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-10, -3],
      status: "watching",
      watched: [0, 1],
    });

    await unmarkEpisodeWatched(episodeIds[0]);

    expect(await statusOf("101")).toBe("watching");
  });

  it("leaves an untracked show untracked rather than adding it", async () => {
    const { episodeIds } = await seedShow({ offsets: [-10], status: null });

    await unmarkEpisodeWatched(episodeIds[0]);

    expect(await statusOf("101")).toBeNull();
  });
});

describe("marking a whole season", () => {
  it("marks only episodes that have already aired", async () => {
    // Two aired, two upcoming.
    await seedShow({ offsets: [-10, -3, 3, 10], status: "watchlist" });

    await setSeasonWatched("101", 1, true);

    expect(await watchedCount("101")).toBe(2);
    expect(await statusOf("101")).toBe("watching");
  });

  it("does not double-count episodes that were already watched", async () => {
    // SQLite has no skipDuplicates, so this path filters by hand.
    await seedShow({
      offsets: [-10, -3, -1],
      status: "watching",
      watched: [0],
    });

    await setSeasonWatched("101", 1, true);

    expect(await watchedCount("101")).toBe(3);
  });

  it("unmarking a whole season demotes the show", async () => {
    await seedShow({
      offsets: [-10, -3],
      status: "watching",
      watched: [0, 1],
    });

    await setSeasonWatched("101", 1, false);

    expect(await watchedCount("101")).toBe(0);
    expect(await statusOf("101")).toBe("watchlist");
  });

  it("is a no-op for a season with nothing aired yet", async () => {
    await seedShow({ offsets: [3, 10], status: "watchlist" });

    await setSeasonWatched("101", 1, true);

    expect(await watchedCount("101")).toBe(0);
    // Nothing was watched, so nothing should have been promoted.
    expect(await statusOf("101")).toBe("watchlist");
  });
});

describe("adding and removing", () => {
  it("adds to the watchlist, not to watching", async () => {
    await seedShow({ showId: "1399", offsets: [-10], status: null });

    await addToWatchlist("1399");

    expect(await statusOf("1399")).toBe("watchlist");
  });

  it("does not demote a show already being watched", async () => {
    await seedShow({
      showId: "1399",
      offsets: [-10],
      status: "watching",
      watched: [0],
    });

    await addToWatchlist("1399");

    expect(await statusOf("1399")).toBe("watching");
  });

  it("rejects an id that isn't one, without reaching TMDB", async () => {
    // The injection case: this would otherwise be interpolated straight into a
    // TMDB request path, and cached as a Show row keyed by the raw string.
    const { syncShowFromTmdb } = await import("@/lib/shows");
    vi.mocked(syncShowFromTmdb).mockClear();

    const result = await addToWatchlist("1399/season/1");

    expect(result.ok).toBe(false);
    expect(syncShowFromTmdb).not.toHaveBeenCalled();
    expect(await statusOf("1399/season/1")).toBeNull();
  });

  it("every showId-taking action holds the id invariant, not just the TMDB ones", async () => {
    // These never reach TMDB, but their showId still flows into
    // revalidatePath — the guard is uniform on purpose (see removeShow).
    await seedShow({ offsets: [-10], status: "watching", watched: [0] });

    const { pauseShow, resumeShow, setSeasonWatched } = await import(
      "@/app/actions"
    );

    expect((await removeShow("101/../102")).ok).toBe(false);
    expect((await pauseShow("101/../102")).ok).toBe(false);
    expect((await resumeShow("101/../102")).ok).toBe(false);
    expect((await setSeasonWatched("101/../102", 1, true)).ok).toBe(false);

    // The real row is untouched by any of the rejected calls.
    expect(await statusOf("101")).toBe("watching");
  });

  it("removing untracks the show but keeps the cached episodes", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-10, -3],
      status: "watching",
      watched: [0],
    });

    await removeShow("101");

    expect(await statusOf("101")).toBeNull();

    const { prisma } = await import("@/lib/prisma");
    expect(await prisma.episode.count({ where: { showId: "101" } })).toBe(2);
    // Watch history rides on the tracked row being gone, not the cache.
    expect(episodeIds).toHaveLength(2);
  });
});

describe("pausing", () => {
  it("moves a watched show out of Watching without losing progress", async () => {
    await seedShow({ offsets: [-10, -3], status: "watching", watched: [0] });

    const { pauseShow } = await import("@/app/actions");
    expect((await pauseShow("101")).ok).toBe(true);

    expect(await statusOf("101")).toBe("paused");
    expect(await watchedCount("101")).toBe(1);
  });

  it("refuses to pause a show that was never started", async () => {
    // Pausing something on the watchlist is what the watchlist already means.
    await seedShow({ offsets: [-10], status: "watchlist" });

    const { pauseShow } = await import("@/app/actions");
    const result = await pauseShow("101");

    expect(result.ok).toBe(false);
    expect(await statusOf("101")).toBe("watchlist");
  });

  it("refuses to pause an untracked show rather than tracking it", async () => {
    await seedShow({ offsets: [-10], status: null });

    const { pauseShow } = await import("@/app/actions");

    expect((await pauseShow("101")).ok).toBe(false);
    expect(await statusOf("101")).toBeNull();
  });

  it("marking an episode un-pauses the show", async () => {
    // The implicit resume: watching something is the clearest possible signal
    // you've picked it back up.
    const { episodeIds } = await seedShow({
      offsets: [-10, -3],
      status: "paused",
      watched: [0],
    });

    await markEpisodeWatched(episodeIds[1]);

    expect(await statusOf("101")).toBe("watching");
  });

  it("resumes explicitly without marking anything watched", async () => {
    // Needed because resuming a show you're behind on shouldn't require
    // pretending you've watched an episode.
    await seedShow({ offsets: [-10, -3], status: "paused", watched: [0] });

    const { resumeShow } = await import("@/app/actions");
    expect((await resumeShow("101")).ok).toBe(true);

    expect(await statusOf("101")).toBe("watching");
    expect(await watchedCount("101")).toBe(1);
  });

  it("does not demote a paused show to the watchlist", async () => {
    // Demotion is scoped to "watching" so it can't silently undo an explicit
    // pause.
    const { episodeIds } = await seedShow({
      offsets: [-10],
      status: "paused",
      watched: [0],
    });

    await unmarkEpisodeWatched(episodeIds[0]);

    expect(await statusOf("101")).toBe("paused");
  });

  it("keeps paused shows out of the watching list", async () => {
    await seedShow({ showId: "w", offsets: [-1], status: "watching", watched: [0] });
    await seedShow({ showId: "p", offsets: [-1], status: "paused", watched: [0] });

    const { getTrackedShows } = await import("@/lib/queries");

    expect((await getTrackedShows(TEST_USER_ID, "watching")).map((s) => s.showId)).toEqual(["w"]);
    expect((await getTrackedShows(TEST_USER_ID, "paused")).map((s) => s.showId)).toEqual(["p"]);
  });
});

describe("stopping", () => {
  it("moves a watched show to stopped without losing progress", async () => {
    await seedShow({ offsets: [-10, -3], status: "watching", watched: [0] });

    const { stopShow } = await import("@/app/actions");
    expect((await stopShow("101")).ok).toBe(true);

    expect(await statusOf("101")).toBe("stopped");
    expect(await watchedCount("101")).toBe(1);
  });

  it("refuses to stop a show that was never started", async () => {
    await seedShow({ offsets: [-10], status: "watchlist" });

    const { stopShow } = await import("@/app/actions");

    expect((await stopShow("101")).ok).toBe(false);
    expect(await statusOf("101")).toBe("watchlist");
  });

  it("switches between paused and stopped without going via watching", async () => {
    // Changing your mind about the intent shouldn't need two steps.
    await seedShow({ offsets: [-10], status: "paused", watched: [0] });

    const { stopShow, pauseShow } = await import("@/app/actions");

    expect((await stopShow("101")).ok).toBe(true);
    expect(await statusOf("101")).toBe("stopped");

    expect((await pauseShow("101")).ok).toBe(true);
    expect(await statusOf("101")).toBe("paused");
  });

  it("marking an episode brings a stopped show back", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-10, -3],
      status: "stopped",
      watched: [0],
    });

    await markEpisodeWatched(episodeIds[1]);

    expect(await statusOf("101")).toBe("watching");
  });

  it("resumes a stopped show explicitly", async () => {
    await seedShow({ offsets: [-10], status: "stopped", watched: [0] });

    const { resumeShow } = await import("@/app/actions");
    expect((await resumeShow("101")).ok).toBe(true);

    expect(await statusOf("101")).toBe("watching");
  });

  it("keeps stopped shows out of upcoming episodes", async () => {
    await seedShow({ showId: "w", offsets: [5], status: "watching" });
    await seedShow({ showId: "s", offsets: [3], status: "stopped" });

    const { getUpcomingEpisodes } = await import("@/lib/queries");

    expect((await getUpcomingEpisodes(TEST_USER_ID)).map((e) => e.showId)).toEqual([
      "w",
    ]);
  });
});

describe("clearing all data", () => {
  // An invariant guard rather than a test of the transaction: the three
  // deletes now run as one, but on the success path the result is the same
  // either way. What is worth pinning is which tables it touches.
  it("wipes tracking data but keeps the cached show and episodes", async () => {
    await seedShow({ offsets: [-10, -3], status: "watching", watched: [0] });
    const { prisma } = await import("@/lib/prisma");
    await prisma.settings.create({
      data: { userId: TEST_USER_ID, country: "FR" },
    });

    const { clearAllData } = await import("@/app/actions");
    expect((await clearAllData()).ok).toBe(true);

    expect(await prisma.trackedShow.count()).toBe(0);
    expect(await prisma.watchedEpisode.count()).toBe(0);
    expect(await prisma.settings.count()).toBe(0);

    // Re-adding a show shouldn't have to re-download everything from TMDB.
    expect(await prisma.show.count()).toBe(1);
    expect(await prisma.episode.count()).toBe(2);
  });
});

describe("racing writes", () => {
  it("treats a lost add race as success, not as a failure", async () => {
    // Two clicks land together: the second one's findUnique still sees nothing,
    // then its create hits the unique constraint. The show is tracked either
    // way, so surfacing "Something went wrong" would be the actual bug.
    await seedShow({ showId: "1399", offsets: [-10], status: null });

    const { prisma } = await import("@/lib/prisma");
    const create = vi
      .spyOn(prisma.trackedShow, "create")
      .mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

    const result = await addToWatchlist("1399");

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();

    create.mockRestore();
  });

  it("still reports failures that aren't a lost race", async () => {
    await seedShow({ showId: "1399", offsets: [-10], status: null });

    const { prisma } = await import("@/lib/prisma");
    const create = vi
      .spyOn(prisma.trackedShow, "create")
      .mockRejectedValueOnce(new Error("disk is on fire"));

    const result = await addToWatchlist("1399");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Something went wrong. Please try again.");

    create.mockRestore();
  });
});
