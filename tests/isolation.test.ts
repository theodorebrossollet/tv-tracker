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

// Actions run as user A throughout; user B is the bystander whose data must
// never appear or change.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "session-a",
    user: { id: "user-a", nickname: "user-a", hasPassword: true },
  })),
}));

const { clearAllData, markEpisodeWatched, removeShow, setSeasonWatched } =
  await import("@/app/actions");
const { getShowBuckets, getShowDetail, getTrackedShows, getUpcomingEpisodes } =
  await import("@/lib/queries");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedShow, seedUser } = await import("./helpers");

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

  it("buckets each account independently", async () => {
    await seedShow({ showId: "500", offsets: [-1], status: "watching", watched: [0], userId: A });
    await seedShow({ showId: "500", offsets: [-1], status: "watchlist", userId: B });

    const forA = await getShowBuckets(A);
    const forB = await getShowBuckets(B);

    // Same show, two accounts, two different buckets.
    expect(forA.finished.map((s) => s.showId)).toEqual(["500"]);
    expect(forB.watchlist.map((s) => s.showId)).toEqual(["500"]);
    expect(forB.finished).toEqual([]);
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
