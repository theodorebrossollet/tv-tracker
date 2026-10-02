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

const { startShowOver } = await import("@/app/rewatch-actions");
const { MAX_PAST_RUNS } = await import("@/lib/rewatch");
const { getListDetail, getShowBuckets, getTrackedShows } = await import(
  "@/lib/queries"
);
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
});
