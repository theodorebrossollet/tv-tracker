import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSeasonEpisodes,
  getShowTrailer,
  getWatchProviderList,
  getWatchProviders,
  searchTvShows,
  TmdbError,
} from "@/lib/tmdb";

/** Replaces global fetch with one that returns `body` for every call. */
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

describe("air date anchoring", () => {
  const episode = (airDate: string) => ({
    episodes: [
      {
        id: 1,
        season_number: 1,
        episode_number: 1,
        name: "Ep",
        air_date: airDate,
        runtime: 45,
        overview: "text",
      },
    ],
  });

  it("treats a summer date as midnight EDT (UTC-4)", async () => {
    mockFetch(episode("2026-07-30"));

    const [ep] = await getSeasonEpisodes("1", 1);

    expect(ep.airDate?.toISOString()).toBe("2026-07-30T04:00:00.000Z");
  });

  it("treats a winter date as midnight EST (UTC-5)", async () => {
    mockFetch(episode("2026-01-15"));

    const [ep] = await getSeasonEpisodes("2", 1);

    expect(ep.airDate?.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("handles the spring daylight-saving switchover", async () => {
    // 8 Mar 2026 is the day US clocks go forward, but midnight that day is
    // still EST.
    mockFetch(episode("2026-03-08"));

    const [ep] = await getSeasonEpisodes("3", 1);

    expect(ep.airDate?.toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  it("keeps the broadcast date when read back in UTC", async () => {
    // The UI formats air dates in UTC, so the conversion must not shift the
    // displayed day.
    mockFetch(episode("2026-07-30"));

    const [ep] = await getSeasonEpisodes("4", 1);

    expect(ep.airDate?.toISOString().slice(0, 10)).toBe("2026-07-30");
  });

  it("returns null for a missing air date", async () => {
    mockFetch(episode(""));

    const [ep] = await getSeasonEpisodes("5", 1);

    expect(ep.airDate).toBeNull();
  });
});

describe("authentication", () => {
  it("sends a v4 read token as a Bearer header", async () => {
    vi.stubEnv("TMDB_API_KEY", "aaa.bbb.ccc");
    const fetchMock = mockFetch({ results: [] });

    await searchTvShows("anything");

    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      URL,
      { headers: Record<string, string> },
    ];
    expect(options.headers.Authorization).toBe("Bearer aaa.bbb.ccc");
    expect(url.searchParams.has("api_key")).toBe(false);

    vi.unstubAllEnvs();
  });

  it("sends a v3 key as a query parameter", async () => {
    vi.stubEnv("TMDB_API_KEY", "0123456789abcdef");
    const fetchMock = mockFetch({ results: [] });

    await searchTvShows("anything");

    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      URL,
      { headers: Record<string, string> },
    ];
    expect(url.searchParams.get("api_key")).toBe("0123456789abcdef");
    expect(options.headers.Authorization).toBeUndefined();

    vi.unstubAllEnvs();
  });
});

describe("error handling", () => {
  it("explains a rejected key rather than surfacing a bare 401", async () => {
    mockFetch({}, { ok: false, status: 401 });

    await expect(searchTvShows("x")).rejects.toThrow(/rejected the API key/);
  });

  it("preserves a 404 status so callers can render not-found", async () => {
    mockFetch({}, { ok: false, status: 404 });

    await expect(searchTvShows("x")).rejects.toMatchObject({
      name: "TmdbError",
      status: 404,
    });
  });

  it("wraps a network failure in a TmdbError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(searchTvShows("x")).rejects.toBeInstanceOf(TmdbError);
  });

  it("doesn't repeat a transport error's own text back to the browser", async () => {
    // `toResult` hands TmdbError.message straight to the client, and a
    // transport failure's message isn't ours to vet — the request URL carries
    // the v3 API key in its query string, so this is the one place a key could
    // reach a visitor.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          "request to https://api.themoviedb.org/3/search/tv?api_key=SECRETKEY failed",
        );
      }),
    );

    const error = await searchTvShows("x").catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(TmdbError);
    expect((error as Error).message).toBe("Could not reach TMDB. Please try again.");
    expect((error as Error).message).not.toContain("SECRETKEY");
  });

  it("returns nothing for a blank query without calling TMDB", async () => {
    const fetchMock = mockFetch({ results: [] });

    expect(await searchTvShows("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("trailer selection", () => {
  const videos = (
    entries: Array<{ type: string; official?: boolean; key: string }>,
  ) => ({
    results: entries.map((entry) => ({
      ...entry,
      site: "YouTube",
      name: entry.type,
    })),
  });

  it("prefers an official trailer over an unofficial one", async () => {
    mockFetch(
      videos([
        { type: "Trailer", official: false, key: "unofficial" },
        { type: "Trailer", official: true, key: "official" },
      ]),
    );

    expect((await getShowTrailer("t1"))?.key).toBe("official");
  });

  it("prefers a trailer over a teaser", async () => {
    mockFetch(
      videos([
        { type: "Teaser", official: true, key: "teaser" },
        { type: "Trailer", official: false, key: "trailer" },
      ]),
    );

    expect((await getShowTrailer("t2"))?.key).toBe("trailer");
  });

  it("rejects featurettes and recaps rather than showing them as trailers", async () => {
    // Season video lists are mostly these; a "Trailer" button that opens a
    // recap is worse than no button.
    mockFetch(
      videos([
        { type: "Featurette", key: "f" },
        { type: "Recap", key: "r" },
        { type: "Opening Credits", key: "o" },
      ]),
    );

    expect(await getShowTrailer("t3")).toBeNull();
  });

  it("ignores videos hosted anywhere but YouTube", async () => {
    mockFetch({
      results: [{ type: "Trailer", site: "Vimeo", key: "v", name: "n" }],
    });

    expect(await getShowTrailer("t4")).toBeNull();
  });

  it("caches per show, so a repeat call makes no request", async () => {
    const fetchMock = mockFetch(
      videos([{ type: "Trailer", official: true, key: "cached" }]),
    );

    await getShowTrailer("t5");
    await getShowTrailer("t5");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("values TMDB supplies that end up in markup", () => {
  it("drops a video id that isn't safe to sit in a URL", async () => {
    // The id is interpolated into a thumbnail URL and an embed URL. A `/` or
    // `?` in it doesn't sit quietly in the path — it repoints the request.
    mockFetch({
      results: [
        {
          type: "Trailer",
          official: true,
          site: "YouTube",
          name: "Trailer",
          key: "../../evil?x=",
        },
      ],
    });

    expect(await getShowTrailer("v-unsafe")).toBeNull();
  });

  it("keeps an ordinary video id, whatever its length", async () => {
    // Charset is the security property; length is not. Pinning it to 11 would
    // silently drop the trailer for anything unusual, with nothing logged.
    mockFetch({
      results: [
        {
          type: "Trailer",
          official: true,
          site: "YouTube",
          name: "Trailer",
          key: "dQw4w9WgXcQ_longer",
        },
      ],
    });

    expect(await getShowTrailer("v-long")).toMatchObject({
      key: "dQw4w9WgXcQ_longer",
    });
  });

  it("refuses a provider link that isn't https", async () => {
    // This is rendered as an href, and React only *warns* about a
    // `javascript:` URL — it renders it anyway.
    mockFetch({
      results: {
        FR: {
          link: "javascript:alert(document.cookie)",
          flatrate: [
            { provider_id: 1, provider_name: "Netflix", logo_path: "/n.jpg" },
          ],
        },
      },
    });

    const countries = await getWatchProviders("p-hostile");

    // The country still lists its providers; only the link is dropped.
    expect(countries[0].link).toBeNull();
    expect(countries[0].flatrate[0].name).toBe("Netflix");
  });
});

describe("response cache", () => {
  it("shares one request between callers that miss together", async () => {
    // A cold instance rendering a show page fans out to providers, regions and
    // a trailer per season at once. Caching the resolved value meant every
    // concurrent viewer multiplied that whole burst.
    const fetchMock = mockFetch({ results: {} });

    await Promise.all([
      getWatchProviders("p-stampede"),
      getWatchProviders("p-stampede"),
      getWatchProviders("p-stampede"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't serve a failure for the rest of the TTL", async () => {
    // A cached rejection would turn one bad minute into a day without
    // trailers, long after TMDB recovered.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(getWatchProviders("p-recovers")).rejects.toBeInstanceOf(TmdbError);

    const fetchMock = mockFetch({
      results: {
        FR: {
          link: "https://example.test/fr",
          flatrate: [
            { provider_id: 1, provider_name: "Netflix", logo_path: null },
          ],
        },
      },
    });

    expect((await getWatchProviders("p-recovers"))[0].code).toBe("FR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("watch providers", () => {
  it("groups providers and drops countries with nothing available", async () => {
    mockFetch({
      results: {
        FR: {
          link: "https://example.test/fr",
          flatrate: [
            { provider_id: 1, provider_name: "Netflix", logo_path: "/n.jpg" },
          ],
          buy: [
            { provider_id: 2, provider_name: "Apple TV", logo_path: "/a.jpg" },
          ],
        },
        ZZ: { link: "https://example.test/zz" },
      },
    });

    const countries = await getWatchProviders("p1");

    expect(countries.map((country) => country.code)).toEqual(["FR"]);
    expect(countries[0].flatrate[0].name).toBe("Netflix");
    expect(countries[0].buy[0].name).toBe("Apple TV");
    expect(countries[0].free).toEqual([]);
  });

  it("merges TMDB's separate free and ad-supported buckets", async () => {
    mockFetch({
      results: {
        US: {
          free: [{ provider_id: 1, provider_name: "Tubi", logo_path: null }],
          ads: [{ provider_id: 2, provider_name: "Pluto", logo_path: null }],
        },
      },
    });

    const [country] = await getWatchProviders("p2");

    expect(country.free.map((provider) => provider.name)).toEqual([
      "Tubi",
      "Pluto",
    ]);
  });

  it("orders providers by TMDB's display priority", async () => {
    mockFetch({
      results: {
        US: {
          flatrate: [
            {
              provider_id: 1,
              provider_name: "Second",
              logo_path: null,
              display_priority: 9,
            },
            {
              provider_id: 2,
              provider_name: "First",
              logo_path: null,
              display_priority: 1,
            },
          ],
        },
      },
    });

    const [country] = await getWatchProviders("p3");

    expect(country.flatrate.map((provider) => provider.name)).toEqual([
      "First",
      "Second",
    ]);
  });
});

describe("provider list for the settings picker", () => {
  it("maps the raw TMDB fields", async () => {
    mockFetch({
      results: [
        { provider_id: 8, provider_name: "Netflix", logo_path: "/n.jpg" },
      ],
    });

    const [provider] = await getWatchProviderList("region-fields");

    expect(provider).toEqual({ id: 8, name: "Netflix", logoPath: "/n.jpg" });
  });

  it("sorts alphabetically by name, not TMDB's display priority", async () => {
    mockFetch({
      results: [
        { provider_id: 1, provider_name: "Zeta", logo_path: null, display_priority: 0 },
        { provider_id: 2, provider_name: "Alpha", logo_path: null, display_priority: 9 },
      ],
    });

    const providers = await getWatchProviderList("region-sort");

    expect(providers.map((provider) => provider.name)).toEqual([
      "Alpha",
      "Zeta",
    ]);
  });

  it("shares one request across concurrent callers for the same region", async () => {
    const fetchMock = mockFetch({ results: [] });

    await Promise.all([
      getWatchProviderList("region-stampede"),
      getWatchProviderList("region-stampede"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
