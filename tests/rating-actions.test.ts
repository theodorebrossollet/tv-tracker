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

const { rateMovie, rateEpisode } = await import("@/app/rating-actions");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedShow, seedUser, TEST_USER_ID } = await import(
  "./helpers"
);

const OTHER = "other";

async function seedMovie(
  status: string | null,
  { userId = TEST_USER_ID, rating = null as number | null, id = "603" } = {},
) {
  await prisma.movie.upsert({
    where: { id },
    create: { id, title: `Movie ${id}` },
    update: {},
  });
  if (status) {
    await prisma.trackedMovie.create({
      data: {
        userId,
        movieId: id,
        status,
        watchedAt: status === "watched" ? new Date() : null,
        rating,
      },
    });
  }
}

async function movieRating(userId = TEST_USER_ID, id = "603") {
  const row = await prisma.trackedMovie.findUnique({
    where: { userId_movieId: { userId, movieId: id } },
  });
  return row ? row.rating : "no row";
}

async function episodeRating(episodeId: string, userId = TEST_USER_ID) {
  const row = await prisma.watchedEpisode.findUnique({
    where: { userId_episodeId: { userId, episodeId } },
  });
  return row ? row.rating : "no row";
}

beforeEach(async () => {
  session.userId = TEST_USER_ID;
  await resetDatabase();
  await seedUser();
});

describe("rateMovie", () => {
  it("sets 1, sets 10 and clears with null on a watched movie", async () => {
    await seedMovie("watched");

    expect(await rateMovie("603", 1)).toEqual({ ok: true });
    expect(await movieRating()).toBe(1);
    expect(await rateMovie("603", 10)).toEqual({ ok: true });
    expect(await movieRating()).toBe(10);
    expect(await rateMovie("603", null)).toEqual({ ok: true });
    expect(await movieRating()).toBeNull();
  });

  it.each(["watchlist", "not_interested"])(
    "refuses a %s movie",
    async (status) => {
      await seedMovie(status);
      expect(await rateMovie("603", 5)).toEqual({
        ok: false,
        error: "Mark it watched first.",
      });
      expect(await movieRating()).toBeNull();
    },
  );

  it("refuses an untracked movie and creates no row", async () => {
    await seedMovie(null);
    expect(await rateMovie("603", 5)).toEqual({
      ok: false,
      error: "Mark it watched first.",
    });
    expect(await prisma.trackedMovie.count()).toBe(0);
  });

  it.each([0, 11, 5.5, "7", NaN, undefined, -1, Infinity])(
    "refuses the rating %s without touching the row",
    async (bad) => {
      await seedMovie("watched", { rating: 4 });
      expect(await rateMovie("603", bad as never)).toEqual({
        ok: false,
        error: "That rating isn't available.",
      });
      expect(await movieRating()).toBe(4);
    },
  );

  it.each(["12/x", "", 603, null, undefined])(
    "refuses the movie id %j",
    async (bad) => {
      await seedMovie("watched", { rating: 4 });
      expect(await rateMovie(bad as never, 5)).toEqual({
        ok: false,
        error: "Missing movie id.",
      });
      expect(await movieRating()).toBe(4);
      expect(await prisma.trackedMovie.count()).toBe(1);
    },
  );

  it("never touches another account's row for the same movie", async () => {
    await seedUser(OTHER);
    await seedMovie("watched", { rating: 3 });
    await seedMovie("watched", { userId: OTHER, rating: 8 });

    expect((await rateMovie("603", 9)).ok).toBe(true);
    expect(await movieRating(TEST_USER_ID)).toBe(9);
    expect(await movieRating(OTHER)).toBe(8);

    session.userId = OTHER;
    expect((await rateMovie("603", null)).ok).toBe(true);
    expect(await movieRating(OTHER)).toBeNull();
    expect(await movieRating(TEST_USER_ID)).toBe(9);
  });

  it("refuses a movie only another account tracks, leaving it unchanged", async () => {
    await seedUser(OTHER);
    await seedMovie("watched", { userId: OTHER, rating: 8 });

    expect(await rateMovie("603", 2)).toEqual({
      ok: false,
      error: "Mark it watched first.",
    });
    expect(await movieRating(OTHER)).toBe(8);
    expect(await movieRating(TEST_USER_ID)).toBe("no row");
  });
});

describe("rateEpisode", () => {
  it("sets 1, sets 10 and clears with null on a watched episode", async () => {
    const { episodeIds } = await seedShow({
      offsets: [-5],
      status: "watching",
      watched: [0],
    });
    const id = episodeIds[0];

    expect(await rateEpisode(id, 1)).toEqual({ ok: true });
    expect(await episodeRating(id)).toBe(1);
    expect(await rateEpisode(id, 10)).toEqual({ ok: true });
    expect(await episodeRating(id)).toBe(10);
    expect(await rateEpisode(id, null)).toEqual({ ok: true });
    expect(await episodeRating(id)).toBeNull();
  });

  it("refuses an unwatched episode and creates no row", async () => {
    const { episodeIds } = await seedShow({ offsets: [-5], status: "watching" });

    expect(await rateEpisode(episodeIds[0], 5)).toEqual({
      ok: false,
      error: "Mark it watched first.",
    });
    expect(await prisma.watchedEpisode.count()).toBe(0);
  });

  it("refuses an unknown id", async () => {
    expect(await rateEpisode("nope", 5)).toEqual({
      ok: false,
      error: "Mark it watched first.",
    });
    expect(await prisma.watchedEpisode.count()).toBe(0);
  });

  it("refuses another account's watched episode, leaving it unchanged", async () => {
    await seedUser(OTHER);
    const { episodeIds } = await seedShow({
      offsets: [-5],
      status: "watching",
      watched: [0],
      userId: OTHER,
    });
    await prisma.watchedEpisode.update({
      where: { userId_episodeId: { userId: OTHER, episodeId: episodeIds[0] } },
      data: { rating: 7 },
    });

    expect(await rateEpisode(episodeIds[0], 2)).toEqual({
      ok: false,
      error: "Mark it watched first.",
    });
    expect(await episodeRating(episodeIds[0], OTHER)).toBe(7);
    expect(await episodeRating(episodeIds[0])).toBe("no row");
  });

  it.each([0, 11, 5.5, "7", NaN, undefined])(
    "refuses the rating %s without touching the row",
    async (bad) => {
      const { episodeIds } = await seedShow({
        offsets: [-5],
        status: "watching",
        watched: [0],
      });
      await rateEpisode(episodeIds[0], 4);

      expect(await rateEpisode(episodeIds[0], bad as never)).toEqual({
        ok: false,
        error: "That rating isn't available.",
      });
      expect(await episodeRating(episodeIds[0])).toBe(4);
    },
  );

  it.each([101, "", "x".repeat(65), null, undefined, {}])(
    "refuses the episode id %j",
    async (bad) => {
      expect(await rateEpisode(bad as never, 5)).toEqual({
        ok: false,
        error: "Missing episode id.",
      });
    },
  );

  it("accepts an id of exactly 64 characters", async () => {
    // Valid length, but nothing watched under it.
    expect(await rateEpisode("x".repeat(64), 5)).toEqual({
      ok: false,
      error: "Mark it watched first.",
    });
  });
});
