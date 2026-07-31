import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { syncShowFromTmdb } from "@/lib/shows";

import { resetDatabase } from "./helpers";

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
        (total, [args]) => total + (args.data as unknown[]).length,
        0,
      );
    },
  };
}

beforeEach(async () => {
  await resetDatabase();
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
    await prisma.watchedEpisode.create({ data: { episodeId: "63056" } });

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
