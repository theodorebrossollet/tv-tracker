import { beforeEach, describe, expect, it, vi } from "vitest";

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
  getMovieExtras: vi.fn(),
  getMovieDetails: vi.fn(),
  getShowDetails: vi.fn(),
  getShowCast: vi.fn(),
  getShowTrailer: vi.fn(),
  getWatchProviders: vi.fn(),
  getMovieWatchProviders: vi.fn(),
}));

const tmdb = await import("@/lib/tmdb");
const { loadCardDetails } = await import("@/app/discover-actions");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedUser, TEST_USER_ID } = await import("./helpers");

const cast = [
  { id: 1, name: "Keanu Reeves", character: "Neo", profilePath: null },
];
const provider = (name: string) => ({ id: 1, name, logoPath: null });
const availability = (code: string, names: string[]) => ({
  code,
  link: null,
  flatrate: names.map(provider),
  free: [],
  rent: [provider("Rentable")],
  buy: [],
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDatabase();
  await seedUser();
  vi.mocked(tmdb.getMovieExtras).mockResolvedValue({
    tagline: null,
    score: null,
    voteCount: 0,
    collection: null,
    directors: [],
    cast,
    trailer: { key: "abc", name: "Trailer", type: "Trailer" },
  });
  vi.mocked(tmdb.getMovieDetails).mockResolvedValue({
    id: 603,
    title: "The Matrix",
    posterPath: null,
    overview: "A hacker learns.",
    releaseDate: null,
    runtime: 136,
    status: null,
    genres: "Action, Science Fiction",
  });
  vi.mocked(tmdb.getShowDetails).mockResolvedValue({
    id: 1399,
    name: "Show",
    posterPath: null,
    overview: "A show.",
    seasonNumbers: [1],
    firstAirDate: null,
    lastAirDate: null,
    status: null,
    network: null,
    genres: "Drama",
  });
  vi.mocked(tmdb.getShowCast).mockResolvedValue(cast);
  vi.mocked(tmdb.getShowTrailer).mockResolvedValue({
    key: "xyz",
    name: "T",
    type: "Trailer",
  });
  vi.mocked(tmdb.getWatchProviders).mockResolvedValue([
    availability("FR", ["Netflix"]),
    availability("US", ["Hulu", "Max"]),
  ]);
  vi.mocked(tmdb.getMovieWatchProviders).mockResolvedValue([
    availability("FR", ["Canal"]),
    availability("US", ["Peacock"]),
  ]);
});

async function setCountry(country: string | null) {
  await prisma.settings.upsert({
    where: { userId: TEST_USER_ID },
    create: { userId: TEST_USER_ID, country },
    update: { country },
  });
}

describe("loadCardDetails", () => {
  it("maps a movie", async () => {
    const result = await loadCardDetails("movie", "603");

    expect(result).toEqual({
      ok: true,
      details: {
        overview: "A hacker learns.",
        genres: "Action, Science Fiction",
        runtime: 136,
        cast: [{ id: 1, name: "Keanu Reeves", character: "Neo" }],
        trailerKey: "abc",
        providers: [],
      },
    });
  });

  it("maps a show with a null runtime and the country's flatrate providers", async () => {
    await setCountry("US");

    const result = await loadCardDetails("show", "1399");

    expect(result).toEqual({
      ok: true,
      details: {
        overview: "A show.",
        genres: "Drama",
        runtime: null,
        cast: [{ id: 1, name: "Keanu Reeves", character: "Neo" }],
        trailerKey: "xyz",
        providers: ["Hulu", "Max"],
      },
    });
  });

  it("maps a movie's flatrate providers for the saved country", async () => {
    await setCountry("US");

    const result = await loadCardDetails("movie", "603");

    expect(result.details?.providers).toEqual(["Peacock"]);
    expect(tmdb.getMovieWatchProviders).toHaveBeenCalledWith("603");
    // A movie must not read the show lookup (TMDB movie and TV ids overlap).
    expect(tmdb.getWatchProviders).not.toHaveBeenCalled();
  });

  it("has no movie providers without a saved country, or for an unlisted one", async () => {
    expect((await loadCardDetails("movie", "603")).details?.providers).toEqual(
      [],
    );
    await setCountry("JP");
    expect((await loadCardDetails("movie", "603")).details?.providers).toEqual(
      [],
    );
  });

  it("keeps the rest of the details when the streaming lookup fails", async () => {
    await setCountry("US");
    vi.mocked(tmdb.getMovieWatchProviders).mockRejectedValue(
      new tmdb.TmdbError("down"),
    );
    vi.mocked(tmdb.getWatchProviders).mockRejectedValue(
      new tmdb.TmdbError("down"),
    );

    const movie = await loadCardDetails("movie", "603");
    const show = await loadCardDetails("show", "1399");

    expect(movie.ok).toBe(true);
    expect(movie.details?.overview).toBe("A hacker learns.");
    expect(movie.details?.providers).toEqual([]);
    expect(show.ok).toBe(true);
    expect(show.details?.providers).toEqual([]);
  });

  it("limits providers to the saved country", async () => {
    await setCountry("FR");

    const result = await loadCardDetails("show", "1399");

    expect(result.details?.providers).toEqual(["Netflix"]);
  });

  it("has no providers without a saved country, or for an unlisted one", async () => {
    expect((await loadCardDetails("show", "1399")).details?.providers).toEqual(
      [],
    );
    await setCountry("JP");
    expect((await loadCardDetails("show", "1399")).details?.providers).toEqual(
      [],
    );
  });

  it("refuses bad input before calling TMDB", async () => {
    for (const [kind, id] of [
      ["tv", "1399"],
      ["", "1399"],
      ["movie", "abc"],
      ["show", "12; drop"],
      ["movie", "1234567890123"],
      ["movie", ""],
    ]) {
      expect((await loadCardDetails(kind, id)).ok).toBe(false);
    }

    expect(tmdb.getMovieExtras).not.toHaveBeenCalled();
    expect(tmdb.getMovieDetails).not.toHaveBeenCalled();
    expect(tmdb.getShowDetails).not.toHaveBeenCalled();
    expect(tmdb.getShowCast).not.toHaveBeenCalled();
    expect(tmdb.getWatchProviders).not.toHaveBeenCalled();
    expect(tmdb.getMovieWatchProviders).not.toHaveBeenCalled();
  });

  it("returns a failure rather than throwing when TMDB fails", async () => {
    vi.mocked(tmdb.getMovieExtras).mockRejectedValue(new tmdb.TmdbError("boom"));
    vi.mocked(tmdb.getShowDetails).mockRejectedValue(new Error("boom"));

    expect(await loadCardDetails("movie", "603")).toEqual({
      ok: false,
      error: "Couldn't load details.",
    });
    expect(await loadCardDetails("show", "1399")).toEqual({
      ok: false,
      error: "Couldn't load details.",
    });
  });
});
