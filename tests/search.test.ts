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
  describe("with a listId", () => {
    const hits = () => [
      { kind: "tv" as const, id: 603, name: "Show", posterPath: null, overview: null, year: "2001" },
      { kind: "movie" as const, id: 603, name: "Movie", posterPath: null, overview: null, year: "1999" },
      { kind: "movie" as const, id: 7, name: "Other", posterPath: null, overview: null, year: null },
    ];
    const onListOf = (results: Array<{ kind: string; id: string; onList?: boolean }> | undefined) =>
      Object.fromEntries((results ?? []).map((r) => [`${r.kind}:${r.id}`, r.onList]));

    it("leaves results without an onList key when no listId is given", async () => {
      vi.mocked(searchMulti).mockResolvedValueOnce(hits());

      const { results } = await searchSuggestions("matrix");

      expect(results?.every((r) => !("onList" in r))).toBe(true);
    });

    it("marks a movie on the list without marking the show sharing its id", async () => {
      await prisma.movie.create({ data: { id: "603", title: "The Matrix" } });
      const list = await prisma.list.create({
        data: { userId: TEST_USER_ID, name: "Night", items: { create: { movieId: "603" } } },
      });
      vi.mocked(searchMulti).mockResolvedValueOnce(hits());

      const { results } = await searchSuggestions("matrix", list.id);

      expect(onListOf(results)).toEqual({ "tv:603": false, "movie:603": true, "movie:7": false });
    });

    it("marks a show on the list without marking the movie sharing its id", async () => {
      await seedShow({ showId: "603", offsets: [-1], status: "watching" });
      const list = await prisma.list.create({
        data: { userId: TEST_USER_ID, name: "Night", items: { create: { showId: "603" } } },
      });
      vi.mocked(searchMulti).mockResolvedValueOnce(hits());

      const { results } = await searchSuggestions("matrix", list.id);

      expect(onListOf(results)).toEqual({ "tv:603": true, "movie:603": false, "movie:7": false });
    });

    it("marks everything false for an empty list", async () => {
      const list = await prisma.list.create({ data: { userId: TEST_USER_ID, name: "Empty" } });
      vi.mocked(searchMulti).mockResolvedValueOnce(hits());

      const { results } = await searchSuggestions("matrix", list.id);

      expect(onListOf(results)).toEqual({ "tv:603": false, "movie:603": false, "movie:7": false });
    });

    it("refuses another user's list without calling TMDB", async () => {
      await seedUser("someone-else");
      const list = await prisma.list.create({ data: { userId: "someone-else", name: "Theirs" } });

      expect(await searchSuggestions("matrix", list.id)).toEqual({ error: "List not found." });
      expect(searchMulti).not.toHaveBeenCalled();
    });

    it("refuses unknown and malformed list ids without calling TMDB", async () => {
      for (const bad of ["no-such-list", "", "   ", 42 as unknown as string, { id: "x" } as unknown as string]) {
        expect(await searchSuggestions("matrix", bad)).toEqual({ error: "List not found." });
      }
      expect(searchMulti).not.toHaveBeenCalled();
    });

    it("refuses a foreign list even for an empty query", async () => {
      await seedUser("someone-else");
      const list = await prisma.list.create({ data: { userId: "someone-else", name: "Theirs" } });

      expect(await searchSuggestions("  ", list.id)).toEqual({ error: "List not found." });
    });

    it("surfaces a failing items lookup as an error rather than an empty list", async () => {
      const list = await prisma.list.create({ data: { userId: TEST_USER_ID, name: "Night" } });
      vi.mocked(searchMulti).mockResolvedValueOnce(hits());
      vi.spyOn(prisma.listItem, "findMany").mockRejectedValueOnce(new Error("boom"));
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await searchSuggestions("matrix", list.id);

      expect(result.results).toBeUndefined();
      expect(result.error).toBeTruthy();
      error.mockRestore();
    });
  });
});
