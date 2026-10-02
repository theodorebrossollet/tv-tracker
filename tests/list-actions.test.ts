import { beforeEach, describe, expect, it, vi } from "vitest";

// Same doubles as movie-actions.test.ts: no request scope for revalidatePath,
// and a stubbed session that individual tests can point at another account.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: "test-user", nickname: "test-user", hasPassword: true },
  })),
}));

// `ensureShowCached` calls `after()` for a stale show, which needs a request
// scope; these tests only ever see fresh or absent shows.
vi.mock("next/server", () => ({ after: vi.fn() }));

vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  getMovieDetails: vi.fn(),
}));

vi.mock("@/lib/shows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shows")>();
  return { ...actual, ensureShowCached: vi.fn(actual.ensureShowCached) };
});

const {
  createList,
  updateList,
  deleteList,
  addToList,
  removeFromList,
  setListItemWatched,
} = await import("@/app/list-actions");
const { getMovieDetails, TmdbError } = await import("@/lib/tmdb");
const { ensureShowCached } = await import("@/lib/shows");
const { NEW_MOVIES_PER_HOUR } = await import("@/lib/movies");
const { requireOnboardedSession } = await import("@/lib/auth");
const { MAX_LISTS, LIST_NAME_MAX, MAX_ITEMS_PER_LIST } = await import("@/lib/lists");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedUser, TEST_USER_ID } = await import("./helpers");

const OTHER = "other";

function actAs(id: string) {
  vi.mocked(requireOnboardedSession).mockImplementation(
    async () =>
      ({
        sessionId: "s",
        user: { id, nickname: id, hasPassword: true },
      }) as never,
  );
}

async function listCount(userId = TEST_USER_ID) {
  return prisma.list.count({ where: { userId } });
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  actAs(TEST_USER_ID);
  vi.mocked(getMovieDetails).mockReset();
  vi.mocked(getMovieDetails).mockImplementation(async (id: string | number) => movieDetails(id));
  vi.mocked(ensureShowCached).mockClear();
});

function movieDetails(id: string | number) {
  return {
    id: Number(id),
    title: `Movie ${id}`,
    posterPath: null,
    overview: null,
    releaseDate: null,
    runtime: 100,
    status: "Released",
    genres: null,
  };
}

// ---------------------------------------------------------------------------
// Create, rename, delete
// ---------------------------------------------------------------------------

describe("createList", () => {
  it("trims the name and stores the flag", async () => {
    const result = await createList("  Date night  ", true);

    expect(result.ok).toBe(true);
    const row = await prisma.list.findUnique({ where: { id: result.id! } });
    expect(row).toMatchObject({
      userId: TEST_USER_ID,
      name: "Date night",
      trackSeparately: true,
    });

    const second = await createList("Solo", false);
    expect(
      (await prisma.list.findUnique({ where: { id: second.id! } }))
        ?.trackSeparately,
    ).toBe(false);
  });

  it("refuses an empty, blank, over-long or non-string name", async () => {
    for (const bad of ["", "   ", "x".repeat(LIST_NAME_MAX + 1), 5, null]) {
      const result = await createList(bad as never, false);
      expect(result.ok).toBe(false);
      expect(result.id).toBeUndefined();
    }
    expect(await listCount()).toBe(0);
  });

  it("refuses a non-boolean trackSeparately", async () => {
    for (const bad of ["true", 1, null, undefined]) {
      expect(await createList("A", bad as never)).toEqual({
        ok: false,
        error: "That change isn't available.",
      });
    }
    expect(await listCount()).toBe(0);
  });

  it("allows the 50th list and refuses the 51st", async () => {
    await prisma.list.createMany({
      data: Array.from({ length: MAX_LISTS - 1 }, (_, i) => ({
        userId: TEST_USER_ID,
        name: `L${i}`,
      })),
    });

    expect((await createList("Fiftieth", false)).ok).toBe(true);
    expect(await listCount()).toBe(MAX_LISTS);

    const result = await createList("Fifty-first", false);
    expect(result).toEqual({
      ok: false,
      error: "You've reached the limit of 50 lists.",
    });
    expect(await listCount()).toBe(MAX_LISTS);
  });

  it("counts the limit per account", async () => {
    await seedUser(OTHER);
    await prisma.list.createMany({
      data: Array.from({ length: MAX_LISTS }, (_, i) => ({
        userId: OTHER,
        name: `L${i}`,
      })),
    });

    expect((await createList("Mine", false)).ok).toBe(true);
  });
});

describe("updateList", () => {
  it("renames the list and flips the flag", async () => {
    const { id } = await createList("Old", false);

    expect(
      await updateList(id!, { name: "  New  ", trackSeparately: true }),
    ).toEqual({ ok: true });

    expect(await prisma.list.findUnique({ where: { id: id! } })).toMatchObject({
      name: "New",
      trackSeparately: true,
    });
  });

  it("refuses bad input and leaves the row alone", async () => {
    const { id } = await createList("Keep", false);

    for (const changes of [
      { name: "", trackSeparately: false },
      { name: "x".repeat(LIST_NAME_MAX + 1), trackSeparately: false },
      { name: "Ok", trackSeparately: "yes" },
      null,
    ]) {
      expect((await updateList(id!, changes as never)).ok).toBe(false);
    }
    expect((await updateList(5 as never, { name: "Ok", trackSeparately: false })).ok).toBe(false);
    expect((await updateList("", { name: "Ok", trackSeparately: false })).ok).toBe(false);

    expect(await prisma.list.findUnique({ where: { id: id! } })).toMatchObject({
      name: "Keep",
      trackSeparately: false,
    });
  });

  it("refuses an unknown id", async () => {
    expect(
      await updateList("nope", { name: "X", trackSeparately: false }),
    ).toEqual({ ok: false, error: "List not found." });
  });

  it("refuses another user's list and leaves it unchanged", async () => {
    await seedUser(OTHER);
    const theirs = await prisma.list.create({
      data: { userId: OTHER, name: "Theirs" },
    });

    expect(
      await updateList(theirs.id, { name: "Mine now", trackSeparately: true }),
    ).toEqual({ ok: false, error: "List not found." });

    expect(await prisma.list.findUnique({ where: { id: theirs.id } })).toMatchObject({
      name: "Theirs",
      trackSeparately: false,
    });
  });

  it("keeps every item's watchedAt when the flag is flipped off and on", async () => {
    const { id } = await createList("Together", true);
    const when = new Date("2026-01-02T03:04:05.000Z");
    await prisma.movie.create({ data: { id: "603", title: "Movie 603" } });
    await prisma.listItem.create({
      data: { listId: id!, movieId: "603", watchedAt: when },
    });

    const flag = async () =>
      (await prisma.list.findUnique({ where: { id: id! } }))?.trackSeparately;
    expect(await flag()).toBe(true);

    expect(
      await updateList(id!, { name: "Together", trackSeparately: false }),
    ).toEqual({ ok: true });
    expect(await flag()).toBe(false);

    expect(
      await updateList(id!, { name: "Together", trackSeparately: true }),
    ).toEqual({ ok: true });
    expect(await flag()).toBe(true);

    const item = await prisma.listItem.findFirst({ where: { listId: id! } });
    expect(item?.watchedAt?.toISOString()).toBe(when.toISOString());
  });
});

describe("deleteList", () => {
  it("removes the list and its items but not the titles or Library tracking", async () => {
    const { id } = await createList("Doomed", false);
    await prisma.movie.create({ data: { id: "603", title: "Movie 603" } });
    await prisma.trackedMovie.create({
      data: { userId: TEST_USER_ID, movieId: "603", status: "watchlist" },
    });
    await prisma.listItem.create({ data: { listId: id!, movieId: "603" } });

    expect(await deleteList(id!)).toEqual({ ok: true });

    expect(await prisma.list.count()).toBe(0);
    expect(await prisma.listItem.count()).toBe(0);
    expect(await prisma.movie.count({ where: { id: "603" } })).toBe(1);
    expect(await prisma.trackedMovie.count({ where: { movieId: "603" } })).toBe(1);
  });

  it("refuses an unknown id or a non-string", async () => {
    expect(await deleteList("nope")).toEqual({
      ok: false,
      error: "List not found.",
    });
    expect((await deleteList(5 as never)).ok).toBe(false);
    expect((await deleteList("")).ok).toBe(false);
  });

  it("refuses another user's list and leaves it, with its items", async () => {
    await seedUser(OTHER);
    const theirs = await prisma.list.create({
      data: { userId: OTHER, name: "Theirs" },
    });
    await prisma.movie.create({ data: { id: "603", title: "Movie 603" } });
    await prisma.listItem.create({
      data: { listId: theirs.id, movieId: "603" },
    });

    expect(await deleteList(theirs.id)).toEqual({
      ok: false,
      error: "List not found.",
    });

    expect(await listCount(OTHER)).toBe(1);
    expect(await prisma.listItem.count({ where: { listId: theirs.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

async function makeList(trackSeparately = false, userId = TEST_USER_ID) {
  return prisma.list.create({
    data: { userId, name: "L", trackSeparately },
  });
}

async function itemRows(listId: string) {
  return prisma.listItem.findMany({ where: { listId } });
}

async function libraryRows() {
  return (
    (await prisma.trackedMovie.count()) + (await prisma.trackedShow.count())
  );
}

describe("addToList", () => {
  it("adds a movie, caching it, without touching the Library", async () => {
    const list = await makeList();

    expect(await addToList(list.id, "movie", "603")).toEqual({ ok: true });

    const items = await itemRows(list.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ movieId: "603", showId: null, watchedAt: null });
    expect(await prisma.movie.count({ where: { id: "603" } })).toBe(1);
    expect(await libraryRows()).toBe(0);
  });

  it("adds a show, caching it, without touching the Library", async () => {
    const list = await makeList();
    vi.mocked(ensureShowCached).mockImplementationOnce(async (id) => {
      await prisma.show.create({ data: { id, name: "Show" } });
      return true;
    });

    expect(await addToList(list.id, "show", "1399")).toEqual({ ok: true });

    const items = await itemRows(list.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ showId: "1399", movieId: null });
    expect(ensureShowCached).toHaveBeenCalledWith("1399", TEST_USER_ID);
    expect(await prisma.show.count({ where: { id: "1399" } })).toBe(1);
    expect(await libraryRows()).toBe(0);
  });

  it("keeps a movie and a show with the same id on one list", async () => {
    const list = await makeList();
    await prisma.show.create({ data: { id: "603", name: "Show 603" } });

    expect(await addToList(list.id, "movie", "603")).toEqual({ ok: true });
    expect(await addToList(list.id, "show", "603")).toEqual({ ok: true });

    const items = await itemRows(list.id);
    expect(items.map((i) => [i.movieId, i.showId]).sort()).toEqual(
      [["603", null], [null, "603"]].sort(),
    );
  });

  it("leaves one row after a duplicate add", async () => {
    const list = await makeList();

    expect(await addToList(list.id, "movie", "603")).toEqual({ ok: true });
    expect(await addToList(list.id, "movie", "603")).toEqual({ ok: true });

    expect(await itemRows(list.id)).toHaveLength(1);
  });

  it("treats two concurrent adds as one success", async () => {
    const list = await makeList();
    // Yields to the event loop so both calls are past any pre-check before
    // either writes; without it the calls run back to back and prove nothing.
    vi.mocked(getMovieDetails).mockImplementation(async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return movieDetails(id);
    });

    const results = await Promise.all([
      addToList(list.id, "movie", "603"),
      addToList(list.id, "movie", "603"),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(await itemRows(list.id)).toHaveLength(1);
    expect(getMovieDetails).toHaveBeenCalledTimes(2);
  });

  it("allows the 500th item and refuses the 501st", async () => {
    const list = await makeList();
    await prisma.movie.createMany({
      data: Array.from({ length: MAX_ITEMS_PER_LIST }, (_, i) => ({
        id: `m${i}`,
        title: `M${i}`,
      })),
    });
    await prisma.listItem.createMany({
      data: Array.from({ length: MAX_ITEMS_PER_LIST - 1 }, (_, i) => ({
        listId: list.id,
        movieId: `m${i}`,
      })),
    });

    expect(await addToList(list.id, "movie", "603")).toEqual({ ok: true });
    expect(await itemRows(list.id)).toHaveLength(MAX_ITEMS_PER_LIST);

    const result = await addToList(list.id, "movie", "604");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
    expect(await itemRows(list.id)).toHaveLength(MAX_ITEMS_PER_LIST);
  });

  it("refuses a malformed id, unknown kind or another user's list without TMDB", async () => {
    await seedUser(OTHER);
    const mine = await makeList();
    const theirs = await makeList(false, OTHER);

    for (const id of ["12/x", "", 603, null]) {
      expect((await addToList(mine.id, "movie", id as never)).ok).toBe(false);
      expect((await addToList(mine.id, "show", id as never)).ok).toBe(false);
    }
    for (const kind of ["episode", "", null, undefined]) {
      expect((await addToList(mine.id, kind as never, "603")).ok).toBe(false);
    }
    expect(await addToList(theirs.id, "movie", "603")).toEqual({
      ok: false,
      error: "List not found.",
    });
    expect(await addToList("nope", "movie", "603")).toEqual({
      ok: false,
      error: "List not found.",
    });

    expect(getMovieDetails).not.toHaveBeenCalled();
    expect(ensureShowCached).not.toHaveBeenCalled();
    expect(await prisma.listItem.count()).toBe(0);
    expect(await prisma.movie.count()).toBe(0);
  });

  it("reports a title TMDB doesn't know", async () => {
    const list = await makeList();
    vi.mocked(getMovieDetails).mockRejectedValueOnce(new TmdbError("gone", 404));

    expect(await addToList(list.id, "movie", "999999")).toEqual({
      ok: false,
      error: "Couldn't find that title.",
    });

    vi.mocked(ensureShowCached).mockResolvedValueOnce(false);
    expect(await addToList(list.id, "show", "999999")).toEqual({
      ok: false,
      error: "Couldn't find that title.",
    });
    expect(await itemRows(list.id)).toHaveLength(0);
  });

  it("surfaces the movie allowance message", async () => {
    const list = await makeList();
    await prisma.movie.createMany({
      data: Array.from({ length: NEW_MOVIES_PER_HOUR }, (_, i) => ({
        id: `9${i}`,
        title: `M${i}`,
        addedById: TEST_USER_ID,
        createdAt: new Date(),
      })),
    });

    expect(await addToList(list.id, "movie", "603")).toEqual({
      ok: false,
      error: "You've added a lot of new movies. Please try again in a bit.",
    });
    expect(await itemRows(list.id)).toHaveLength(0);
  });
});

describe("removeFromList", () => {
  it("removes the item but keeps the list, title and Library", async () => {
    const list = await makeList();
    await prisma.movie.create({ data: { id: "603", title: "M" } });
    await prisma.trackedMovie.create({
      data: { userId: TEST_USER_ID, movieId: "603", status: "watchlist" },
    });
    const item = await prisma.listItem.create({
      data: { listId: list.id, movieId: "603" },
    });

    expect(await removeFromList(list.id, item.id)).toEqual({ ok: true });

    expect(await itemRows(list.id)).toHaveLength(0);
    expect(await prisma.list.count()).toBe(1);
    expect(await prisma.movie.count()).toBe(1);
    expect(await libraryRows()).toBe(1);
  });

  it("refuses another user's list and item, leaving them", async () => {
    await seedUser(OTHER);
    const theirs = await makeList(false, OTHER);
    await prisma.movie.create({ data: { id: "603", title: "M" } });
    const item = await prisma.listItem.create({
      data: { listId: theirs.id, movieId: "603" },
    });

    expect(await removeFromList(theirs.id, item.id)).toEqual({
      ok: false,
      error: "List not found.",
    });
    expect(await itemRows(theirs.id)).toHaveLength(1);
  });

  it("refuses an item that sits on a different list than the one named", async () => {
    await seedUser(OTHER);
    const mine = await makeList();
    const theirs = await makeList(false, OTHER);
    await prisma.movie.create({ data: { id: "603", title: "M" } });
    const item = await prisma.listItem.create({
      data: { listId: theirs.id, movieId: "603" },
    });

    expect((await removeFromList(mine.id, item.id)).ok).toBe(false);
    expect(await itemRows(theirs.id)).toHaveLength(1);
  });

  it("refuses bad ids", async () => {
    const list = await makeList();
    expect((await removeFromList(list.id, "nope")).ok).toBe(false);
    expect((await removeFromList(5 as never, "x")).ok).toBe(false);
    expect((await removeFromList(list.id, 5 as never)).ok).toBe(false);
    expect((await removeFromList("", "")).ok).toBe(false);
  });
});

describe("setListItemWatched", () => {
  async function seedItem(list: { id: string }) {
    await prisma.movie.upsert({
      where: { id: "603" },
      create: { id: "603", title: "M" },
      update: {},
    });
    return prisma.listItem.create({
      data: { listId: list.id, movieId: "603" },
    });
  }

  it("sets then clears watchedAt on a separate-tracking list", async () => {
    const list = await makeList(true);
    const item = await seedItem(list);

    expect(await setListItemWatched(list.id, item.id, true)).toEqual({ ok: true });
    const watched = await prisma.listItem.findUnique({ where: { id: item.id } });
    expect(watched?.watchedAt).toBeInstanceOf(Date);

    expect(await setListItemWatched(list.id, item.id, false)).toEqual({ ok: true });
    expect(
      (await prisma.listItem.findUnique({ where: { id: item.id } }))?.watchedAt,
    ).toBeNull();
  });

  it("is refused on a personal list and changes nothing", async () => {
    const list = await makeList(false);
    const item = await seedItem(list);

    expect(await setListItemWatched(list.id, item.id, true)).toEqual({
      ok: false,
      error: "That list doesn't track watched separately.",
    });
    expect(
      (await prisma.listItem.findUnique({ where: { id: item.id } }))?.watchedAt,
    ).toBeNull();
  });

  it("is refused for another user's list and changes nothing", async () => {
    await seedUser(OTHER);
    const theirs = await makeList(true, OTHER);
    const item = await seedItem(theirs);

    expect(await setListItemWatched(theirs.id, item.id, true)).toEqual({
      ok: false,
      error: "List not found.",
    });
    expect(
      (await prisma.listItem.findUnique({ where: { id: item.id } }))?.watchedAt,
    ).toBeNull();
  });

  it("is refused for an item on a different list and a non-boolean flag", async () => {
    const a = await makeList(true);
    const b = await makeList(true);
    const item = await seedItem(b);

    expect((await setListItemWatched(a.id, item.id, true)).ok).toBe(false);
    for (const bad of ["true", 1, null, undefined]) {
      expect((await setListItemWatched(b.id, item.id, bad as never)).ok).toBe(false);
    }
    expect(
      (await prisma.listItem.findUnique({ where: { id: item.id } }))?.watchedAt,
    ).toBeNull();
  });
});
