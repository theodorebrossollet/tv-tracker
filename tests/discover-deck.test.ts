import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TmdbRecommendation } from "@/lib/tmdb";

// TMDB is stubbed per seed: `recs.byKey` maps `${kind}:${id}` of a seed to the
// candidates its recommendations call returns, or an Error to reject with.
const recs = vi.hoisted(() => ({
  byKey: new Map<string, TmdbRecommendation[] | Error>(),
}));

vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  getRecommendations: vi.fn(async (kind: string, id: string) => {
    const value = recs.byKey.get(`${kind}:${id}`);
    if (value instanceof Error) throw value;
    return value ?? [];
  }),
}));

const { getRecommendations } = await import("@/lib/tmdb");
const {
  DECK_LOADS_PER_MINUTE,
  getDeck,
  getSeeds,
  parseDeckFilters,
  resetDeckThrottleForTests,
} = await import("@/lib/discover");
const { prisma } = await import("@/lib/prisma");
const {
  TEST_USER_ID: A,
  resetDatabase,
  seedSeasonedShow,
  seedShow,
  seedUser,
  watchEpisode,
} = await import("./helpers");
import type { DeckCard, DeckFilters } from "@/lib/discover-types";

const B = "user-b";
const DAY_MS = 24 * 60 * 60 * 1000;
const ANY: DeckFilters = { kind: "any", short: false, listId: null };
const recMock = vi.mocked(getRecommendations);

const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

beforeEach(async () => {
  recs.byKey.clear();
  recMock.mockClear();
  resetDeckThrottleForTests();
  await resetDatabase();
  await seedUser();
  await seedUser(B);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- fixtures ----------------------------------------------------------

async function movie(
  id: string,
  { runtime = null as number | null, releaseDate = null as Date | null } = {},
) {
  await prisma.movie.upsert({
    where: { id },
    create: { id, title: `Movie ${id}`, runtime, releaseDate },
    update: {},
  });
}

async function trackMovie(
  id: string,
  status: "watchlist" | "watched" | "not_interested",
  {
    userId = A,
    rating = null as number | null,
    watchedAt = null as Date | null,
    addedAt = undefined as Date | undefined,
    runtime = null as number | null,
    releaseDate = null as Date | null,
  } = {},
) {
  await movie(id, { runtime, releaseDate });
  await prisma.trackedMovie.create({
    data: {
      userId,
      movieId: id,
      status,
      rating,
      watchedAt: watchedAt ?? (status === "watched" ? new Date() : null),
      ...(addedAt ? { addedAt } : {}),
    },
  });
}

/** A watched movie rated `rating`, `days` ago: a seed when rating >= 8. */
function ratedMovie(id: string, rating: number | null, days = 1, userId = A) {
  return trackMovie(id, "watched", {
    userId,
    rating,
    watchedAt: daysAgo(days),
  });
}

/** Sets when a user watched one episode, to order show seeds. */
async function watchedOn(episodeId: string, days: number, userId = A) {
  await prisma.watchedEpisode.update({
    where: { userId_episodeId: { userId, episodeId } },
    data: { watchedAt: daysAgo(days) },
  });
}

/** Three movie seeds rated 9, newest first: 11, 12, 13. */
async function threeSeeds() {
  await ratedMovie("11", 9, 1);
  await ratedMovie("12", 9, 2);
  await ratedMovie("13", 9, 3);
}

function rec(
  id: string,
  over: Partial<TmdbRecommendation> = {},
): TmdbRecommendation {
  return {
    kind: "movie",
    id,
    name: `Rec ${id}`,
    posterPath: `/p${id}.jpg`,
    overview: null,
    year: "2020",
    voteAverage: 7,
    voteCount: 1000,
    ...over,
  };
}

const keys = (cards: DeckCard[]) => cards.map((c) => `${c.kind}:${c.id}`);
const recommended = (cards: DeckCard[]) =>
  keys(cards.filter((c) => c.source === "recommended"));
const own = (cards: DeckCard[]) =>
  keys(cards.filter((c) => c.source === "own"));

// ---- seeds -------------------------------------------------------------

describe("getSeeds", () => {
  it("takes movies rated 8 or more, not 7, not unrated", async () => {
    await ratedMovie("1", 8);
    await ratedMovie("2", 7);
    await ratedMovie("3", null);

    expect(await getSeeds(A)).toEqual([
      { kind: "movie", id: "1", title: "Movie 1", rating: 8 },
    ]);
  });

  it("takes a show by its season-then-show average", async () => {
    // 201: 8 and 9 in one season, average 8.5.
    await seedSeasonedShow({ showId: "201", seasons: [2] });
    await watchEpisode("201-s1e1", 8);
    await watchEpisode("201-s1e2", 9);
    // 202: average 7.5, below the bar.
    await seedSeasonedShow({ showId: "202", seasons: [2] });
    await watchEpisode("202-s1e1", 7);
    await watchEpisode("202-s1e2", 8);
    // 203: watched but never rated.
    await seedSeasonedShow({ showId: "203", seasons: [1] });
    await watchEpisode("203-s1e1");
    // 204: S1 one episode at 10, S2 four at 6. The mean of episodes is 6.8
    // (out); the mean of season means is 8 (in). Only the app's rule takes it.
    await seedSeasonedShow({ showId: "204", seasons: [1, 4] });
    await watchEpisode("204-s1e1", 10);
    for (let e = 1; e <= 4; e++) await watchEpisode(`204-s2e${e}`, 6);

    const seeds = await getSeeds(A);
    expect(seeds.map((s) => s.id).sort()).toEqual(["201", "204"]);
    expect(seeds.find((s) => s.id === "201")).toMatchObject({
      kind: "show",
      title: "Seasoned Show",
      rating: 8.5,
    });
    expect(seeds.find((s) => s.id === "204")?.rating).toBeCloseTo(8, 9);
  });

  it("puts the most recently rated first, a show by its latest rated watch", async () => {
    await ratedMovie("1", 9, 3);
    await ratedMovie("2", 9, 2);
    // The show's rated watch was 2.5 days ago; a later UNRATED watch (today)
    // must not move it ahead of movie 2.
    await seedSeasonedShow({ showId: "301", seasons: [2] });
    await watchEpisode("301-s1e1", 9);
    await watchedOn("301-s1e1", 2.5);
    await watchEpisode("301-s1e2");
    // A second show rated most recently of all.
    await seedSeasonedShow({ showId: "302", seasons: [2] });
    await watchEpisode("302-s1e1", 9);
    await watchedOn("302-s1e1", 5);
    await watchEpisode("302-s1e2", 9);
    await watchedOn("302-s1e2", 0.5);

    expect((await getSeeds(A)).map((s) => `${s.kind}:${s.id}`)).toEqual([
      "show:302",
      "movie:2",
      "show:301",
      "movie:1",
    ]);
  });

  it("keeps at most the ten newest", async () => {
    for (let i = 1; i <= 12; i++) await ratedMovie(String(i), 9, i);

    expect((await getSeeds(A)).map((s) => s.id)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
    ]);
  });

  it("never uses another account's ratings or watch dates", async () => {
    // B rates highly everything A has watched or tracks.
    await ratedMovie("1", null, 1);
    await ratedMovie("1", 10, 1, B);
    await seedSeasonedShow({ showId: "401", seasons: [1] });
    await watchEpisode("401-s1e1");
    await seedSeasonedShow({ showId: "401", seasons: [1], userId: B });
    await watchEpisode("401-s1e1", 10, B);
    // B's own seeds, which A doesn't track at all.
    await ratedMovie("2", 10, 1, B);
    expect(await getSeeds(A)).toEqual([]);

    // Ordering too: A rated show 402 ten days ago and movie 3 five days ago;
    // B rated show 402 today. A's order must follow A's dates.
    await ratedMovie("3", 9, 5);
    await seedSeasonedShow({ showId: "402", seasons: [1] });
    await watchEpisode("402-s1e1", 9);
    await watchedOn("402-s1e1", 10);
    await seedSeasonedShow({ showId: "402", seasons: [1], userId: B });
    await watchEpisode("402-s1e1", 9, B);

    expect((await getSeeds(A)).map((s) => `${s.kind}:${s.id}`)).toEqual([
      "movie:3",
      "show:402",
    ]);
    expect((await getSeeds(B)).map((s) => s.id).sort()).toEqual([
      "1", "2", "401", "402",
    ]);
  });
});

// ---- deck --------------------------------------------------------------

describe("getDeck recommendations", () => {
  it("does not ask TMDB with fewer than three seeds", async () => {
    await ratedMovie("11", 9);
    await ratedMovie("12", 9);
    await trackMovie("50", "watchlist");
    recs.byKey.set("movie:11", [rec("900")]);

    const deck = await getDeck(A, ANY);

    expect(recMock).not.toHaveBeenCalled();
    expect(deck).toEqual({
      cards: [
        {
          source: "own",
          kind: "movie",
          id: "50",
          title: "Movie 50",
          posterPath: null,
          year: null,
        },
      ],
      seedCount: 2,
      recommendationsUnavailable: false,
    });
  });

  it("asks once per seed and merges the answers", async () => {
    await threeSeeds();
    recs.byKey.set("movie:11", [rec("900", { voteAverage: 9 })]);
    recs.byKey.set("movie:12", [rec("901", { voteAverage: 8 })]);
    recs.byKey.set("movie:13", [rec("902", { voteAverage: 7 })]);

    const deck = await getDeck(A, ANY);

    expect(recMock).toHaveBeenCalledTimes(3);
    expect(recMock.mock.calls.map((c) => c.join(":")).sort()).toEqual([
      "movie:11",
      "movie:12",
      "movie:13",
    ]);
    expect(deck.seedCount).toBe(3);
    expect(deck.recommendationsUnavailable).toBe(false);
    expect(deck.cards).toEqual([
      {
        source: "recommended",
        kind: "movie",
        id: "900",
        title: "Rec 900",
        posterPath: "/p900.jpg",
        year: "2020",
        becauseTitle: "Movie 11",
        becauseRating: 9,
      },
      expect.objectContaining({ id: "901", becauseTitle: "Movie 12" }),
      expect.objectContaining({ id: "902", becauseTitle: "Movie 13" }),
    ]);
  });

  it("leaves out what the caller tracks, lists or dismissed, and nothing else", async () => {
    await threeSeeds();
    // Tracked by A in every movie status and every show status.
    await trackMovie("901", "watchlist");
    await trackMovie("902", "watched");
    await trackMovie("903", "not_interested");
    for (const [id, status] of [
      ["911", "watching"],
      ["912", "watchlist"],
      ["913", "paused"],
      ["914", "stopped"],
    ] as const) {
      await seedShow({ showId: id, offsets: [-1], status });
    }
    // On A's lists (one personal, one "together").
    await movie("920");
    await seedShow({ showId: "921", offsets: [-1] });
    const mine = await prisma.list.create({ data: { userId: A, name: "M" } });
    const ours = await prisma.list.create({
      data: { userId: A, name: "O", trackSeparately: true },
    });
    await prisma.listItem.create({ data: { listId: mine.id, movieId: "920" } });
    await prisma.listItem.create({ data: { listId: ours.id, showId: "921" } });
    // Dismissed by A: the movie 930, not the show 930.
    await prisma.dismissedSuggestion.create({
      data: { userId: A, kind: "movie", tmdbId: "930" },
    });
    // B tracks, lists and dismisses 940 and 941; A has never touched them.
    await trackMovie("940", "not_interested", { userId: B });
    await seedShow({ showId: "941", offsets: [-1], status: "stopped", userId: B });
    const theirs = await prisma.list.create({ data: { userId: B, name: "T" } });
    await prisma.listItem.create({ data: { listId: theirs.id, movieId: "940" } });
    await prisma.listItem.create({ data: { listId: theirs.id, showId: "941" } });
    await prisma.dismissedSuggestion.createMany({
      data: [
        { userId: B, kind: "movie", tmdbId: "940" },
        { userId: B, kind: "show", tmdbId: "941" },
      ],
    });

    const show = (id: string) => rec(id, { kind: "show" });
    recs.byKey.set("movie:11", [
      rec("901"), rec("902"), rec("903"),
      show("911"), show("912"), show("913"), show("914"),
    ]);
    recs.byKey.set("movie:12", [rec("920"), show("921"), rec("930"), show("930")]);
    recs.byKey.set("movie:13", [rec("940"), show("941"), rec("960")]);

    const deck = await getDeck(A, ANY);

    expect(recommended(deck.cards).sort()).toEqual([
      "movie:940",
      "movie:960",
      "show:930",
      "show:941",
    ]);
  });

  it("drops a candidate with no name", async () => {
    await threeSeeds();
    recs.byKey.set("movie:11", [rec("900", { name: "" }), rec("901")]);

    expect(recommended((await getDeck(A, ANY)).cards)).toEqual(["movie:901"]);
  });

  it("falls back to own titles when every TMDB call fails", async () => {
    await threeSeeds();
    await trackMovie("50", "watchlist");
    for (const id of ["11", "12", "13"]) {
      recs.byKey.set(`movie:${id}`, new Error("TMDB down"));
    }
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const deck = await getDeck(A, ANY);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"event":"discover.recommendations_failed"'),
    );

    expect(recMock).toHaveBeenCalledTimes(3);
    expect(keys(deck.cards)).toEqual(["movie:50"]);
    expect(deck.recommendationsUnavailable).toBe(true);
    expect(deck.seedCount).toBe(3);
  });

  it("keeps the seeds that answered when some fail", async () => {
    await threeSeeds();
    recs.byKey.set("movie:11", new Error("TMDB down"));
    recs.byKey.set("movie:12", [rec("901")]);
    recs.byKey.set("movie:13", [rec("902")]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const deck = await getDeck(A, ANY);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('"failed":1'));

    expect(recommended(deck.cards).sort()).toEqual(["movie:901", "movie:902"]);
    expect(deck.recommendationsUnavailable).toBe(false);
  });
});

describe("getDeck own titles", () => {
  it("holds only watchlist movies and watchlist shows", async () => {
    await trackMovie("51", "watchlist", {
      releaseDate: new Date("2019-01-01T04:00:00Z"),
    });
    await trackMovie("52", "watched");
    await trackMovie("53", "not_interested");
    await seedShow({ showId: "61", offsets: [-1], status: "watchlist" });
    await prisma.show.update({
      where: { id: "61" },
      data: { firstAirDate: new Date("2008-01-20T05:00:00Z"), posterPath: "/s.jpg" },
    });
    await seedShow({ showId: "62", offsets: [-1], status: "watching" });
    await seedShow({ showId: "63", offsets: [-1], status: "paused" });
    await seedShow({ showId: "64", offsets: [-1], status: "stopped" });
    // B's watchlist is not A's.
    await trackMovie("54", "watchlist", { userId: B });
    await seedShow({ showId: "65", offsets: [-1], status: "watchlist", userId: B });

    const deck = await getDeck(A, ANY);

    expect([...deck.cards].sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      {
        source: "own",
        kind: "movie",
        id: "51",
        title: "Movie 51",
        posterPath: null,
        year: "2019",
      },
      {
        source: "own",
        kind: "show",
        id: "61",
        title: "Test Show",
        posterPath: "/s.jpg",
        year: "2008",
      },
    ]);
  });

  it("deals every own title when the watchlist is no bigger than the deck", async () => {
    await trackMovie("51", "watchlist", { addedAt: daysAgo(3) });
    await trackMovie("52", "watchlist", { addedAt: daysAgo(1) });
    await seedShow({ showId: "61", offsets: [-1], status: "watchlist" });

    expect(keys((await getDeck(A, ANY)).cards).sort()).toEqual([
      "movie:51",
      "movie:52",
      "show:61",
    ]);
  });

  it("draws own titles from the whole watchlist, not just the newest ten", async () => {
    // Forty titles, all about a year old, so none has a head start.
    for (let i = 1; i <= 40; i++) {
      await trackMovie(String(900 + i), "watchlist", { addedAt: daysAgo(365 + i) });
    }

    const seen = new Set<string>();
    for (let day = 0; day < 20; day++) {
      const now = new Date(Date.UTC(2026, 9, 1 + day, 15));
      const cards = (await getDeck(A, ANY, { now })).cards;
      expect(cards).toHaveLength(10);
      keys(cards).forEach((k) => seen.add(k));
    }

    // Ten at a time over twenty days: far more than the ten newest.
    expect(seen.size).toBeGreaterThan(30);
  });

  it("deals the same own titles in the same order all day, and others the next day", async () => {
    for (let i = 1; i <= 40; i++) {
      await trackMovie(String(900 + i), "watchlist", { addedAt: daysAgo(365 + i) });
    }
    const morning = new Date("2026-10-07T13:00:00Z");
    const evening = new Date("2026-10-08T01:00:00Z"); // still 7 Oct in New York
    const nextDay = new Date("2026-10-09T13:00:00Z");

    const a = keys((await getDeck(A, ANY, { now: morning })).cards);
    const b = keys((await getDeck(A, ANY, { now: evening })).cards);
    const c = keys((await getDeck(A, ANY, { now: nextDay })).cards);

    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it("changes at most one card when a title is added to the watchlist", async () => {
    for (let i = 1; i <= 40; i++) {
      await trackMovie(String(900 + i), "watchlist", { addedAt: daysAgo(365 + i) });
    }
    const now = new Date("2026-10-07T13:00:00Z");
    const before = keys((await getDeck(A, ANY, { now })).cards);

    await trackMovie("999", "watchlist", { addedAt: daysAgo(400) });
    const after = keys((await getDeck(A, ANY, { now })).cards);

    expect(before.filter((k) => !after.includes(k)).length).toBeLessThanOrEqual(1);
  });
});

describe("getDeck interleaving", () => {
  async function ownMovies(count: number) {
    // Newest added first: 501 is the newest.
    for (let i = 1; i <= count; i++) {
      await trackMovie(String(500 + i), "watchlist", { addedAt: daysAgo(i) });
    }
  }

  function rankedRecs(count: number) {
    // Higher voteAverage ranks first: 701 is the best.
    return Array.from({ length: count }, (_, i) =>
      rec(String(701 + i), { voteAverage: 9 - i * 0.1 }),
    );
  }

  it("deals two recommended then one own, capped at 20 + 10", async () => {
    await threeSeeds();
    await ownMovies(12);
    recs.byKey.set("movie:11", rankedRecs(25));

    const cards = (await getDeck(A, ANY)).cards;

    expect(cards).toHaveLength(30);
    expect(cards.map((c) => c.source[0]).join("")).toBe("rro".repeat(10));
    expect(recommended(cards)).toEqual(
      rankedRecs(20).map((r) => `movie:${r.id}`),
    );
    // Ten of the twelve own movies, each at most once.
    const dealt = own(cards);
    expect(new Set(dealt).size).toBe(10);
    dealt.forEach((k) => {
      const id = Number(k.replace("movie:", ""));
      expect(id).toBeGreaterThanOrEqual(501);
      expect(id).toBeLessThanOrEqual(512);
    });
  });

  it("appends leftover recommendations once own titles run out", async () => {
    await threeSeeds();
    await ownMovies(1);
    recs.byKey.set("movie:11", rankedRecs(5));

    const cards = (await getDeck(A, ANY)).cards;
    expect(keys(cards)).toEqual([
      "movie:701", "movie:702", "movie:501", "movie:703", "movie:704", "movie:705",
    ]);
  });

  it("appends leftover own titles once recommendations run out", async () => {
    await threeSeeds();
    await ownMovies(4);
    recs.byKey.set("movie:11", rankedRecs(1));

    const cards = (await getDeck(A, ANY)).cards;
    // The one recommendation first, then all four own titles in some order.
    expect(keys(cards)[0]).toBe("movie:701");
    expect(keys(cards).slice(1).sort()).toEqual([
      "movie:501", "movie:502", "movie:503", "movie:504",
    ]);
  });
});

describe("getDeck filters", () => {
  it("kind=movie keeps only movies, kind=show only shows", async () => {
    await threeSeeds();
    await trackMovie("51", "watchlist");
    await seedShow({ showId: "61", offsets: [-1], status: "watchlist" });
    recs.byKey.set("movie:11", [rec("901"), rec("902", { kind: "show" })]);

    const movies = await getDeck(A, { ...ANY, kind: "movie" });
    expect(keys(movies.cards).sort()).toEqual(["movie:51", "movie:901"]);

    const shows = await getDeck(A, { ...ANY, kind: "show" });
    expect(keys(shows.cards).sort()).toEqual(["show:61", "show:902"]);
  });

  it("short=1 keeps own movies under 120 minutes and drops shows and recommendations", async () => {
    await threeSeeds();
    await trackMovie("51", "watchlist", { runtime: 90 });
    await trackMovie("52", "watchlist", { runtime: 119 });
    await trackMovie("53", "watchlist", { runtime: 120 });
    await trackMovie("54", "watchlist", { runtime: null });
    await seedShow({ showId: "61", offsets: [-1], status: "watchlist" });
    recs.byKey.set("movie:11", [rec("901")]);

    const deck = await getDeck(A, { ...ANY, short: true });

    expect(keys(deck.cards).sort()).toEqual(["movie:51", "movie:52"]);
    expect(recMock).not.toHaveBeenCalled();
    expect(deck.recommendationsUnavailable).toBe(false);
  });

  it("a list narrows own titles to its unwatched items and drops recommendations", async () => {
    await threeSeeds();
    // Personal list: Library status decides watched.
    const list = await prisma.list.create({ data: { userId: A, name: "L" } });
    await trackMovie("51", "watchlist"); // on list, unwatched -> in
    await trackMovie("52", "watched"); // on list, watched -> out
    await movie("53"); // on list, untracked -> in
    await trackMovie("54", "watchlist"); // not on list -> out
    // A finished show (ended, everything watched) is watched -> out; a show
    // with an unwatched episode is not -> in.
    await seedShow({
      showId: "61",
      offsets: [-1],
      status: "watching",
      watched: [0],
      showStatus: "Ended",
    });
    await seedShow({ showId: "62", offsets: [-2, -1], status: "watching", watched: [0] });
    for (const data of [
      { movieId: "51" }, { movieId: "52" }, { movieId: "53" },
      { showId: "61" }, { showId: "62" },
    ]) {
      await prisma.listItem.create({ data: { listId: list.id, ...data } });
    }
    recs.byKey.set("movie:11", [rec("901")]);

    const deck = await getDeck(A, { ...ANY, listId: list.id });

    expect(keys(deck.cards).sort()).toEqual(["movie:51", "movie:53", "show:62"]);
    expect(recMock).not.toHaveBeenCalled();
  });

  it("a list leaves out the caller's not-interested movies and stopped shows", async () => {
    const list = await prisma.list.create({ data: { userId: A, name: "L" } });
    await movie("53"); // untracked -> in
    await trackMovie("55", "not_interested"); // -> out
    await seedShow({ showId: "62", offsets: [-1], status: "watching" }); // -> in
    await seedShow({ showId: "63", offsets: [-1], status: "stopped" }); // -> out
    // B gave up on 56 and 64; A never tracked them, so they stay in for A.
    await trackMovie("56", "not_interested", { userId: B });
    await seedShow({ showId: "64", offsets: [-1], status: "stopped", userId: B });
    for (const data of [
      { movieId: "53" }, { movieId: "55" }, { movieId: "56" },
      { showId: "62" }, { showId: "63" }, { showId: "64" },
    ]) {
      await prisma.listItem.create({ data: { listId: list.id, ...data } });
    }

    const deck = await getDeck(A, { ...ANY, listId: list.id });

    expect(keys(deck.cards).sort()).toEqual([
      "movie:53",
      "movie:56",
      "show:62",
      "show:64",
    ]);
  });

  it("a together list uses its own ticks, not Library status", async () => {
    const list = await prisma.list.create({
      data: { userId: A, name: "Us", trackSeparately: true },
    });
    await trackMovie("51", "watched"); // Library-watched, unticked -> in
    await trackMovie("52", "watchlist"); // ticked -> out
    await prisma.listItem.create({ data: { listId: list.id, movieId: "51" } });
    await prisma.listItem.create({
      data: { listId: list.id, movieId: "52", watchedAt: new Date() },
    });

    const deck = await getDeck(A, { ...ANY, listId: list.id });
    expect(keys(deck.cards)).toEqual(["movie:51"]);
  });

  it("another account's list gives an empty deck, never its items", async () => {
    await threeSeeds();
    await trackMovie("51", "watchlist");
    const theirs = await prisma.list.create({ data: { userId: B, name: "T" } });
    await movie("70");
    await prisma.listItem.create({ data: { listId: theirs.id, movieId: "70" } });
    recs.byKey.set("movie:11", [rec("901")]);

    const deck = await getDeck(A, { ...ANY, listId: theirs.id });

    expect(deck.cards).toEqual([]);
    expect(recMock).not.toHaveBeenCalled();
  });

  it("a list combines with kind and short", async () => {
    const list = await prisma.list.create({ data: { userId: A, name: "L" } });
    await trackMovie("51", "watchlist", { runtime: 100 });
    await trackMovie("52", "watchlist", { runtime: 150 });
    await seedShow({ showId: "61", offsets: [-1], status: "watchlist" });
    for (const data of [{ movieId: "51" }, { movieId: "52" }, { showId: "61" }]) {
      await prisma.listItem.create({ data: { listId: list.id, ...data } });
    }

    const short = await getDeck(A, { ...ANY, listId: list.id, short: true });
    expect(keys(short.cards)).toEqual(["movie:51"]);
    const shows = await getDeck(A, { ...ANY, listId: list.id, kind: "show" });
    expect(keys(shows.cards)).toEqual(["show:61"]);
  });
});

describe("deck-load throttle", () => {
  it("survives a run of swipes: ten loads in a row keep recommendations", async () => {
    // Every add or dismiss revalidates the page, so each swipe on a
    // recommendation is a deck load. A limit tight enough to trip on a normal
    // run of swipes empties the deck mid-session.
    await threeSeeds();
    recs.byKey.set("movie:11", [rec("901")]);

    for (let i = 0; i < 10; i++) {
      const deck = await getDeck(A, ANY);
      expect(deck.recommendationsUnavailable).toBe(false);
      expect(recommended(deck.cards)).toEqual(["movie:901"]);
    }
  });

  it("skips recommendations on the load past the limit within a minute, per user", async () => {
    await threeSeeds();
    await trackMovie("51", "watchlist");
    recs.byKey.set("movie:11", [rec("901")]);

    for (let i = 0; i < DECK_LOADS_PER_MINUTE; i++) {
      const deck = await getDeck(A, ANY);
      expect(recommended(deck.cards)).toEqual(["movie:901"]);
    }
    expect(recMock).toHaveBeenCalledTimes(3 * DECK_LOADS_PER_MINUTE);

    const over = await getDeck(A, ANY);
    expect(recMock).toHaveBeenCalledTimes(3 * DECK_LOADS_PER_MINUTE);
    expect(keys(over.cards)).toEqual(["movie:51"]);
    expect(over.recommendationsUnavailable).toBe(true);

    // Another account has its own allowance.
    await ratedMovie("11", 9, 1, B);
    await ratedMovie("12", 9, 2, B);
    await ratedMovie("13", 9, 3, B);
    expect(recommended((await getDeck(B, ANY)).cards)).toEqual(["movie:901"]);
  });

  it("allows loads again once a minute has passed", async () => {
    await threeSeeds();
    recs.byKey.set("movie:11", [rec("901")]);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));

    for (let i = 0; i < DECK_LOADS_PER_MINUTE; i++) await getDeck(A, ANY);
    expect((await getDeck(A, ANY)).recommendationsUnavailable).toBe(true);

    vi.setSystemTime(new Date("2026-10-02T12:01:01Z"));
    const later = await getDeck(A, ANY);
    expect(later.recommendationsUnavailable).toBe(false);
    expect(recommended(later.cards)).toEqual(["movie:901"]);
  });
});

describe("parseDeckFilters", () => {
  it("defaults to everything", () => {
    expect(parseDeckFilters({})).toEqual(ANY);
  });

  it("reads kind, short and list", () => {
    expect(parseDeckFilters({ kind: "movie", short: "1", list: "clist123" })).toEqual({
      kind: "movie",
      short: true,
      listId: "clist123",
    });
    expect(parseDeckFilters({ kind: "show" }).kind).toBe("show");
    // A repeated param counts by its last value, as elsewhere in the app.
    expect(parseDeckFilters({ kind: ["junk", "movie"] }).kind).toBe("movie");
  });

  it("falls back to defaults on junk", () => {
    expect(
      parseDeckFilters({
        kind: "tv",
        short: "yes",
        list: "../../etc",
      }),
    ).toEqual(ANY);
    expect(parseDeckFilters({ kind: "MOVIE", short: "0", list: "" })).toEqual(ANY);
    expect(parseDeckFilters({ list: "x".repeat(200) }).listId).toBeNull();
  });
});
