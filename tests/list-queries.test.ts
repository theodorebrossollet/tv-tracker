import { beforeEach, describe, expect, it } from "vitest";

const { getListDetail, getLists, getListsForTitle, getShowBuckets } =
  await import("@/lib/queries");
const { prisma } = await import("@/lib/prisma");
const { TEST_USER_ID, resetDatabase, seedSeasonedShow, seedShow, seedUser, watchEpisode } = await import(
  "./helpers"
);

const at = (iso: string) => new Date(iso);
const OTHER = "other-user";

async function seedList(
  name: string,
  opts: { createdAt?: string; trackSeparately?: boolean; userId?: string } = {},
) {
  return prisma.list.create({
    data: {
      name,
      userId: opts.userId ?? TEST_USER_ID,
      trackSeparately: opts.trackSeparately ?? false,
      createdAt: opts.createdAt ? at(opts.createdAt) : undefined,
    },
  });
}

async function seedMovie(
  id: string,
  opts: { title?: string; poster?: string | null; release?: string | null } = {},
) {
  await prisma.movie.upsert({
    where: { id },
    update: {},
    create: {
      id,
      title: opts.title ?? `Movie ${id}`,
      posterPath: opts.poster === undefined ? "/p.jpg" : opts.poster,
      releaseDate:
        opts.release === null ? null : at(opts.release ?? "2020-05-01T00:00:00Z"),
    },
  });
}

async function trackMovie(
  id: string,
  status: "watchlist" | "watched" | "not_interested",
  userId = TEST_USER_ID,
) {
  await prisma.trackedMovie.create({ data: { movieId: id, userId, status } });
}

function addMovie(
  listId: string,
  movieId: string,
  opts: { addedAt?: string; watchedAt?: string } = {},
) {
  return prisma.listItem.create({
    data: {
      listId,
      movieId,
      addedAt: opts.addedAt ? at(opts.addedAt) : undefined,
      watchedAt: opts.watchedAt ? at(opts.watchedAt) : null,
    },
  });
}

function addShow(
  listId: string,
  showId: string,
  opts: { addedAt?: string; watchedAt?: string } = {},
) {
  return prisma.listItem.create({
    data: {
      listId,
      showId,
      addedAt: opts.addedAt ? at(opts.addedAt) : undefined,
      watchedAt: opts.watchedAt ? at(opts.watchedAt) : null,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  await seedUser(OTHER);
});

describe("getLists", () => {
  it("is empty for an account with no lists", async () => {
    expect(await getLists(TEST_USER_ID)).toEqual([]);
  });

  it("returns newest first with item counts and the flag", async () => {
    const old = await seedList("Old", { createdAt: "2026-01-01T00:00:00Z" });
    await seedList("New", {
      createdAt: "2026-02-01T00:00:00Z",
      trackSeparately: true,
    });
    await seedMovie("1");
    await seedMovie("2");
    await addMovie(old.id, "1");
    await addMovie(old.id, "2");

    expect(await getLists(TEST_USER_ID)).toEqual([
      expect.objectContaining({
        name: "New",
        trackSeparately: true,
        itemCount: 0,
      }),
      expect.objectContaining({
        id: old.id,
        name: "Old",
        trackSeparately: false,
        itemCount: 2,
      }),
    ]);
  });

  it("never includes another account's lists", async () => {
    await seedList("Mine");
    await seedList("Theirs", { userId: OTHER });

    expect((await getLists(TEST_USER_ID)).map((l) => l.name)).toEqual(["Mine"]);
  });
});

describe("getListDetail", () => {
  it("is null for another account's list and for an unknown id", async () => {
    const theirs = await seedList("Theirs", { userId: OTHER });

    expect(await getListDetail(TEST_USER_ID, theirs.id)).toBeNull();
    expect(await getListDetail(TEST_USER_ID, "nope")).toBeNull();
  });

  it("sorts unwatched newest-added first, then watched newest-added first", async () => {
    const list = await seedList("L");
    for (const id of ["1", "2", "3", "4"]) await seedMovie(id);
    await trackMovie("2", "watched");
    await trackMovie("4", "watched");
    await addMovie(list.id, "1", { addedAt: "2026-01-01T00:00:00Z" });
    await addMovie(list.id, "2", { addedAt: "2026-01-02T00:00:00Z" });
    await addMovie(list.id, "3", { addedAt: "2026-01-03T00:00:00Z" });
    await addMovie(list.id, "4", { addedAt: "2026-01-04T00:00:00Z" });

    const detail = await getListDetail(TEST_USER_ID, list.id);
    expect(detail?.items.map((i) => i.titleId)).toEqual(["3", "1", "4", "2"]);
    expect(detail?.items.map((i) => i.watched)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("reads watched from the Library on a personal list", async () => {
    const list = await seedList("L");
    for (const id of ["1", "2", "3", "4"]) await seedMovie(id);
    await trackMovie("1", "watched");
    await trackMovie("2", "watchlist");
    await trackMovie("3", "not_interested");
    for (const id of ["1", "2", "3", "4"]) await addMovie(list.id, id);

    const detail = await getListDetail(TEST_USER_ID, list.id);
    const byId = Object.fromEntries(detail!.items.map((i) => [i.titleId, i]));
    expect(byId["1"]).toMatchObject({ status: "watched", watched: true });
    expect(byId["2"]).toMatchObject({ status: "watchlist", watched: false });
    expect(byId["3"]).toMatchObject({ status: "not_interested", watched: false });
    expect(byId["4"]).toMatchObject({ status: null, watched: false });
  });

  it("reads a show's finished state from the Library derivation", async () => {
    const list = await seedList("L");
    // Finished: every aired episode watched and the series is over.
    await seedShow({
      showId: "10",
      offsets: [-2, -1],
      status: "watching",
      watched: [0, 1],
      showStatus: "Ended",
    });
    // Not finished: one aired episode left.
    await seedShow({
      showId: "11",
      offsets: [-2, -1],
      status: "watching",
      watched: [0],
      showStatus: "Ended",
    });
    // Caught up but still running: not finished.
    await seedShow({
      showId: "12",
      offsets: [-1, 5],
      status: "watching",
      watched: [0],
      showStatus: "Returning Series",
    });
    // Untracked.
    await seedShow({ showId: "13", offsets: [-1] });
    for (const id of ["10", "11", "12", "13"]) await addShow(list.id, id);

    const buckets = await getShowBuckets(TEST_USER_ID);
    const finishedIds = buckets.finished.map((s) => s.showId);
    expect(finishedIds).toEqual(["10"]);

    const detail = await getListDetail(TEST_USER_ID, list.id);
    const byId = Object.fromEntries(detail!.items.map((i) => [i.titleId, i]));
    expect(byId["10"]).toMatchObject({
      kind: "show",
      status: "watching",
      finished: true,
      watched: true,
    });
    expect(byId["11"]).toMatchObject({ finished: false, watched: false });
    expect(byId["12"]).toMatchObject({ finished: false, watched: false });
    expect(byId["13"]).toMatchObject({
      status: null,
      finished: false,
      watched: false,
    });
    // Same answer as the buckets, for every show.
    for (const id of ["10", "11", "12", "13"]) {
      expect(byId[id].finished).toBe(finishedIds.includes(id));
    }
  });

  it("treats a stopped, fully watched, ended show as finished and watched", async () => {
    const list = await seedList("L");
    await seedShow({
      showId: "20",
      offsets: [-2, -1],
      status: "stopped",
      watched: [0, 1],
      showStatus: "Ended",
    });
    await addShow(list.id, "20");

    // Deliberate divergence from the Library: getShowBuckets files a stopped
    // show under `stopped` ahead of `finished`, but on a list a stopped, fully
    // watched, ended show is watched either way, so it counts as finished.
    const buckets = await getShowBuckets(TEST_USER_ID);
    expect(buckets.stopped.map((s) => s.showId)).toContain("20");
    expect(buckets.finished.map((s) => s.showId)).not.toContain("20");

    const detail = await getListDetail(TEST_USER_ID, list.id);
    expect(detail!.items[0]).toMatchObject({
      status: "stopped",
      finished: true,
      watched: true,
    });
  });

  it("orders items with the same addedAt deterministically, newest id first", async () => {
    const list = await seedList("L");
    for (const id of ["1", "2", "3"]) await seedMovie(id);
    const same = "2026-01-01T00:00:00Z";
    const created = [];
    for (const id of ["1", "2", "3"]) {
      created.push(await addMovie(list.id, id, { addedAt: same }));
    }

    const expected = created.map((c) => c.id).sort().reverse();
    for (let run = 0; run < 3; run++) {
      const detail = await getListDetail(TEST_USER_ID, list.id);
      expect(detail!.items.map((i) => i.itemId)).toEqual(expected);
    }
  });

  it("uses only the tick on a together list, whatever the Library says", async () => {
    const list = await seedList("L", { trackSeparately: true });
    for (const id of ["1", "2", "3"]) await seedMovie(id);
    await trackMovie("1", "watched");
    await trackMovie("2", "watchlist");
    await addMovie(list.id, "1");
    await addMovie(list.id, "2", { watchedAt: "2026-03-01T00:00:00Z" });
    await seedShow({
      showId: "10",
      offsets: [-1],
      status: "watching",
      watched: [0],
      showStatus: "Ended",
    });
    await addShow(list.id, "10");

    const detail = await getListDetail(TEST_USER_ID, list.id);
    const byId = Object.fromEntries(
      detail!.items.map((i) => [`${i.kind}${i.titleId}`, i]),
    );
    // Watched in the Library but not ticked: unwatched here.
    expect(byId.movie1).toMatchObject({
      status: "watched",
      tickedAt: null,
      watched: false,
    });
    // Ticked here but only on the watchlist: watched here.
    expect(byId.movie2).toMatchObject({
      status: "watchlist",
      watched: true,
      tickedAt: at("2026-03-01T00:00:00Z"),
    });
    // The show is finished in the Library, but that does not count here.
    expect(byId.show10).toMatchObject({ finished: true, watched: false });
  });

  it("ignores a stored tick on a personal list, and keeps it after a flag flip", async () => {
    const list = await seedList("L");
    await seedMovie("1");
    await addMovie(list.id, "1", { watchedAt: "2026-03-01T00:00:00Z" });

    let detail = await getListDetail(TEST_USER_ID, list.id);
    expect(detail?.items[0]).toMatchObject({
      watched: false,
      tickedAt: at("2026-03-01T00:00:00Z"),
    });

    await prisma.list.update({
      where: { id: list.id },
      data: { trackSeparately: true },
    });
    detail = await getListDetail(TEST_USER_ID, list.id);
    expect(detail?.trackSeparately).toBe(true);
    expect(detail?.items[0].watched).toBe(true);

    await prisma.list.update({
      where: { id: list.id },
      data: { trackSeparately: false },
    });
    detail = await getListDetail(TEST_USER_ID, list.id);
    expect(detail?.items[0]).toMatchObject({
      watched: false,
      tickedAt: at("2026-03-01T00:00:00Z"),
    });
  });

  it("keeps a movie and a show with the same id as two items", async () => {
    const list = await seedList("L");
    await seedMovie("7", { title: "Seven Movie" });
    await seedShow({ showId: "7", name: "Seven Show", offsets: [-1] });
    const movieItem = await addMovie(list.id, "7");
    const showItem = await addShow(list.id, "7");

    const detail = await getListDetail(TEST_USER_ID, list.id);
    expect(detail?.items).toHaveLength(2);
    const movie = detail!.items.find((i) => i.kind === "movie");
    const show = detail!.items.find((i) => i.kind === "show");
    expect(movie).toMatchObject({
      itemId: movieItem.id,
      title: "Seven Movie",
      titleId: "7",
    });
    expect(show).toMatchObject({
      itemId: showItem.id,
      title: "Seven Show",
      titleId: "7",
    });
  });

  it("gives the poster, the UTC year, and nulls when they are missing", async () => {
    const list = await seedList("L");
    await seedMovie("1", { poster: "/a.jpg", release: "2019-12-31T23:30:00Z" });
    await seedMovie("2", { poster: null, release: null });
    await seedShow({ showId: "10", offsets: [-1] });
    await prisma.show.update({
      where: { id: "10" },
      data: { posterPath: "/s.jpg", firstAirDate: at("2015-01-01T00:00:00Z") },
    });
    await seedShow({ showId: "11", offsets: [-1] });
    for (const id of ["1", "2"]) await addMovie(list.id, id);
    for (const id of ["10", "11"]) await addShow(list.id, id);

    const detail = await getListDetail(TEST_USER_ID, list.id);
    const byId = Object.fromEntries(
      detail!.items.map((i) => [`${i.kind}${i.titleId}`, i]),
    );
    expect(byId.movie1).toMatchObject({ posterPath: "/a.jpg", year: "2019" });
    expect(byId.movie2).toMatchObject({ posterPath: null, year: null });
    expect(byId.show10).toMatchObject({ posterPath: "/s.jpg", year: "2015" });
    expect(byId.show11).toMatchObject({ posterPath: null, year: null });
  });
});

describe("getListsForTitle", () => {
  it("is empty when the account has no lists", async () => {
    expect(await getListsForTitle(TEST_USER_ID, "movie", "1")).toEqual([]);
  });

  it("returns every list newest first, flagging those holding the title", async () => {
    const a = await seedList("A", { createdAt: "2026-01-01T00:00:00Z" });
    const b = await seedList("B", { createdAt: "2026-02-01T00:00:00Z" });
    await seedList("Theirs", { userId: OTHER, createdAt: "2026-03-01T00:00:00Z" });
    await seedMovie("1");
    const item = await addMovie(a.id, "1");

    expect(await getListsForTitle(TEST_USER_ID, "movie", "1")).toEqual([
      { listId: b.id, name: "B", onList: false, itemId: null },
      { listId: a.id, name: "A", onList: true, itemId: item.id },
    ]);
  });

  it("does not treat a show as on a list holding only the movie with its id", async () => {
    const list = await seedList("L");
    await seedMovie("7");
    const movieItem = await addMovie(list.id, "7");

    expect(await getListsForTitle(TEST_USER_ID, "show", "7")).toEqual([
      { listId: list.id, name: "L", onList: false, itemId: null },
    ]);
    expect(await getListsForTitle(TEST_USER_ID, "movie", "7")).toEqual([
      { listId: list.id, name: "L", onList: true, itemId: movieItem.id },
    ]);
  });
});

describe("getListDetail ratings", () => {
  it("carries each item's own rating", async () => {
    const list = await seedList("L");
    await seedMovie("1");
    await seedMovie("2");
    await seedMovie("3");
    await trackMovie("1", "watched");
    await prisma.trackedMovie.update({
      where: { userId_movieId: { userId: TEST_USER_ID, movieId: "1" } },
      data: { rating: 7 },
    });
    await trackMovie("2", "watched"); // unrated
    // movie 3 is untracked
    await seedSeasonedShow({ showId: "50", seasons: [2, 2] });
    await seedSeasonedShow({ showId: "51", seasons: [1], status: null });
    await watchEpisode("50-s1e1", 10);
    await watchEpisode("50-s2e1", 6);
    await addMovie(list.id, "1");
    await addMovie(list.id, "2");
    await addMovie(list.id, "3");
    await addShow(list.id, "50");
    await addShow(list.id, "51");

    const items = (await getListDetail(TEST_USER_ID, list.id))!.items;
    const byKey = new Map(items.map((i) => [`${i.kind}:${i.titleId}`, i.rating]));
    expect(byKey.get("movie:1")).toBe(7);
    expect(byKey.get("movie:2")).toBeNull();
    expect(byKey.get("movie:3")).toBeNull();
    expect(byKey.get("show:50")).toBe(8);
    expect(byKey.get("show:51")).toBeNull();
  });

  it("keeps a movie and a show sharing an id apart", async () => {
    const list = await seedList("L");
    await seedMovie("77");
    await trackMovie("77", "watched");
    await prisma.trackedMovie.update({
      where: { userId_movieId: { userId: TEST_USER_ID, movieId: "77" } },
      data: { rating: 3 },
    });
    await seedSeasonedShow({ showId: "77", seasons: [1] });
    await watchEpisode("77-s1e1", 9);
    await addMovie(list.id, "77");
    await addShow(list.id, "77");

    const items = (await getListDetail(TEST_USER_ID, list.id))!.items;
    expect(items.find((i) => i.kind === "movie")!.rating).toBe(3);
    expect(items.find((i) => i.kind === "show")!.rating).toBe(9);
  });
});
