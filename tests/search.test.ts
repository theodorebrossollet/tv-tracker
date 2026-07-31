import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Only the query handed to TMDB is under test here, so the request itself is
// stubbed. importOriginal keeps TmdbError, which actions.ts checks against.
vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  searchTvShows: vi.fn(async () => []),
}));

const { searchSuggestions } = await import("@/app/actions");
const { searchTvShows } = await import("@/lib/tmdb");
const { resetDatabase } = await import("./helpers");

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(searchTvShows).mockClear();
});

describe("search suggestions", () => {
  it("caps a pasted wall of text before it reaches TMDB", async () => {
    await searchSuggestions("a".repeat(5000));

    const [query] = vi.mocked(searchTvShows).mock.calls[0];
    expect(query.length).toBe(200);
  });

  it("passes an ordinary query through untouched", async () => {
    await searchSuggestions("  game of thrones  ");

    expect(searchTvShows).toHaveBeenCalledWith("game of thrones");
  });

  it("does not call TMDB for an empty query", async () => {
    expect(await searchSuggestions("   ")).toEqual({ results: [] });
    expect(searchTvShows).not.toHaveBeenCalled();
  });
});
