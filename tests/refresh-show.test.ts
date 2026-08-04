import { beforeEach, describe, expect, it, vi } from "vitest";

// Same doubles as tracking.test.ts: no request scope for revalidatePath, and
// no session to build. TMDB is mocked at `fetch`, so the real sync runs against
// the real test database — which is the point, since this action decides
// success by whether that sync moved `lastSynced`.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireOnboardedSession: vi.fn(async () => ({
    sessionId: "test-session",
    user: { id: "test-user", nickname: "test-user", hasPassword: true },
  })),
}));

const { refreshShow } = await import("@/app/actions");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase, seedUser } = await import("./helpers");

const SHOW_ID = "1399";
const MINUTE_MS = 60 * 1000;

/** Answers `/tv/{id}` and `/tv/{id}/season/{n}` with one episode. */
function mockTmdb({ failing = false }: { failing?: boolean } = {}) {
  const fetchMock = vi.fn(async (url: URL | string) => {
    if (failing) throw new Error("network down");

    const path = url.toString();
    const body = path.includes("/season/")
      ? {
          episodes: [
            {
              id: 63056,
              season_number: 1,
              episode_number: 1,
              name: "Winter Is Coming",
              air_date: "2011-04-17",
              runtime: 62,
              overview: "An episode.",
            },
          ],
        }
      : {
          id: Number(SHOW_ID),
          name: "Game of Thrones",
          poster_path: null,
          overview: null,
          seasons: [{ season_number: 1, episode_count: 1 }],
          first_air_date: "2011-04-17",
          last_air_date: "2019-05-19",
          status: "Ended",
        };

    return { ok: true, status: 200, json: async () => body };
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A cached show whose last sync was `minutesAgo` minutes ago. */
async function seedShow(minutesAgo: number) {
  await prisma.show.create({
    data: {
      id: SHOW_ID,
      name: "Game of Thrones",
      lastSynced: new Date(Date.now() - minutesAgo * MINUTE_MS),
    },
  });
}

async function lastSynced() {
  const show = await prisma.show.findUnique({
    where: { id: SHOW_ID },
    select: { lastSynced: true },
  });

  return show?.lastSynced.getTime();
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await resetDatabase();
  await seedUser();
});

describe("refreshing a show on demand", () => {
  it("re-syncs one that is old enough", async () => {
    await seedShow(60);
    const before = await lastSynced();
    const fetchMock = mockTmdb();

    const result = await refreshShow(SHOW_ID);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    expect(await lastSynced()).toBeGreaterThan(before!);
  });

  it("writes the episodes it fetched", async () => {
    // The timestamp moving is what the action reports on, but it would move
    // for an empty sync too — this is the part the reader actually wanted.
    await seedShow(60);
    mockTmdb();

    await refreshShow(SHOW_ID);

    expect(await prisma.episode.count({ where: { showId: SHOW_ID } })).toBe(1);
  });
});

describe("the cooldown", () => {
  it("declines a show synced moments ago, without reaching TMDB", async () => {
    // The rate limit and the honest answer in one: this action is the most
    // expensive thing in the app and is POST-able directly.
    await seedShow(1);
    const before = await lastSynced();
    const fetchMock = mockTmdb();

    const result = await refreshShow(SHOW_ID);

    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await lastSynced()).toBe(before);
  });

  it("reports success rather than an error", async () => {
    // "You're already up to date" is not a failure, and surfacing one would
    // put a red message under a button that did the right thing.
    await seedShow(1);
    mockTmdb();

    expect((await refreshShow(SHOW_ID)).error).toBeUndefined();
  });
});

describe("when the refresh doesn't land", () => {
  it("reports a failure rather than a silent success", async () => {
    // `refreshShowDeduped` never rejects — it catches and logs — so the only
    // thing that distinguishes a failed sync is the timestamp not moving. If
    // this ever regressed, every failed refresh would say "Updated just now".
    await seedShow(60);
    const before = await lastSynced();
    mockTmdb({ failing: true });

    const result = await refreshShow(SHOW_ID);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/TMDB/);
    expect(await lastSynced()).toBe(before);
  });
});

describe("what it refuses outright", () => {
  it("rejects an id that isn't one", async () => {
    // Flows into a TMDB request path, same guard as every other action that
    // takes a show id.
    const fetchMock = mockTmdb();

    expect((await refreshShow("../../etc/passwd")).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a show it holds nothing for", async () => {
    // Opening the show is what caches it in the first place; there is nothing
    // here to refresh, and syncing would make this action a way to populate
    // the cache for arbitrary ids.
    const fetchMock = mockTmdb();

    const result = await refreshShow("99999");

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
