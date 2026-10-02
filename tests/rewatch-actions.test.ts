import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The stubbed session's user can be switched, to act as a second account.
const session = vi.hoisted(() => ({ userId: "test-user" }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: session.userId, nickname: session.userId, hasPassword: true },
  })),
}));

const { resetMovieHistory, resetShowHistory, startShowOver, watchMovieAgain } =
  await import("@/app/rewatch-actions");
const { rateMovie } = await import("@/app/rating-actions");
const { MAX_PAST_RUNS, MAX_PAST_WATCHES } = await import("@/lib/rewatch");
const {
  getListDetail,
  getMovieDetail,
  getShowBuckets,
  getShowDetail,
  getTrackedShows,
} = await import("@/lib/queries");
const { revalidatePath } = await import("next/cache");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedShow, seedUser, statusOf, TEST_USER_ID, watchedCount } =
  await import("./helpers");

const OTHER = "other";
const NOTHING = { ok: false, error: "Nothing to start over." };

beforeEach(async () => {
  session.userId = TEST_USER_ID;
  vi.mocked(revalidatePath).mockClear();
  await resetDatabase();
  await seedUser();
});

function runsOf(showId = "101", userId = TEST_USER_ID) {
  return prisma.showRun.findMany({
    where: { userId, showId },
    orderBy: { runNumber: "asc" },
  });
}

describe("startShowOver", () => {
  it("archives exactly the caller's watches with date and rating, and clears them", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-3, -2, -1, 5],
      status: "watching",
    });
    const d1 = new Date("2026-01-02T03:04:05.000Z");
    const d2 = new Date("2026-02-03T04:05:06.000Z");
    await prisma.watchedEpisode.create({
      data: { userId: TEST_USER_ID, episodeId: episodeIds[0], watchedAt: d1, rating: 8 },
    });
    await prisma.watchedEpisode.create({
      data: { userId: TEST_USER_ID, episodeId: episodeIds[1], watchedAt: d2 },
    });

    expect(await startShowOver("101")).toEqual({ ok: true });

    const runs = await runsOf();
    expect(runs).toHaveLength(1);
    expect(runs[0].runNumber).toBe(1);
    expect(Math.abs(runs[0].archivedAt.getTime() - Date.now())).toBeLessThan(60_000);
    const archived = await prisma.archivedEpisodeWatch.findMany({
      where: { runId: runs[0].id },
      orderBy: { episodeId: "asc" },
    });
    expect(
      archived.map((a) => [a.episodeId, a.watchedAt.toISOString(), a.rating]),
    ).toEqual([
      [episodeIds[0], d1.toISOString(), 8],
      [episodeIds[1], d2.toISOString(), null],
    ]);
    expect(await watchedCount("101")).toBe(0);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("leaves other shows untouched", async () => {
    await seedShow({ showId: "101", offsets: [-2, -1], status: "watching", watched: [0] });
    await seedShow({ showId: "202", offsets: [-2, -1], status: "watching", watched: [0, 1] });

    await startShowOver("101");

    expect(await watchedCount("202")).toBe(2);
    expect(await runsOf("202")).toHaveLength(0);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(1);
  });

  it("leaves another account's marks on the same show alone and unarchived", async () => {
    await seedUser(OTHER);
    await seedShow({ offsets: [-2, -1], status: "watching", watched: [0] });
    await seedShow({ offsets: [-2, -1], status: "watching", watched: [0, 1], userId: OTHER });

    await startShowOver("101");

    expect(await watchedCount("101", OTHER)).toBe(2);
    expect(await statusOf("101", OTHER)).toBe("watching");
    expect(await runsOf("101", OTHER)).toHaveLength(0);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(1);
  });

  it("numbers runs 1 then 2", async () => {
    await seedShow({ offsets: [-2, -1], status: "watching", watched: [0] });
    await startShowOver("101");
    await prisma.watchedEpisode.create({
      data: { userId: TEST_USER_ID, episodeId: "101-e2" },
    });
    expect(await startShowOver("101")).toEqual({ ok: true });

    expect((await runsOf()).map((r) => r.runNumber)).toEqual([1, 2]);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(2);
  });

  it.each(["watching", "watchlist", "paused", "stopped"] as const)(
    "sets status watching from %s",
    async (status) => {
      await seedShow({ offsets: [-2, -1], status, watched: [0] });
      expect(await startShowOver("101")).toEqual({ ok: true });
      expect(await statusOf("101")).toBe("watching");
    },
  );

  it("moves a finished show back to Watching at zero progress, unrated", async () => {
    await seedShow({
      offsets: [-2, -1],
      status: "watching",
      watched: [0, 1],
      showStatus: "Ended",
    });
    await prisma.watchedEpisode.updateMany({ data: { rating: 9 } });
    expect((await getShowBuckets(TEST_USER_ID)).finished).toHaveLength(1);

    await startShowOver("101");

    const buckets = await getShowBuckets(TEST_USER_ID);
    expect(buckets.finished).toHaveLength(0);
    expect(buckets.watching.map((s) => s.showId)).toEqual(["101"]);
    expect(buckets.watching[0].watchedCount).toBe(0);
    const [summary] = await getTrackedShows(TEST_USER_ID);
    expect(summary.ratingAverage).toBeNull();
  });

  it("un-watches the show on a personal list", async () => {
    await seedShow({
      offsets: [-2, -1],
      status: "watching",
      watched: [0, 1],
      showStatus: "Ended",
    });
    const list = await prisma.list.create({
      data: { name: "L", userId: TEST_USER_ID },
    });
    await prisma.listItem.create({ data: { listId: list.id, showId: "101" } });
    const before = await getListDetail(TEST_USER_ID, list.id);
    expect(before!.items[0].watched).toBe(true);

    await startShowOver("101");

    const after = await getListDetail(TEST_USER_ID, list.id);
    expect(after!.items[0].watched).toBe(false);
  });

  it("refuses a show the caller doesn't track", async () => {
    await seedShow({ offsets: [-1], status: null });
    expect(await startShowOver("101")).toEqual({
      ok: false,
      error: "Show isn't on your lists.",
    });
    expect(await runsOf()).toHaveLength(0);
  });

  it("refuses when only another account tracks it", async () => {
    await seedUser(OTHER);
    await seedShow({ offsets: [-1], status: "watching", watched: [0], userId: OTHER });
    expect(await startShowOver("101")).toEqual({
      ok: false,
      error: "Show isn't on your lists.",
    });
    expect(await watchedCount("101", OTHER)).toBe(1);
    expect(await prisma.showRun.count()).toBe(0);
  });

  it("refuses a tracked show with nothing watched, and a second call in a row", async () => {
    await seedShow({ offsets: [-2, -1], status: "watching" });
    expect(await startShowOver("101")).toEqual(NOTHING);

    await prisma.watchedEpisode.create({
      data: { userId: TEST_USER_ID, episodeId: "101-e1" },
    });
    expect(await startShowOver("101")).toEqual({ ok: true });
    expect(await startShowOver("101")).toEqual(NOTHING);
    expect(await runsOf()).toHaveLength(1);
  });

  it("refuses malformed and non-string ids before touching the database", async () => {
    const spy = vi.spyOn(prisma, "$transaction");
    for (const bad of ["12/x", "", 101, null, undefined, {}]) {
      expect(await startShowOver(bad as unknown as string)).toEqual({
        ok: false,
        error: "Missing show id.",
      });
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("refuses a show already at the limit of past runs", async () => {
    await seedShow({ offsets: [-1], status: "watching", watched: [0] });
    for (let n = 1; n <= MAX_PAST_RUNS; n++) {
      await prisma.showRun.create({
        data: { userId: TEST_USER_ID, showId: "101", runNumber: n },
      });
    }

    const result = await startShowOver("101");

    expect(result).toEqual({
      ok: false,
      error: "This show has reached the limit of 20 past runs.",
    });
    expect(await watchedCount("101")).toBe(1);
    expect(await runsOf()).toHaveLength(MAX_PAST_RUNS);
  });

  it("is all or nothing: a failure after the archive insert rolls everything back", async () => {
    await seedShow({ offsets: [-2, -1], status: "paused", watched: [0, 1] });
    // Makes the DELETE (statement 3 of 4) fail, after the run and its archive
    // rows have been inserted in the same transaction.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "test_block_clear" BEFORE DELETE ON "WatchedEpisode"
       BEGIN SELECT RAISE(ABORT, 'forced failure'); END`,
    );
    try {
      const result = await startShowOver("101");
      expect(result.ok).toBe(false);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "test_block_clear"`);
    }

    expect(await watchedCount("101")).toBe(2);
    expect(await prisma.showRun.count()).toBe(0);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(0);
    expect(await statusOf("101")).toBe("paused");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("two concurrent calls make exactly one run", async () => {
    await seedShow({ offsets: [-2, -1], status: "paused", watched: [0, 1] });

    const results = await Promise.all([startShowOver("101"), startShowOver("101")]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([NOTHING]);
    expect(await runsOf()).toHaveLength(1);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(2);
    expect(await watchedCount("101")).toBe(0);
    expect(await statusOf("101")).toBe("watching");
  });

  it("two concurrent calls at 19 runs reach 20, not 21", async () => {
    await seedShow({ offsets: [-1], status: "watching", watched: [0] });
    for (let n = 1; n < MAX_PAST_RUNS; n++) {
      await prisma.showRun.create({
        data: { userId: TEST_USER_ID, showId: "101", runNumber: n },
      });
    }

    // Hold both calls after their pre-check count until each has passed it, so
    // both really reach the conditional insert believing there is room.
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = prisma.showRun.count.bind(prisma.showRun);
    const spy = vi
      .spyOn(prisma.showRun, "count")
      .mockImplementation((async (args: never) => {
        const n = await original(args);
        if (++entered === 2) release();
        await gate;
        return n;
      }) as never);

    const results = await Promise.all([startShowOver("101"), startShowOver("101")]);
    spy.mockRestore();

    expect(entered).toBe(2);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    // The winner's transaction clears the watches, so the loser finds nothing
    // left to archive (the other refusal, the limit, is the next test).
    expect(results.filter((r) => !r.ok)).toEqual([NOTHING]);
    expect(await runsOf()).toHaveLength(MAX_PAST_RUNS);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(1);
  });

  it("refuses at 20 runs in SQL even when the pre-check read a stale count", async () => {
    // Unlike the race above, the watch is still there, so only the
    // `c < MAX_PAST_RUNS` clause stands between this call and a 21st run.
    await seedShow({ offsets: [-1], status: "watching", watched: [0] });
    for (let n = 1; n <= MAX_PAST_RUNS; n++) {
      await prisma.showRun.create({
        data: { userId: TEST_USER_ID, showId: "101", runNumber: n },
      });
    }
    const spy = vi
      .spyOn(prisma.showRun, "count")
      .mockImplementationOnce((async () => MAX_PAST_RUNS - 1) as never);

    const result = await startShowOver("101");
    spy.mockRestore();

    expect(result).toEqual({
      ok: false,
      error: "This show has reached the limit of 20 past runs.",
    });
    expect(await runsOf()).toHaveLength(MAX_PAST_RUNS);
    expect(await watchedCount("101")).toBe(1);
  });

  it("creates no empty run when the last mark vanishes after the pre-check", async () => {
    await seedShow({ offsets: [-1], status: "paused", watched: [0] });
    const spy = vi
      .spyOn(prisma.watchedEpisode, "count")
      .mockImplementationOnce((async () => {
        await prisma.watchedEpisode.deleteMany();
        return 1;
      }) as never);

    const result = await startShowOver("101");
    spy.mockRestore();

    expect(result).toEqual(NOTHING);
    expect(await runsOf()).toHaveLength(0);
    expect(await statusOf("101")).toBe("paused");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

const FIRST = "2026-01-02T03:04:05.000Z";
const MARK_FIRST = { ok: false, error: "Mark it watched first." };

async function seedMovie({
  status = "watched",
  watchedAt = new Date(FIRST),
  rating = 7,
  userId = TEST_USER_ID,
}: {
  status?: string;
  watchedAt?: Date | null;
  rating?: number | null;
  userId?: string;
} = {}) {
  await prisma.movie.upsert({
    where: { id: "603" },
    create: { id: "603", title: "Movie 603" },
    update: {},
  });
  await prisma.trackedMovie.create({
    data: { userId, movieId: "603", status, watchedAt, rating },
  });
}

function pastOf(userId = TEST_USER_ID) {
  return prisma.pastMovieWatch.findMany({
    where: { userId, movieId: "603" },
    orderBy: { archivedAt: "asc" },
  });
}

function currentOf(userId = TEST_USER_ID) {
  return prisma.trackedMovie.findUniqueOrThrow({
    where: { userId_movieId: { userId, movieId: "603" } },
  });
}

async function seedPast(n: number) {
  for (let i = 0; i < n; i++) {
    await prisma.pastMovieWatch.create({
      data: { userId: TEST_USER_ID, movieId: "603", watchedAt: new Date(FIRST) },
    });
  }
}

describe("watchMovieAgain", () => {
  it("archives the stored date and rating, restarts the watch now, unrated", async () => {
    await seedMovie({ rating: 8 });

    expect(await watchMovieAgain("603")).toEqual({ ok: true });

    const past = await pastOf();
    expect(past).toHaveLength(1);
    expect(past[0].watchedAt.toISOString()).toBe(FIRST);
    expect(past[0].rating).toBe(8);
    expect(Math.abs(past[0].archivedAt.getTime() - Date.now())).toBeLessThan(60_000);
    const now = await currentOf();
    expect(now.status).toBe("watched");
    expect(now.rating).toBeNull();
    expect(Math.abs(now.watchedAt!.getTime() - Date.now())).toBeLessThan(5_000);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("archives an unrated watch as unrated", async () => {
    await seedMovie({ rating: null });
    await watchMovieAgain("603");
    expect((await pastOf())[0].rating).toBeNull();
  });

  it("two successive calls make two past watches, each as it was", async () => {
    await seedMovie({ rating: 8 });
    await watchMovieAgain("603");
    await prisma.trackedMovie.updateMany({ data: { rating: 5 } });
    const secondStart = (await currentOf()).watchedAt!;

    expect(await watchMovieAgain("603")).toEqual({ ok: true });

    const past = await pastOf();
    expect(past.map((p) => p.rating)).toEqual([8, 5]);
    expect(past[0].watchedAt.toISOString()).toBe(FIRST);
    expect(past[1].watchedAt.getTime()).toBe(secondStart.getTime());
  });

  it("leaves another account's watch of the same movie alone and unarchived", async () => {
    await seedUser(OTHER);
    await seedMovie({ rating: 8 });
    await seedMovie({ userId: OTHER, rating: 3 });

    await watchMovieAgain("603");

    const other = await currentOf(OTHER);
    expect(other.rating).toBe(3);
    expect(other.watchedAt!.toISOString()).toBe(FIRST);
    expect(await pastOf(OTHER)).toHaveLength(0);
    expect(await prisma.pastMovieWatch.count()).toBe(1);
  });

  it.each(["watchlist", "not_interested"])("refuses a %s movie", async (status) => {
    await seedMovie({ status, watchedAt: null, rating: null });
    expect(await watchMovieAgain("603")).toEqual(MARK_FIRST);
    expect(await prisma.pastMovieWatch.count()).toBe(0);
    expect((await currentOf()).status).toBe(status);
  });

  it("refuses an untracked movie, and one only another account has watched", async () => {
    expect(await watchMovieAgain("603")).toEqual(MARK_FIRST);
    await seedUser(OTHER);
    await seedMovie({ userId: OTHER });
    expect(await watchMovieAgain("603")).toEqual(MARK_FIRST);
    expect(await prisma.pastMovieWatch.count()).toBe(0);
    expect((await currentOf(OTHER)).watchedAt!.toISOString()).toBe(FIRST);
  });

  it("refuses malformed and non-string ids before touching the database", async () => {
    const spy = vi.spyOn(prisma, "$transaction");
    const find = vi.spyOn(prisma.trackedMovie, "findUnique");
    for (const bad of ["12/x", "", 603, null, undefined, {}]) {
      expect(await watchMovieAgain(bad as unknown as string)).toEqual({
        ok: false,
        error: "Missing movie id.",
      });
    }
    expect(spy).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    spy.mockRestore();
    find.mockRestore();
  });

  it("refuses a movie already at the limit of past watches", async () => {
    await seedMovie();
    await seedPast(MAX_PAST_WATCHES);

    expect(await watchMovieAgain("603")).toEqual({
      ok: false,
      error: "This movie has reached the limit of 20 past watches.",
    });

    expect(await prisma.pastMovieWatch.count()).toBe(MAX_PAST_WATCHES);
    const now = await currentOf();
    expect(now.rating).toBe(7);
    expect(now.watchedAt!.toISOString()).toBe(FIRST);
  });

  it("is all or nothing: a failure of the update rolls the archive back", async () => {
    await seedMovie({ rating: 8 });
    // Fails the UPDATE (statement 2 of 2) after the archive row was inserted.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "test_block_restart" BEFORE UPDATE ON "TrackedMovie"
       BEGIN SELECT RAISE(ABORT, 'forced failure'); END`,
    );
    try {
      expect((await watchMovieAgain("603")).ok).toBe(false);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "test_block_restart"`);
    }

    expect(await prisma.pastMovieWatch.count()).toBe(0);
    const now = await currentOf();
    expect(now.rating).toBe(8);
    expect(now.watchedAt!.toISOString()).toBe(FIRST);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("two concurrent calls at 19 past watches reach 20, not 21", async () => {
    await seedMovie({ rating: 8 });
    await seedPast(MAX_PAST_WATCHES - 1);
    // Hold both calls after their pre-check count until each has passed it, so
    // both really reach the conditional insert believing there is room.
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const original = prisma.pastMovieWatch.count.bind(prisma.pastMovieWatch);
    const spy = vi
      .spyOn(prisma.pastMovieWatch, "count")
      .mockImplementation((async (args: never) => {
        const n = await original(args);
        if (++entered === 2) release();
        await gate;
        return n;
      }) as never);

    const results = await Promise.all([watchMovieAgain("603"), watchMovieAgain("603")]);
    spy.mockRestore();

    expect(entered).toBe(2);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "This movie has reached the limit of 20 past watches." },
    ]);
    expect(await pastOf()).toHaveLength(MAX_PAST_WATCHES);
  });

  it("lets the movie rating be set on the new watch afterwards", async () => {
    await seedMovie({ rating: 8 });
    await watchMovieAgain("603");

    expect(await rateMovie("603", 9)).toEqual({ ok: true });

    expect((await currentOf()).rating).toBe(9);
    expect((await pastOf())[0].rating).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// Reset history
// ---------------------------------------------------------------------------

const RESET_NOTHING = { ok: false, error: "Nothing to reset." };

/** An archived run of `showId` holding one archived watch per episode id. */
async function seedRun(
  userId: string,
  showId: string,
  runNumber: number,
  episodeIds: string[],
) {
  const run = await prisma.showRun.create({
    data: { userId, showId, runNumber },
  });
  for (const episodeId of episodeIds) {
    await prisma.archivedEpisodeWatch.create({
      data: { runId: run.id, episodeId, watchedAt: new Date(FIRST), rating: 6 },
    });
  }
  return run;
}

async function rateAll(userId: string, rating: number) {
  await prisma.watchedEpisode.updateMany({ where: { userId }, data: { rating } });
}

describe("resetShowHistory", () => {
  it("deletes exactly the caller's watches, ratings and runs of that show, and nothing else", async () => {
    const { episodeIds } = await seedShow({
      showId: "101",
      offsets: [-3, -2, -1],
      status: "watching",
      watched: [0, 1],
    });
    await seedShow({
      showId: "202",
      offsets: [-2, -1],
      status: "watching",
      watched: [0, 1],
    });
    await rateAll(TEST_USER_ID, 9);
    await seedRun(TEST_USER_ID, "101", 1, [episodeIds[0], episodeIds[1]]);
    await seedRun(TEST_USER_ID, "101", 2, [episodeIds[2]]);
    await seedRun(TEST_USER_ID, "202", 1, ["202-e1"]);
    await seedMovie();
    const list = await prisma.list.create({
      data: { name: "L", userId: TEST_USER_ID },
    });
    await prisma.listItem.create({ data: { listId: list.id, showId: "101" } });

    expect(await resetShowHistory("101")).toEqual({ ok: true });

    expect(await watchedCount("101")).toBe(0);
    expect(await runsOf("101")).toHaveLength(0);
    // Both runs' archived rows went with them (cascade); only 202's is left.
    expect(await prisma.archivedEpisodeWatch.count()).toBe(1);
    expect(await prisma.episode.count({ where: { showId: "101" } })).toBe(3);
    // Everything of the other show, the movie and the list is as it was.
    expect(await watchedCount("202")).toBe(2);
    expect(
      await prisma.watchedEpisode.count({ where: { rating: 9 } }),
    ).toBe(2);
    expect(await runsOf("202")).toHaveLength(1);
    expect(await statusOf("202")).toBe("watching");
    expect(await prisma.trackedMovie.count()).toBe(1);
    expect(await prisma.listItem.count()).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("leaves another account's watches, ratings, runs and archived rows on the same show alone", async () => {
    await seedUser(OTHER);
    const { episodeIds } = await seedShow({
      offsets: [-2, -1],
      status: "watching",
      watched: [0],
    });
    await seedShow({
      offsets: [-2, -1],
      status: "watching",
      watched: [0, 1],
      userId: OTHER,
    });
    await rateAll(OTHER, 4);
    await seedRun(TEST_USER_ID, "101", 1, [episodeIds[0]]);
    await seedRun(OTHER, "101", 1, episodeIds);

    await resetShowHistory("101");

    expect(await watchedCount("101", OTHER)).toBe(2);
    expect(
      await prisma.watchedEpisode.count({ where: { userId: OTHER, rating: 4 } }),
    ).toBe(2);
    expect(await runsOf("101", OTHER)).toHaveLength(1);
    expect(await statusOf("101", OTHER)).toBe("watching");
    expect(await prisma.archivedEpisodeWatch.count()).toBe(2);
    expect(await watchedCount("101")).toBe(0);
    expect(await runsOf()).toHaveLength(0);
  });

  it("moves watching to watchlist, and leaves paused, stopped and watchlist alone", async () => {
    for (const [status, expected] of [
      ["watching", "watchlist"],
      ["paused", "paused"],
      ["stopped", "stopped"],
      ["watchlist", "watchlist"],
    ] as const) {
      await resetDatabase();
      await seedUser();
      await seedShow({ offsets: [-2, -1], status, watched: [0] });

      expect(await resetShowHistory("101")).toEqual({ ok: true });
      expect(await statusOf("101")).toBe(expected);
    }
  });

  it("does not change another account's status for the same show", async () => {
    await seedUser(OTHER);
    await seedShow({ offsets: [-1], status: "watching", watched: [0] });
    await seedShow({ offsets: [-1], status: "watching", watched: [0], userId: OTHER });

    await resetShowHistory("101");

    expect(await statusOf("101")).toBe("watchlist");
    expect(await statusOf("101", OTHER)).toBe("watching");
  });

  it("works on an untracked show and does not start tracking it", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-2, -1],
      status: null,
      watched: [0, 1],
    });
    await seedRun(TEST_USER_ID, "101", 1, [episodeIds[0]]);

    expect(await resetShowHistory("101")).toEqual({ ok: true });

    expect(await watchedCount("101")).toBe(0);
    expect(await runsOf()).toHaveLength(0);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(0);
    expect(await statusOf("101")).toBeNull();
  });

  it("works with past runs only, or current watches only", async () => {
    const { episodeIds } = await seedShow({ offsets: [-1], status: "paused" });
    await seedRun(TEST_USER_ID, "101", 1, episodeIds);
    expect(await resetShowHistory("101")).toEqual({ ok: true });
    expect(await runsOf()).toHaveLength(0);
    expect(await statusOf("101")).toBe("paused");

    await prisma.watchedEpisode.create({
      data: { userId: TEST_USER_ID, episodeId: episodeIds[0] },
    });
    expect(await resetShowHistory("101")).toEqual({ ok: true });
    expect(await watchedCount("101")).toBe(0);
  });

  it("refuses a show with no history, tracked or not, and writes nothing", async () => {
    await seedShow({ offsets: [-1], status: "watching" });
    const spy = vi.spyOn(prisma, "$transaction");

    expect(await resetShowHistory("101")).toEqual(RESET_NOTHING);
    expect(await resetShowHistory("999")).toEqual(RESET_NOTHING);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(await statusOf("101")).toBe("watching");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses when only another account has history, and leaves it", async () => {
    await seedUser(OTHER);
    const { episodeIds } = await seedShow({
      offsets: [-1],
      status: "watching",
      watched: [0],
      userId: OTHER,
    });
    await seedRun(OTHER, "101", 1, episodeIds);

    expect(await resetShowHistory("101")).toEqual(RESET_NOTHING);

    expect(await watchedCount("101", OTHER)).toBe(1);
    expect(await runsOf("101", OTHER)).toHaveLength(1);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(1);
  });

  it("refuses malformed and non-string ids before any database access", async () => {
    const tx = vi.spyOn(prisma, "$transaction");
    const watched = vi.spyOn(prisma.watchedEpisode, "count");
    const runs = vi.spyOn(prisma.showRun, "count");
    for (const bad of ["12/x", "", 101, null, undefined, {}]) {
      expect(await resetShowHistory(bad as unknown as string)).toEqual({
        ok: false,
        error: "Missing show id.",
      });
    }
    expect(tx).not.toHaveBeenCalled();
    expect(watched).not.toHaveBeenCalled();
    expect(runs).not.toHaveBeenCalled();
    tx.mockRestore();
    watched.mockRestore();
    runs.mockRestore();
  });

  it("refuses a second call right after the first", async () => {
    await seedShow({ offsets: [-1], status: "watching", watched: [0] });
    expect(await resetShowHistory("101")).toEqual({ ok: true });
    expect(await resetShowHistory("101")).toEqual(RESET_NOTHING);
    expect(await statusOf("101")).toBe("watchlist");
  });

  it("is all or nothing: a failure after the first statement rolls everything back", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-2, -1],
      status: "watching",
      watched: [0, 1],
    });
    await seedRun(TEST_USER_ID, "101", 1, episodeIds);
    // Statement 1 deletes the runs; this fails statement 2, the watch delete.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "test_block_reset" BEFORE DELETE ON "WatchedEpisode"
       BEGIN SELECT RAISE(ABORT, 'forced failure'); END`,
    );
    try {
      expect((await resetShowHistory("101")).ok).toBe(false);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "test_block_reset"`);
    }

    expect(await runsOf()).toHaveLength(1);
    expect(await prisma.archivedEpisodeWatch.count()).toBe(2);
    expect(await watchedCount("101")).toBe(2);
    expect(await statusOf("101")).toBe("watching");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("leaves the show reading as unwatched and unrated, with no past runs", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-2, -1],
      status: "watching",
      watched: [0, 1],
      showStatus: "Ended",
    });
    await rateAll(TEST_USER_ID, 9);
    await seedRun(TEST_USER_ID, "101", 1, episodeIds);

    await resetShowHistory("101");

    const buckets = await getShowBuckets(TEST_USER_ID);
    expect(buckets.finished).toHaveLength(0);
    expect(buckets.watching).toHaveLength(0);
    expect(buckets.watchlist.map((s) => s.showId)).toEqual(["101"]);
    expect(buckets.watchlist[0].watchedCount).toBe(0);
    const [summary] = await getTrackedShows(TEST_USER_ID);
    expect(summary.watchedCount).toBe(0);
    expect(summary.ratingAverage).toBeNull();
    const detail = await getShowDetail(TEST_USER_ID, "101");
    expect(detail!.pastRuns).toEqual([]);
    expect(detail!.watchedCount).toBe(0);
  });
});

describe("resetMovieHistory", () => {
  it("deletes the caller's past watches and sends a watched movie back to the watchlist, unrated and undated", async () => {
    await seedMovie({ rating: 8 });
    await seedPast(2);

    expect(await resetMovieHistory("603")).toEqual({ ok: true });

    expect(await pastOf()).toHaveLength(0);
    const now = await currentOf();
    expect(now.status).toBe("watchlist");
    expect(now.watchedAt).toBeNull();
    expect(now.rating).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    const detail = await getMovieDetail(TEST_USER_ID, "603");
    expect(detail!.status).toBe("watchlist");
    expect(detail!.pastWatches).toEqual([]);
  });

  it("works for a watched movie with no past watches", async () => {
    await seedMovie({ rating: 8 });
    expect(await resetMovieHistory("603")).toEqual({ ok: true });
    expect((await currentOf()).status).toBe("watchlist");
  });

  it("works for an untracked movie that has past watches, without tracking it", async () => {
    await prisma.movie.create({ data: { id: "603", title: "Movie 603" } });
    await seedPast(1);

    expect(await resetMovieHistory("603")).toEqual({ ok: true });

    expect(await pastOf()).toHaveLength(0);
    expect(await prisma.trackedMovie.count()).toBe(0);
  });

  it.each(["watchlist", "not_interested"])(
    "deletes past watches but leaves a %s movie as it is",
    async (status) => {
      await seedMovie({ status, watchedAt: null, rating: null });
      await seedPast(1);

      expect(await resetMovieHistory("603")).toEqual({ ok: true });

      expect(await pastOf()).toHaveLength(0);
      expect((await currentOf()).status).toBe(status);
    },
  );

  it.each(["watchlist", "not_interested"])(
    "refuses a %s movie with no past watches",
    async (status) => {
      await seedMovie({ status, watchedAt: null, rating: null });
      expect(await resetMovieHistory("603")).toEqual(RESET_NOTHING);
      expect((await currentOf()).status).toBe(status);
    },
  );

  it("leaves another account's watch, rating and past watches alone", async () => {
    await seedUser(OTHER);
    await seedMovie({ rating: 8 });
    await seedMovie({ userId: OTHER, rating: 3 });
    await seedPast(1);
    await prisma.pastMovieWatch.create({
      data: { userId: OTHER, movieId: "603", watchedAt: new Date(FIRST), rating: 5 },
    });

    await resetMovieHistory("603");

    const other = await currentOf(OTHER);
    expect(other.status).toBe("watched");
    expect(other.rating).toBe(3);
    expect(other.watchedAt!.toISOString()).toBe(FIRST);
    expect(await pastOf(OTHER)).toHaveLength(1);
    expect(await prisma.pastMovieWatch.count()).toBe(1);
  });

  it("leaves other movies alone", async () => {
    await seedMovie({ rating: 8 });
    await prisma.movie.create({ data: { id: "604", title: "Movie 604" } });
    await prisma.trackedMovie.create({
      data: { userId: TEST_USER_ID, movieId: "604", status: "watched", watchedAt: new Date(FIRST), rating: 6 },
    });
    await prisma.pastMovieWatch.create({
      data: { userId: TEST_USER_ID, movieId: "604", watchedAt: new Date(FIRST) },
    });

    await resetMovieHistory("603");

    const other = await prisma.trackedMovie.findUniqueOrThrow({
      where: { userId_movieId: { userId: TEST_USER_ID, movieId: "604" } },
    });
    expect(other.status).toBe("watched");
    expect(other.rating).toBe(6);
    expect(await prisma.pastMovieWatch.count({ where: { movieId: "604" } })).toBe(1);
  });

  it("refuses when only another account has history, and leaves it", async () => {
    await seedUser(OTHER);
    await seedMovie({ userId: OTHER, rating: 3 });
    await prisma.pastMovieWatch.create({
      data: { userId: OTHER, movieId: "603", watchedAt: new Date(FIRST) },
    });

    expect(await resetMovieHistory("603")).toEqual(RESET_NOTHING);

    expect((await currentOf(OTHER)).status).toBe("watched");
    expect(await pastOf(OTHER)).toHaveLength(1);
  });

  it("refuses an untracked movie with nothing at all", async () => {
    expect(await resetMovieHistory("603")).toEqual(RESET_NOTHING);
  });

  it("refuses malformed and non-string ids before any database access", async () => {
    const tx = vi.spyOn(prisma, "$transaction");
    const find = vi.spyOn(prisma.trackedMovie, "findUnique");
    const count = vi.spyOn(prisma.pastMovieWatch, "count");
    for (const bad of ["12/x", "", 603, null, undefined, {}]) {
      expect(await resetMovieHistory(bad as unknown as string)).toEqual({
        ok: false,
        error: "Missing movie id.",
      });
    }
    expect(tx).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    tx.mockRestore();
    find.mockRestore();
    count.mockRestore();
  });

  it("refuses a second call right after the first", async () => {
    await seedMovie({ rating: 8 });
    await seedPast(1);
    expect(await resetMovieHistory("603")).toEqual({ ok: true });
    expect(await resetMovieHistory("603")).toEqual(RESET_NOTHING);
  });

  it("is all or nothing: a failure of the update rolls the delete back", async () => {
    await seedMovie({ rating: 8 });
    await seedPast(2);
    // Fails statement 2 (the update) after the past watches were deleted.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "test_block_movie_reset" BEFORE UPDATE ON "TrackedMovie"
       BEGIN SELECT RAISE(ABORT, 'forced failure'); END`,
    );
    try {
      expect((await resetMovieHistory("603")).ok).toBe(false);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "test_block_movie_reset"`);
    }

    expect(await pastOf()).toHaveLength(2);
    const now = await currentOf();
    expect(now.status).toBe("watched");
    expect(now.rating).toBe(8);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
