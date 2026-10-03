import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRecommendations, getShowCast, TmdbError } from "@/lib/tmdb";

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getRecommendations", () => {
  it("maps a movie response", async () => {
    const fetchMock = mockFetch({
      results: [
        {
          id: 603,
          title: "The Matrix",
          poster_path: "/m.jpg",
          overview: "Neo.",
          release_date: "1999-03-30",
          vote_average: 8.2,
          vote_count: 25000,
        },
        { id: 604, title: "Bare", vote_average: 5, vote_count: 3 },
      ],
    });

    expect(await getRecommendations("movie", "1001")).toEqual([
      {
        kind: "movie",
        id: "603",
        name: "The Matrix",
        posterPath: "/m.jpg",
        overview: "Neo.",
        year: "1999",
        voteAverage: 8.2,
        voteCount: 25000,
      },
      {
        kind: "movie",
        id: "604",
        name: "Bare",
        posterPath: null,
        overview: null,
        year: null,
        voteAverage: 5,
        voteCount: 3,
      },
    ]);
    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/3/movie/1001/recommendations");
    expect(url.searchParams.get("language")).toBe("en-US");
  });

  it("maps a show response", async () => {
    const fetchMock = mockFetch({
      results: [
        {
          id: 1396,
          name: "Breaking Bad",
          poster_path: "/b.jpg",
          overview: "",
          first_air_date: "2008-01-20",
          vote_average: 8.9,
          vote_count: 12000,
        },
        { id: 2, name: "No date", first_air_date: "", vote_average: 0, vote_count: 0 },
      ],
    });

    const recs = await getRecommendations("show", "1002");

    expect(recs[0]).toEqual({
      kind: "show",
      id: "1396",
      name: "Breaking Bad",
      posterPath: "/b.jpg",
      overview: null,
      year: "2008",
      voteAverage: 8.9,
      voteCount: 12000,
    });
    expect(recs[1].year).toBeNull();
    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/3/tv/1002/recommendations");
  });

  it("rejects a malformed id before any fetch", async () => {
    const fetchMock = mockFetch({ results: [] });

    await expect(getRecommendations("movie", "1/credits")).rejects.toBeInstanceOf(
      TmdbError,
    );
    await expect(getRecommendations("show", "12?x=y")).rejects.toBeInstanceOf(
      TmdbError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves a second call within the TTL from the cache", async () => {
    const fetchMock = mockFetch({ results: [] });

    await getRecommendations("movie", "1003");
    await getRecommendations("movie", "1003");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejection", async () => {
    mockFetch({}, { ok: false, status: 500 });
    await expect(getRecommendations("show", "1004")).rejects.toBeInstanceOf(
      TmdbError,
    );

    const fetchMock = mockFetch({ results: [] });
    await expect(getRecommendations("show", "1004")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getShowCast", () => {
  it("returns at most ten, in billing order", async () => {
    const fetchMock = mockFetch({
      cast: Array.from({ length: 15 }, (_, i) => ({
        id: i,
        name: `P${i}`,
        character: i === 0 ? "" : `C${i}`,
        profile_path: i === 1 ? "/p.jpg" : null,
        order: 14 - i,
      })),
    });

    const cast = await getShowCast(2001);

    expect(cast).toHaveLength(10);
    expect(cast[0]).toEqual({ id: 14, name: "P14", character: "C14", profilePath: null });
    expect(cast.map((c) => c.id)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/3/tv/2001/credits");
    expect(url.searchParams.get("language")).toBe("en-US");
  });

  it("rejects a malformed id before any fetch", async () => {
    const fetchMock = mockFetch({ cast: [] });

    await expect(getShowCast("1/x")).rejects.toBeInstanceOf(TmdbError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches within the TTL", async () => {
    const fetchMock = mockFetch({ cast: [] });

    await getShowCast("2002");
    await getShowCast("2002");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
