import { beforeEach, describe, expect, it } from "vitest";

const { getMovieBuckets } = await import("@/lib/queries");
const { prisma } = await import("@/lib/prisma");
const { TEST_USER_ID, resetDatabase, seedUser } = await import("./helpers");

const at = (iso: string) => new Date(iso);

async function seedMovie(
  id: string,
  status: "watchlist" | "watched" | "not_interested",
  opts: { addedAt?: string; watchedAt?: string; title?: string } = {},
) {
  await prisma.movie.upsert({
    where: { id },
    update: {},
    create: {
      id,
      title: opts.title ?? `Movie ${id}`,
      releaseDate: at("2020-05-01T00:00:00Z"),
      runtime: 100,
    },
  });
  await prisma.trackedMovie.create({
    data: {
      movieId: id,
      userId: TEST_USER_ID,
      status,
      addedAt: opts.addedAt ? at(opts.addedAt) : undefined,
      watchedAt: opts.watchedAt ? at(opts.watchedAt) : null,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
});

describe("getMovieBuckets", () => {
  it("is empty for an account with no movies", async () => {
    expect(await getMovieBuckets(TEST_USER_ID)).toEqual({
      watchlist: [],
      watched: [],
      notInterested: [],
    });
  });

  it("files each movie under its status", async () => {
    await seedMovie("1", "watchlist");
    await seedMovie("2", "watched", { watchedAt: "2026-01-01T00:00:00Z" });
    await seedMovie("3", "not_interested");

    const b = await getMovieBuckets(TEST_USER_ID);
    expect(b.watchlist.map((m) => m.movieId)).toEqual(["1"]);
    expect(b.watched.map((m) => m.movieId)).toEqual(["2"]);
    expect(b.notInterested.map((m) => m.movieId)).toEqual(["3"]);
  });

  it("sorts the watchlist and not interested by newest added first", async () => {
    await seedMovie("1", "watchlist", { addedAt: "2026-01-01T00:00:00Z" });
    await seedMovie("2", "watchlist", { addedAt: "2026-03-01T00:00:00Z" });
    await seedMovie("3", "watchlist", { addedAt: "2026-02-01T00:00:00Z" });
    await seedMovie("4", "not_interested", { addedAt: "2026-01-01T00:00:00Z" });
    await seedMovie("5", "not_interested", { addedAt: "2026-02-01T00:00:00Z" });

    const b = await getMovieBuckets(TEST_USER_ID);
    expect(b.watchlist.map((m) => m.movieId)).toEqual(["2", "3", "1"]);
    expect(b.notInterested.map((m) => m.movieId)).toEqual(["5", "4"]);
  });

  it("sorts watched by newest watchedAt, not addedAt", async () => {
    await seedMovie("1", "watched", {
      addedAt: "2026-03-01T00:00:00Z",
      watchedAt: "2026-01-01T00:00:00Z",
    });
    await seedMovie("2", "watched", {
      addedAt: "2026-01-01T00:00:00Z",
      watchedAt: "2026-02-01T00:00:00Z",
    });

    const b = await getMovieBuckets(TEST_USER_ID);
    expect(b.watched.map((m) => m.movieId)).toEqual(["2", "1"]);
  });

  it("carries the fields a row renders", async () => {
    await seedMovie("1", "watched", {
      title: "Heat",
      watchedAt: "2026-01-01T00:00:00Z",
    });

    const [m] = (await getMovieBuckets(TEST_USER_ID)).watched;
    expect(m).toMatchObject({
      movieId: "1",
      title: "Heat",
      posterPath: null,
      runtime: 100,
      status: "watched",
    });
    expect(m.releaseDate).toEqual(at("2020-05-01T00:00:00Z"));
    expect(m.watchedAt).toEqual(at("2026-01-01T00:00:00Z"));
    expect(m.addedAt).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// getMovieDetail
// ---------------------------------------------------------------------------

import { vi } from "vitest";

vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  getMovieDetails: vi.fn(),
}));

const { getMovieDetail } = await import("@/lib/queries");
const tmdb = await import("@/lib/tmdb");
const getMovieDetailsMock = vi.mocked(tmdb.getMovieDetails);

describe("getMovieDetail", () => {
  beforeEach(() => {
    getMovieDetailsMock.mockReset();
  });

  it("returns the cached row with this user's status", async () => {
    await seedMovie("10", "watched", {
      watchedAt: "2026-02-02T00:00:00Z",
      title: "Cached",
    });

    const detail = await getMovieDetail(TEST_USER_ID, "10");
    expect(detail).toMatchObject({
      id: "10",
      title: "Cached",
      status: "watched",
      watchedAt: at("2026-02-02T00:00:00Z"),
      runtime: 100,
    });
    expect(getMovieDetailsMock).not.toHaveBeenCalled();
  });

  it("ignores another user's tracked row", async () => {
    await seedUser("someone-else");
    await prisma.movie.create({ data: { id: "11", title: "Shared" } });
    await prisma.trackedMovie.create({
      data: { movieId: "11", userId: "someone-else", status: "watched" },
    });

    const detail = await getMovieDetail(TEST_USER_ID, "11");
    expect(detail).toMatchObject({ id: "11", status: null, watchedAt: null });
  });

  it("falls back to TMDB for an uncached id without writing a Movie row", async () => {
    getMovieDetailsMock.mockResolvedValue({
      id: 12,
      title: "Fresh",
      posterPath: "/p.jpg",
      overview: "Plot",
      releaseDate: at("2024-03-01T00:00:00Z"),
      runtime: 90,
      status: "Released",
      genres: "Drama",
    });

    const detail = await getMovieDetail(TEST_USER_ID, "12");
    expect(detail).toEqual({
      id: "12",
      title: "Fresh",
      posterPath: "/p.jpg",
      overview: "Plot",
      releaseDate: at("2024-03-01T00:00:00Z"),
      runtime: 90,
      genres: "Drama",
      status: null,
      watchedAt: null,
      rating: null,
    });
    expect(await prisma.movie.count()).toBe(0);
  });

  it("returns null when TMDB says 404", async () => {
    getMovieDetailsMock.mockRejectedValue(new tmdb.TmdbError("nope", 404));
    expect(await getMovieDetail(TEST_USER_ID, "13")).toBeNull();
  });

  it("rethrows any other TMDB failure", async () => {
    getMovieDetailsMock.mockRejectedValue(new tmdb.TmdbError("down", 500));
    await expect(getMovieDetail(TEST_USER_ID, "14")).rejects.toThrow("down");

    getMovieDetailsMock.mockRejectedValue(new Error("network"));
    await expect(getMovieDetail(TEST_USER_ID, "15")).rejects.toThrow("network");
  });
});
