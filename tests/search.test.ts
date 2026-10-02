import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Actions open with requireOnboardedSession; sessions have their own coverage
// in auth.test.ts, so the gate is stubbed here rather than re-tested.
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: "test-user", nickname: "test-user", hasPassword: true },
  })),
}));

// Only the query handed to TMDB is under test here, so the request itself is
// stubbed. importOriginal keeps TmdbError, which actions.ts checks against.
vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  searchMulti: vi.fn(async () => []),
}));

const { searchSuggestions } = await import("@/app/actions");
const { searchMulti } = await import("@/lib/tmdb");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedShow, seedUser, TEST_USER_ID } = await import(
  "./helpers"
);

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  vi.mocked(searchMulti).mockClear();
});

describe("search suggestions", () => {
  it("caps a pasted wall of text before it reaches TMDB", async () => {
    await searchSuggestions("a".repeat(5000));

    const [query] = vi.mocked(searchMulti).mock.calls[0];
    expect(query.length).toBe(200);
  });

  it("passes an ordinary query through untouched", async () => {
    await searchSuggestions("  game of thrones  ");

    expect(searchMulti).toHaveBeenCalledWith("game of thrones");
  });

  it("does not call TMDB for an empty query", async () => {
    expect(await searchSuggestions("   ")).toEqual({ results: [] });
    expect(searchMulti).not.toHaveBeenCalled();
  });

  it("returns a show and a movie sharing an id, each with its own kind and status", async () => {
    // TMDB numbers shows and movies separately, so one id can be both. Each is
    // badged from its own table.
    await seedShow({ showId: "603", offsets: [-1], status: "watching" });
    await prisma.movie.create({ data: { id: "603", title: "The Matrix" } });
    await prisma.trackedMovie.create({
      data: { userId: TEST_USER_ID, movieId: "603", status: "watched" },
    });
    vi.mocked(searchMulti).mockResolvedValueOnce([
      { kind: "tv", id: 603, name: "Show", posterPath: null, overview: null, year: "2001" },
      { kind: "movie", id: 603, name: "Movie", posterPath: null, overview: null, year: "1999" },
      { kind: "movie", id: 7, name: "Other", posterPath: null, overview: null, year: null },
    ]);

    const { results } = await searchSuggestions("matrix");

    expect(results).toEqual([
      { kind: "tv", id: "603", name: "Show", posterPath: null, year: "2001", status: "watching" },
      { kind: "movie", id: "603", name: "Movie", posterPath: null, year: "1999", status: "watched" },
      { kind: "movie", id: "7", name: "Other", posterPath: null, year: null, status: null },
    ]);
  });

  it("still returns show results, with null movie statuses, when the movie lookup fails", async () => {
    // Defence in depth: if the Movie tables are missing (migration not yet
    // applied), search must keep working for shows.
    await seedShow({ showId: "603", offsets: [-1], status: "watching" });
    vi.mocked(searchMulti).mockResolvedValueOnce([
      { kind: "tv", id: 603, name: "Show", posterPath: null, overview: null, year: "2001" },
      { kind: "movie", id: 603, name: "Movie", posterPath: null, overview: null, year: "1999" },
    ]);
    vi.spyOn(prisma.trackedMovie, "findMany").mockRejectedValueOnce(
      new Error('relation "TrackedMovie" does not exist'),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const { results } = await searchSuggestions("matrix");

    expect(results).toEqual([
      { kind: "tv", id: "603", name: "Show", posterPath: null, year: "2001", status: "watching" },
      { kind: "movie", id: "603", name: "Movie", posterPath: null, year: "1999", status: null },
    ]);
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(" ");
    expect(logged).toContain("search.movie_status_failed");
    warn.mockRestore();
    error.mockRestore();
  });
});
