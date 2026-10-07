import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  getMovieReleaseDates: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  describeError: (e: unknown) => ({
    errorMessage: e instanceof Error ? e.message : String(e),
  }),
}));

const tmdb = await import("@/lib/tmdb");
const { logger } = await import("@/lib/logger");
const {
  getUpcomingMovieCandidates,
  getUpcomingMovies,
  MAX_UPCOMING_MOVIES,
  nextReleases,
} = await import("@/lib/upcoming-movies");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedUser, TEST_USER_ID } = await import("./helpers");

import type { CountryReleases, ReleaseKind } from "@/lib/tmdb";

const NOW = new Date("2026-10-07T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);
const rel = (kind: ReleaseKind, inDays: number) => ({ kind, date: day(inDays) });
const country = (code: string, ...releases: ReturnType<typeof rel>[]): CountryReleases => ({
  code,
  releases,
});

describe("nextReleases", () => {
  it("uses the viewer's country, with the soonest first and the other kind second", () => {
    const found = nextReleases(
      [
        country("FR", rel("digital", 40), rel("cinema", 10)),
        country("US", rel("cinema", 3)),
      ],
      "FR",
      NOW,
    );

    expect(found).toEqual({
      next: rel("cinema", 10),
      later: rel("digital", 40),
      region: null,
    });
  });

  it("leaves out dates that have passed, and a movie with none ahead", () => {
    expect(
      nextReleases([country("FR", rel("cinema", -5), rel("digital", 20))], "FR", NOW),
    ).toEqual({ next: rel("digital", 20), later: null, region: null });

    expect(nextReleases([country("FR", rel("cinema", -5))], "FR", NOW)).toBeNull();
    expect(nextReleases([], "FR", NOW)).toBeNull();
  });

  it("treats a date earlier today as passed, like an episode that has aired", () => {
    const earlier = { kind: "cinema" as const, date: new Date(NOW.getTime() - 1000) };
    expect(nextReleases([{ code: "FR", releases: [earlier] }], "FR", NOW)).toBeNull();
  });

  it("falls back to the earliest of each kind anywhere, tagged with its country", () => {
    const found = nextReleases(
      [
        country("US", rel("cinema", 12), rel("digital", 50)),
        country("GB", rel("cinema", 8)),
        country("FR", rel("cinema", -3)),
      ],
      "FR",
      NOW,
    );

    // FR has nothing ahead, so the pool is worldwide: GB's cinema date beats
    // US's, and the digital date exists only in the US.
    expect(found).toEqual({
      next: rel("cinema", 8),
      later: rel("digital", 50),
      region: "GB",
    });
  });

  it("falls back worldwide when no country is chosen, and tags the region", () => {
    const found = nextReleases([country("US", rel("digital", 9))], null, NOW);
    expect(found).toEqual({ next: rel("digital", 9), later: null, region: "US" });
  });

  it("breaks a same-day tie by showing cinema first", () => {
    const found = nextReleases(
      [country("FR", rel("digital", 5), rel("cinema", 5))],
      "FR",
      NOW,
    );
    expect(found?.next.kind).toBe("cinema");
    expect(found?.later?.kind).toBe("digital");
  });

  it("keeps only the earliest date of a kind", () => {
    const found = nextReleases(
      [country("FR", rel("cinema", 30), rel("cinema", 10))],
      "FR",
      NOW,
    );
    expect(found).toEqual({ next: rel("cinema", 10), later: null, region: null });
  });
});

async function seedMovie(
  id: string,
  over: {
    userId?: string;
    status?: "watchlist" | "watched" | "not_interested";
    releaseDate?: Date | null;
    movieStatus?: string | null;
    title?: string;
  } = {},
) {
  await prisma.movie.upsert({
    where: { id },
    update: {},
    create: {
      id,
      title: over.title ?? `Movie ${id}`,
      releaseDate: over.releaseDate === undefined ? day(30) : over.releaseDate,
      status: over.movieStatus ?? null,
    },
  });
  await prisma.trackedMovie.create({
    data: { movieId: id, userId: over.userId ?? TEST_USER_ID, status: over.status ?? "watchlist" },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDatabase();
  await seedUser();
});

describe("getUpcomingMovieCandidates", () => {
  it("takes watchlist movies that are unreleased or recently released", async () => {
    await seedMovie("1", { releaseDate: day(60) }); // future
    await seedMovie("2", { releaseDate: day(-30) }); // recent
    await seedMovie("3", { releaseDate: day(-400) }); // long out
    await seedMovie("4", { releaseDate: day(-119) }); // inside the window
    await seedMovie("5", { releaseDate: day(-121) }); // just outside

    const ids = (await getUpcomingMovieCandidates(TEST_USER_ID, NOW)).map((c) => c.movieId);

    expect(ids.sort()).toEqual(["1", "2", "4"]);
  });

  it("takes an undated movie only when TMDB says it is not out yet", async () => {
    await seedMovie("10", { releaseDate: null, movieStatus: "In Production" });
    await seedMovie("11", { releaseDate: null, movieStatus: "Released" });
    await seedMovie("12", { releaseDate: null, movieStatus: null });

    const ids = (await getUpcomingMovieCandidates(TEST_USER_ID, NOW)).map((c) => c.movieId);

    expect(ids).toEqual(["10"]);
  });

  it("leaves out watched and not-interested movies", async () => {
    await seedMovie("20", { status: "watched" });
    await seedMovie("21", { status: "not_interested" });
    await seedMovie("22", { status: "watchlist" });

    const ids = (await getUpcomingMovieCandidates(TEST_USER_ID, NOW)).map((c) => c.movieId);

    expect(ids).toEqual(["22"]);
  });

  it("never includes another account's watchlist", async () => {
    await seedUser("other");
    await seedMovie("30", { userId: "other" });
    await seedMovie("31");

    const ids = (await getUpcomingMovieCandidates(TEST_USER_ID, NOW)).map((c) => c.movieId);

    expect(ids).toEqual(["31"]);
  });

  it("caps the number looked up", async () => {
    for (let i = 0; i < MAX_UPCOMING_MOVIES + 5; i++) {
      await seedMovie(String(100 + i), { releaseDate: day(10 + i) });
    }
    expect(await getUpcomingMovieCandidates(TEST_USER_ID, NOW)).toHaveLength(
      MAX_UPCOMING_MOVIES,
    );
  });
});

describe("getUpcomingMovies", () => {
  const dates = vi.mocked(tmdb.getMovieReleaseDates);

  it("returns the movies with a date ahead, soonest first, with the later kind", async () => {
    await seedMovie("1", { title: "Far" });
    await seedMovie("2", { title: "Near" });
    await seedMovie("3", { title: "Already out" });
    dates.mockImplementation(async (id) =>
      ({
        "1": [country("FR", rel("digital", 40))],
        "2": [country("FR", rel("cinema", 5), rel("digital", 30))],
        "3": [country("FR", rel("cinema", -10))],
      })[String(id)] ?? [],
    );

    const movies = await getUpcomingMovies(TEST_USER_ID, "FR", { now: NOW });

    expect(movies.map((m) => [m.title, m.next.kind, m.later?.kind ?? null])).toEqual([
      ["Near", "cinema", "digital"],
      ["Far", "digital", null],
    ]);
  });

  it("keeps the movies that worked when one lookup fails", async () => {
    await seedMovie("1", { title: "Works" });
    await seedMovie("2", { title: "Fails" });
    dates.mockImplementation(async (id) => {
      if (String(id) === "2") throw new tmdb.TmdbError("down");
      return [country("FR", rel("cinema", 5))];
    });

    const movies = await getUpcomingMovies(TEST_USER_ID, "FR", { now: NOW });

    expect(movies.map((m) => m.title)).toEqual(["Works"]);
    expect(logger.warn).toHaveBeenCalledWith(
      "upcoming.movie_dates_failed",
      expect.anything(),
    );
  });

  it("gives up on the movies after the timeout, without throwing", async () => {
    await seedMovie("1");
    dates.mockImplementation(() => new Promise(() => {}));

    const movies = await getUpcomingMovies(TEST_USER_ID, "FR", {
      now: NOW,
      timeoutMs: 20,
    });

    expect(movies).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "upcoming.movies_timeout",
      expect.anything(),
    );
  });

  it("asks TMDB nothing for an account with no candidates", async () => {
    expect(await getUpcomingMovies(TEST_USER_ID, "FR", { now: NOW })).toEqual([]);
    expect(dates).not.toHaveBeenCalled();
  });

  it("never looks up another account's movies", async () => {
    await seedUser("other");
    await seedMovie("40", { userId: "other" });
    dates.mockResolvedValue([country("FR", rel("cinema", 5))]);

    expect(await getUpcomingMovies(TEST_USER_ID, "FR", { now: NOW })).toEqual([]);
    expect(dates).not.toHaveBeenCalled();
  });
});
