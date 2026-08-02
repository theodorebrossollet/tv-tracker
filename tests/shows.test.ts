import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { ensureShowCached, syncShowFromTmdb } from "@/lib/shows";

// `after` throws outside a request scope, and these call `ensureShowCached`
// directly. Collecting the callbacks rather than running them is also what lets
// a test see the two halves separately: what the response carried, and what
// happened once it had gone.
const { scheduled } = vi.hoisted(() => ({
  scheduled: [] as Array<() => unknown>,
}));

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => {
    scheduled.push(callback);
  },
}));

/** Runs the callbacks `after` was handed, the way the platform would. */
async function runScheduledWork() {
  await Promise.all(scheduled.splice(0).map((callback) => callback()));
}

import { TEST_USER_ID, resetDatabase, seedUser } from "./helpers";

const SHOW_ID = "1399";

interface EpisodePayload {
  id: number;
  season_number?: number;
  episode_number: number;
  name?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  overview?: string | null;
}

/**
 * Answers the two endpoints a sync hits — `/tv/{id}` and `/tv/{id}/season/{n}`
 * — from one flat list of episodes, all in season 1.
 */
function mockTmdb(episodes: EpisodePayload[]) {
  const fetchMock = vi.fn(async (url: URL | string) => {
    const path = url.toString();

    const body = path.includes("/season/")
      ? {
          episodes: episodes.map((episode) => ({
            season_number: 1,
            name: "Episode",
            air_date: "2011-04-17",
            runtime: 60,
            overview: "An episode.",
            ...episode,
          })),
        }
      : {
          id: Number(SHOW_ID),
          name: "Game of Thrones",
          poster_path: null,
          overview: null,
          seasons: [{ season_number: 1, episode_count: episodes.length }],
          first_air_date: "2011-04-17",
          last_air_date: "2019-05-19",
          status: "Ended",
        };

    return { ok: true, status: 200, json: async () => body };
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const HOUR_MS = 60 * 60 * 1000;

/** A cached show row with a controlled `lastSynced` and no episodes yet. */
async function seedCachedShow(hoursSinceSync: number) {
  await prisma.show.create({
    data: {
      id: SHOW_ID,
      name: "Game of Thrones",
      lastSynced: new Date(Date.now() - hoursSinceSync * HOUR_MS),
    },
  });
}

/** Counts the episode writes a call makes, by kind. */
function countWrites() {
  const created = vi.spyOn(prisma.episode, "createMany");
  const updated = vi.spyOn(prisma.episode, "update");
  // The pre-batching implementation wrote one upsert per episode; if that ever
  // comes back, it has to show up here rather than reading as "no writes".
  const upserted = vi.spyOn(prisma.episode, "upsert");

  return {
    get creates() {
      return created.mock.calls.length;
    },
    get updates() {
      return updated.mock.calls.length;
    },
    get upserts() {
      return upserted.mock.calls.length;
    },
    /** Rows actually handed to createMany, which batches many per call. */
    get createdRows() {
      return created.mock.calls.reduce(
        (total, [args]) => total + ((args?.data as unknown[]) ?? []).length,
        0,
      );
    },
  };
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  scheduled.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("syncing a show from TMDB", () => {
  it("creates every episode on a first sync", async () => {
    mockTmdb([
      { id: 63056, episode_number: 1 },
      { id: 63057, episode_number: 2 },
      { id: 63058, episode_number: 3 },
    ]);

    const writes = countWrites();
    const result = await syncShowFromTmdb(SHOW_ID);

    expect(result.episodeCount).toBe(3);
    expect(await prisma.episode.count({ where: { showId: SHOW_ID } })).toBe(3);

    // Batched: three episodes, one insert.
    expect(writes.creates).toBe(1);
    expect(writes.createdRows).toBe(3);
  });

  it("writes nothing when TMDB returns what we already have", async () => {
    // The cron's common case — a settled show, visited nightly. This is what
    // the per-episode upsert loop cost: 300 round trips to change nothing.
    mockTmdb([
      { id: 63056, episode_number: 1 },
      { id: 63057, episode_number: 2 },
    ]);

    await syncShowFromTmdb(SHOW_ID);

    const writes = countWrites();
    await syncShowFromTmdb(SHOW_ID);

    expect(writes.creates).toBe(0);
    expect(writes.updates).toBe(0);
    expect(writes.upserts).toBe(0);
  });

  it("updates only the episodes that actually changed", async () => {
    mockTmdb([
      { id: 63056, episode_number: 1 },
      { id: 63057, episode_number: 2 },
      { id: 63058, episode_number: 3 },
    ]);

    await syncShowFromTmdb(SHOW_ID);

    // One air date corrected, the other two untouched.
    mockTmdb([
      { id: 63056, episode_number: 1 },
      { id: 63057, episode_number: 2, air_date: "2011-05-01" },
      { id: 63058, episode_number: 3 },
    ]);

    const writes = countWrites();
    await syncShowFromTmdb(SHOW_ID);

    expect(writes.updates).toBe(1);
    expect(writes.upserts).toBe(0);

    const corrected = await prisma.episode.findUnique({
      where: { id: "63057" },
    });
    expect(corrected?.airDate?.toISOString().slice(0, 10)).toBe("2011-05-01");
  });

  it("adds newly announced episodes without touching the existing ones", async () => {
    mockTmdb([{ id: 63056, episode_number: 1 }]);
    await syncShowFromTmdb(SHOW_ID);

    mockTmdb([
      { id: 63056, episode_number: 1 },
      { id: 63057, episode_number: 2 },
    ]);

    const writes = countWrites();
    await syncShowFromTmdb(SHOW_ID);

    expect(writes.createdRows).toBe(1);
    expect(writes.updates).toBe(0);
    expect(await prisma.episode.count({ where: { showId: SHOW_ID } })).toBe(2);
  });

  it("keeps watch history across a re-sync", async () => {
    // Why this is a diff-and-update rather than delete-and-recreate:
    // WatchedEpisode references these rows.
    mockTmdb([{ id: 63056, episode_number: 1 }]);
    await syncShowFromTmdb(SHOW_ID);
    await prisma.watchedEpisode.create({
      data: { userId: TEST_USER_ID, episodeId: "63056" },
    });

    mockTmdb([{ id: 63056, episode_number: 1, name: "Winter Is Coming" }]);
    await syncShowFromTmdb(SHOW_ID);

    expect(await prisma.watchedEpisode.count()).toBe(1);
    expect(
      (await prisma.episode.findUnique({ where: { id: "63056" } }))?.name,
    ).toBe("Winter Is Coming");
  });

  it("survives a TMDB payload that repeats an episode id", async () => {
    // createMany has no skipDuplicates on SQLite, so a repeated id would abort
    // the whole insert if it reached the database twice.
    mockTmdb([
      { id: 63056, episode_number: 1 },
      { id: 63056, episode_number: 1 },
    ]);

    await syncShowFromTmdb(SHOW_ID);

    expect(await prisma.episode.count({ where: { showId: SHOW_ID } })).toBe(1);
  });
});

describe("keeping a cached show fresh", () => {
  it("re-syncs an untracked show once it goes stale", async () => {
    // The regression: `Show.tracked` became a list in v2, and an empty array is
    // truthy — so `if (existing.tracked)` was taken for every cached show, the
    // staleness branch below it was unreachable, and a show cached from a
    // search result kept its first-seen episode data forever.
    await seedCachedShow(25);
    const fetchMock = mockTmdb([{ id: 63056, episode_number: 1 }]);

    expect(await ensureShowCached(SHOW_ID)).toBe(true);

    // Nothing has been fetched yet: the stale copy is what the response
    // carries, and the re-sync is what happens once it has gone.
    expect(fetchMock).not.toHaveBeenCalled();

    await runScheduledWork();

    expect(fetchMock).toHaveBeenCalled();
    expect(await prisma.episode.count({ where: { showId: SHOW_ID } })).toBe(1);
  });

  it("collapses concurrent refreshes of the same show into one sync", async () => {
    // `lastSynced` only moves when a sync finishes, so back-to-back views all
    // see the same stale row. Without the in-flight guard each would start its
    // own sync, and the second `createMany` would collide on the primary key.
    await seedCachedShow(25);
    const fetchMock = mockTmdb([{ id: 63056, episode_number: 1 }]);

    await ensureShowCached(SHOW_ID);
    await ensureShowCached(SHOW_ID);

    expect(scheduled).toHaveLength(2);
    await runScheduledWork();

    // Two scheduled refreshes, one show fetch plus one season fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await prisma.episode.count({ where: { showId: SHOW_ID } })).toBe(1);
  });

  it("keeps serving the stale copy when the background refresh fails", async () => {
    await seedCachedShow(25);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("TMDB unreachable");
      }),
    );

    // The response already went out, so a failed refresh must not surface as a
    // rejection — it's logged and the next view tries again.
    expect(await ensureShowCached(SHOW_ID)).toBe(true);
    await expect(runScheduledWork()).resolves.toBeUndefined();
  });

  it("leaves a show still inside the staleness window alone", async () => {
    await seedCachedShow(1);
    const fetchMock = mockTmdb([{ id: 63056, episode_number: 1 }]);

    expect(await ensureShowCached(SHOW_ID)).toBe(true);

    expect(scheduled).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves a stale tracked show to the cron", async () => {
    // The branch the bug made unconditional. It still has to hold for a show
    // that really is tracked, or the fix just moves the duplicated work.
    await seedCachedShow(25);
    await prisma.trackedShow.create({
      data: { userId: TEST_USER_ID, showId: SHOW_ID, status: "watching" },
    });
    const fetchMock = mockTmdb([{ id: 63056, episode_number: 1 }]);

    expect(await ensureShowCached(SHOW_ID)).toBe(true);

    expect(scheduled).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for a show it holds nothing for", async () => {
    // The one case with nothing to serve, so it stays blocking.
    const fetchMock = mockTmdb([{ id: 63056, episode_number: 1 }]);

    expect(await ensureShowCached(SHOW_ID)).toBe(true);

    expect(fetchMock).toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
    expect(await prisma.episode.count({ where: { showId: SHOW_ID } })).toBe(1);
  });
});

describe("reading settings", () => {
  it("returns defaults without writing a row", async () => {
    // This runs on every show-page render. An upsert is a write statement — it
    // can't be served by a replica and goes to the primary every time — to
    // create a row of defaults that reading them gives anyway.
    const { getSettings } = await import("@/lib/shows");
    const create = vi.spyOn(prisma.settings, "upsert");

    expect(await getSettings(TEST_USER_ID)).toMatchObject({
      notifyEnabled: false,
      country: null,
    });

    expect(create).not.toHaveBeenCalled();
    expect(await prisma.settings.count()).toBe(0);
  });

  it("returns the stored row once one exists", async () => {
    await prisma.settings.create({
      data: { userId: TEST_USER_ID, notifyEnabled: true, country: "FR" },
    });

    const { getSettings } = await import("@/lib/shows");

    expect(await getSettings(TEST_USER_ID)).toMatchObject({
      notifyEnabled: true,
      country: "FR",
    });
  });
});

describe("episodes removed upstream", () => {
  it("deletes an episode TMDB no longer lists", async () => {
    // Schedule reshuffles do this. Left behind, the row keeps inflating the
    // aired count that "finished" is derived from.
    mockTmdb([
      { id: 63056, episode_number: 1 },
      { id: 63057, episode_number: 2 },
    ]);
    await syncShowFromTmdb(SHOW_ID);

    mockTmdb([{ id: 63056, episode_number: 1 }]);
    await syncShowFromTmdb(SHOW_ID);

    expect(
      (await prisma.episode.findMany({ where: { showId: SHOW_ID } })).map(
        (episode) => episode.id,
      ),
    ).toEqual(["63056"]);
  });

  it("keeps one the user has watched, rather than rewriting their history", async () => {
    mockTmdb([
      { id: 63056, episode_number: 1 },
      { id: 63057, episode_number: 2 },
    ]);
    await syncShowFromTmdb(SHOW_ID);
    await prisma.watchedEpisode.create({
      data: { userId: TEST_USER_ID, episodeId: "63057" },
    });

    mockTmdb([{ id: 63056, episode_number: 1 }]);
    await syncShowFromTmdb(SHOW_ID);

    expect(await prisma.episode.count({ where: { id: "63057" } })).toBe(1);
    expect(await prisma.watchedEpisode.count()).toBe(1);
  });

  it("leaves other shows' episodes alone", async () => {
    // The delete is keyed by id, but the ids it considers come from this
    // show's rows only — a neighbouring show must not be caught by it.
    mockTmdb([{ id: 63056, episode_number: 1 }]);
    await syncShowFromTmdb(SHOW_ID);

    await prisma.show.create({ data: { id: "1400", name: "Other" } });
    await prisma.episode.create({
      data: {
        id: "99999",
        showId: "1400",
        seasonNumber: 1,
        episodeNumber: 1,
        name: "Untouched",
        airDate: new Date(),
      },
    });

    mockTmdb([{ id: 63056, episode_number: 1 }]);
    await syncShowFromTmdb(SHOW_ID);

    expect(await prisma.episode.count({ where: { showId: "1400" } })).toBe(1);
  });
});
