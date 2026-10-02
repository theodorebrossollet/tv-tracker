import { beforeEach, describe, expect, it, vi } from "vitest";

// Same doubles as status-transitions.test.ts: no request scope for
// revalidatePath, no session to build. TMDB is stubbed at getMovieDetails so
// the real caching code in movies.ts runs.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: "test-user", nickname: "test-user", hasPassword: true },
  })),
}));

vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  getMovieDetails: vi.fn(async (id: string) => ({
    id: Number(id),
    title: `Movie ${id}`,
    posterPath: null,
    overview: null,
    releaseDate: null,
    runtime: 100,
    status: "Released",
    genres: null,
  })),
}));

const { addMovieToWatchlist, setMovieStatus, removeMovie } = await import(
  "@/app/actions"
);
const { getMovieDetails, TmdbError } = await import("@/lib/tmdb");
const { movieStatusTargets } = await import("@/lib/movie-status");
const { NEW_MOVIES_PER_HOUR } = await import("@/lib/movies");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedShow, seedUser, TEST_USER_ID } = await import(
  "./helpers"
);

import type { MovieStatus } from "@/lib/types";

const OTHER = "other-user";

async function tracked(movieId: string, userId = TEST_USER_ID) {
  return prisma.trackedMovie.findUnique({
    where: { userId_movieId: { userId, movieId } },
  });
}

async function trackedCount(movieId: string) {
  return prisma.trackedMovie.count({ where: { movieId } });
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  vi.mocked(getMovieDetails).mockReset();
  vi.mocked(getMovieDetails).mockImplementation(async (id: string | number) => ({
    id: Number(id),
    title: `Movie ${id}`,
    posterPath: null,
    overview: null,
    releaseDate: null,
    runtime: 100,
    status: "Released",
    genres: null,
  }));
});

describe("addMovieToWatchlist", () => {
  it("caches the movie and puts it on the watchlist", async () => {
    expect(await addMovieToWatchlist("603")).toEqual({ ok: true });

    expect((await prisma.movie.findUnique({ where: { id: "603" } }))?.title).toBe(
      "Movie 603",
    );
    expect(await tracked("603")).toMatchObject({
      status: "watchlist",
      watchedAt: null,
    });
  });

  it("leaves one row when added twice, and doesn't demote a watched movie", async () => {
    await addMovieToWatchlist("603");
    await addMovieToWatchlist("603");
    expect(await trackedCount("603")).toBe(1);

    await setMovieStatus("603", "watched");
    await addMovieToWatchlist("603");
    expect((await tracked("603"))?.status).toBe("watched");
  });

  it("refuses a malformed id without calling TMDB", async () => {
    expect(await addMovieToWatchlist("12/x")).toEqual({
      ok: false,
      error: "Missing movie id.",
    });
    expect(getMovieDetails).not.toHaveBeenCalled();
    expect(await prisma.movie.count()).toBe(0);
  });

  it("is not confused by a tracked show with the same id", async () => {
    await seedShow({ showId: "603", offsets: [-1], status: "watching" });

    expect(await addMovieToWatchlist("603")).toEqual({ ok: true });
    expect((await tracked("603"))?.status).toBe("watchlist");
  });

  it("reports the movie allowance as an ordinary failure", async () => {
    await prisma.movie.createMany({
      data: Array.from({ length: NEW_MOVIES_PER_HOUR }, (_, i) => ({
        id: String(9000 + i),
        title: "x",
        addedById: TEST_USER_ID,
        createdAt: new Date(),
      })),
    });

    const result = await addMovieToWatchlist("603");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/new movies/);
    expect(await tracked("603")).toBeNull();
  });

  it("surfaces a TMDB failure as a message", async () => {
    vi.mocked(getMovieDetails).mockRejectedValueOnce(new TmdbError("nope", 500));

    expect(await addMovieToWatchlist("603")).toEqual({ ok: false, error: "nope" });
  });
});

// A TMDB double that yields to the event loop, so concurrent calls are all past
// their "already tracked?" check before any of them writes. Without the await
// the calls run back to back and these tests prove nothing.
function slowTmdb() {
  vi.mocked(getMovieDetails).mockImplementation(async (id: string | number) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      id: Number(id),
      title: `Movie ${id}`,
      posterPath: null,
      overview: null,
      releaseDate: null,
      runtime: 100,
      status: "Released",
      genres: null,
    };
  });
}

describe("concurrent adds", () => {
  it("treats a double-clicked add as one success", async () => {
    slowTmdb();

    const results = await Promise.all([
      addMovieToWatchlist("603"),
      addMovieToWatchlist("603"),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(await trackedCount("603")).toBe(1);
    // Both calls reached TMDB: they really did interleave past the check.
    expect(getMovieDetails).toHaveBeenCalledTimes(2);
  });

  it("treats a double-clicked mark-watched on an untracked movie as one success", async () => {
    slowTmdb();

    const results = await Promise.all([
      setMovieStatus("603", "watched"),
      setMovieStatus("603", "watched"),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(await trackedCount("603")).toBe(1);
    expect((await tracked("603"))?.status).toBe("watched");
    expect(getMovieDetails).toHaveBeenCalledTimes(2);
  });

  it("gives two accounts adding the same uncached movie one row each", async () => {
    await seedUser(OTHER);
    slowTmdb();
    const { requireOnboardedSession } = await import("@/lib/auth");
    // Calls are made in a fixed order, so alternate the identity per call.
    const users = [TEST_USER_ID, OTHER];
    let call = 0;
    vi.mocked(requireOnboardedSession).mockImplementation(async () => {
      const id = users[call++ % 2];
      return {
        sessionId: "s",
        user: { id, nickname: id, hasPassword: true },
      } as never;
    });

    try {
      const results = await Promise.all([
        addMovieToWatchlist("603"),
        addMovieToWatchlist("603"),
      ]);

      expect(results).toEqual([{ ok: true }, { ok: true }]);
      expect((await tracked("603"))?.status).toBe("watchlist");
      expect((await tracked("603", OTHER))?.status).toBe("watchlist");
      expect(await prisma.movie.count({ where: { id: "603" } })).toBe(1);
      expect(getMovieDetails).toHaveBeenCalledTimes(2);
    } finally {
      vi.mocked(requireOnboardedSession).mockImplementation(async () => ({
        sessionId: "test-session",
        user: { id: "test-user", nickname: "test-user", hasPassword: true },
      }));
    }
  });
});

describe("setMovieStatus", () => {
  const FROM: Array<MovieStatus | null> = [
    "watchlist",
    "watched",
    "not_interested",
  ];

  for (const from of FROM) {
    for (const to of movieStatusTargets(from)) {
      it(`moves a movie from ${from} to ${to}`, async () => {
        await addMovieToWatchlist("603");
        await prisma.trackedMovie.update({
          where: { userId_movieId: { userId: TEST_USER_ID, movieId: "603" } },
          data: {
            status: from!,
            watchedAt: from === "watched" ? new Date(0) : null,
          },
        });

        expect(await setMovieStatus("603", to)).toEqual({ ok: true });

        const row = await tracked("603");
        expect(row?.status).toBe(to);
        if (to === "watched") expect(row?.watchedAt).toBeInstanceOf(Date);
        else expect(row?.watchedAt).toBeNull();
      });
    }
  }

  it("caches an untracked movie and creates a watched row with watchedAt", async () => {
    expect(await setMovieStatus("603", "watched")).toEqual({ ok: true });

    expect(await prisma.movie.findUnique({ where: { id: "603" } })).not.toBeNull();
    const row = await tracked("603");
    expect(row?.status).toBe("watched");
    expect(row?.watchedAt).toBeInstanceOf(Date);
  });

  it("creates a watchlist row for an untracked movie", async () => {
    expect(await setMovieStatus("603", "watchlist")).toEqual({ ok: true });
    expect((await tracked("603"))?.status).toBe("watchlist");
  });

  it("refuses not_interested on an untracked movie", async () => {
    expect(await setMovieStatus("603", "not_interested")).toEqual({
      ok: false,
      error: "That change isn't available.",
    });
    expect(await tracked("603")).toBeNull();
    expect(getMovieDetails).not.toHaveBeenCalled();
  });

  it("refuses the status it is already in", async () => {
    await setMovieStatus("603", "watched");

    expect(await setMovieStatus("603", "watched")).toEqual({
      ok: false,
      error: "That change isn't available.",
    });
  });

  it("refuses a status movies don't have", async () => {
    await addMovieToWatchlist("603");

    expect(
      await setMovieStatus("603", "watching" as unknown as MovieStatus),
    ).toMatchObject({ ok: false });
    expect((await tracked("603"))?.status).toBe("watchlist");
  });

  it("refuses a malformed id without calling TMDB", async () => {
    expect(await setMovieStatus("12/x", "watched")).toMatchObject({ ok: false });
    expect(getMovieDetails).not.toHaveBeenCalled();
  });

  it("reports the allowance for an untracked uncached movie", async () => {
    vi.mocked(getMovieDetails).mockRejectedValueOnce(new TmdbError("down", 502));

    expect(await setMovieStatus("603", "watched")).toEqual({
      ok: false,
      error: "down",
    });
    expect(await tracked("603")).toBeNull();
  });

  it("only changes the caller's row", async () => {
    await seedUser(OTHER);
    await addMovieToWatchlist("603");
    await prisma.trackedMovie.create({
      data: { userId: OTHER, movieId: "603", status: "watchlist" },
    });

    await setMovieStatus("603", "watched");

    expect((await tracked("603"))?.status).toBe("watched");
    expect((await tracked("603", OTHER))?.status).toBe("watchlist");
  });
});

describe("removeMovie", () => {
  it("deletes only the caller's row", async () => {
    await seedUser(OTHER);
    await addMovieToWatchlist("603");
    await prisma.trackedMovie.create({
      data: { userId: OTHER, movieId: "603", status: "watched" },
    });

    expect(await removeMovie("603")).toEqual({ ok: true });

    expect(await tracked("603")).toBeNull();
    expect((await tracked("603", OTHER))?.status).toBe("watched");
    expect(await prisma.movie.findUnique({ where: { id: "603" } })).not.toBeNull();
  });

  it("refuses a malformed id", async () => {
    expect(await removeMovie("12/x")).toEqual({
      ok: false,
      error: "Missing movie id.",
    });
  });
});
