import { beforeEach, describe, expect, it, vi } from "vitest";

// The route's job is to decide who may run a refresh and to survive one bad
// show; the sync itself is covered in shows.test.ts.
vi.mock("@/lib/shows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shows")>()),
  syncShowFromTmdb: vi.fn(async () => ({ name: "Test Show", episodeCount: 3 })),
}));

const { GET } = await import("@/app/api/cron/refresh-episodes/route");
const { syncShowFromTmdb } = await import("@/lib/shows");
const { TmdbError } = await import("@/lib/tmdb");
const { resetDatabase, seedShow, seedUser } = await import("./helpers");

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/cron/refresh-episodes", {
    headers,
  });
}

beforeEach(async () => {
  await resetDatabase();
  await seedUser();
  vi.unstubAllEnvs();
  vi.mocked(syncShowFromTmdb).mockClear();
  vi.mocked(syncShowFromTmdb).mockImplementation(async () => ({
    name: "Test Show",
    episodeCount: 3,
  }));
});

describe("who may trigger a refresh", () => {
  const withSecret = () => vi.stubEnv("CRON_SECRET", "s3cret");

  it("rejects a request with no bearer token", async () => {
    withSecret();

    const response = await GET(request());

    expect(response.status).toBe(401);
    // The point of the check: an open endpoint would let anyone burn through
    // the TMDB rate limit.
    expect(syncShowFromTmdb).not.toHaveBeenCalled();
  });

  it("rejects the wrong token", async () => {
    withSecret();

    expect((await GET(request({ authorization: "Bearer wrong" }))).status).toBe(
      401,
    );
  });

  it("rejects a token that merely starts correctly", async () => {
    withSecret();

    expect((await GET(request({ authorization: "Bearer s3cr" }))).status).toBe(
      401,
    );
  });

  it("rejects a token that contains the secret but isn't it", async () => {
    // Guards the comparison itself: `startsWith` or `includes` here would let
    // a padded token through, and both are easy to reach for.
    withSecret();

    expect(
      (await GET(request({ authorization: "Bearer s3cret-and-then-some" })))
        .status,
    ).toBe(401);
  });

  it("accepts the configured token", async () => {
    withSecret();

    expect(
      (await GET(request({ authorization: "Bearer s3cret" }))).status,
    ).toBe(200);
  });

  it("rejects the app password instead of the cron secret", async () => {
    // Basic auth is what the rest of the app uses; it must not open this.
    withSecret();

    expect(
      (await GET(request({ authorization: "Basic czNjcmV0" }))).status,
    ).toBe(401);
  });
});

describe("when no secret is configured", () => {
  it("refuses to run in production rather than sitting open", async () => {
    // A deployment that forgot the variable must fail closed.
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    expect((await GET(request())).status).toBe(401);
  });

  it("runs unauthenticated outside production, for local development", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");

    expect((await GET(request())).status).toBe(200);
  });
});

describe("what the refresh covers", () => {
  beforeEach(() => vi.stubEnv("CRON_SECRET", "s3cret"));

  const authorized = () => GET(request({ authorization: "Bearer s3cret" }));

  it("visits tracked shows only, and reports the counts", async () => {
    await seedShow({ showId: "1", offsets: [-1], status: "watching" });
    await seedShow({ showId: "2", offsets: [-1], status: "watchlist" });
    // Cached from a search but never added — the cron isn't its refresh path.
    await seedShow({ showId: "3", offsets: [-1], status: null });

    const body = await (await authorized()).json();

    expect(body).toEqual({ checked: 2, refreshed: 2, failed: [] });
    expect(
      vi
        .mocked(syncShowFromTmdb)
        .mock.calls.map(([id]) => id)
        .sort(),
    ).toEqual(["1", "2"]);
  });

  it("keeps going when one show fails, and names it in the response", async () => {
    // One bad show must not cost every other show its refresh.
    await seedShow({ showId: "1", offsets: [-1], status: "watching" });
    await seedShow({ showId: "2", offsets: [-1], status: "watching" });

    vi.mocked(syncShowFromTmdb).mockImplementation(async (showId) => {
      if (showId === "2")
        throw new TmdbError("TMDB request failed (500).", 500);
      return { name: "Test Show", episodeCount: 3 };
    });

    const response = await authorized();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checked).toBe(2);
    expect(body.refreshed).toBe(1);
    expect(body.failed).toEqual([
      { showId: "2", error: "TMDB request failed (500)." },
    ]);
  });

  it("does not leak an unexpected error's message to the caller", async () => {
    await seedShow({ showId: "1", offsets: [-1], status: "watching" });

    vi.mocked(syncShowFromTmdb).mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.5:8080"),
    );

    const body = await (await authorized()).json();

    expect(body.failed).toEqual([{ showId: "1", error: "Unexpected error" }]);
  });

  it("reports what the run cost, so the headroom stays measured", async () => {
    // docs/technical-design.md reads the timeout budget off this. An estimate
    // in a doc goes stale silently; a number in every run's log doesn't.
    await seedShow({ showId: "1", offsets: [-1], status: "watching" });
    await seedShow({ showId: "2", offsets: [-1], status: "watching" });

    const { logger } = await import("@/lib/logger");
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    await authorized();

    const [, fields] = info.mock.calls.find(
      ([event]) => event === "cron.refresh.completed",
    )!;

    expect(typeof fields!.durationMs).toBe("number");
    expect(fields!.msPerShow).toBe(
      Math.round((fields!.durationMs as number) / 2),
    );

    info.mockRestore();
  });

  it("reports no per-show cost when there was nothing to check", async () => {
    // Rather than dividing by zero and logging Infinity.
    const { logger } = await import("@/lib/logger");
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    await authorized();

    const [, fields] = info.mock.calls.find(
      ([event]) => event === "cron.refresh.completed",
    )!;

    expect(fields!.msPerShow).toBeNull();

    info.mockRestore();
  });

  it("succeeds with nothing tracked", async () => {
    const body = await (await authorized()).json();

    expect(body).toEqual({ checked: 0, refreshed: 0, failed: [] });
  });
});

describe("finishing inside the deadline", () => {
  const authorized = async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    return GET(request({ authorization: "Bearer s3cret" }));
  };

  it("visits the least recently synced shows first", async () => {
    // Without an order this is whatever the database returns — stable enough
    // that a run which can't finish would refresh the same prefix every night
    // and never reach the tail. Oldest-first makes successive runs rotate.
    const { prisma } = await import("@/lib/prisma");

    for (const [showId, hoursAgo] of [
      ["1", 1],
      ["2", 72],
      ["3", 24],
    ] as const) {
      await seedShow({ showId, offsets: [-1], status: "watching" });
      await prisma.show.update({
        where: { id: showId },
        data: { lastSynced: new Date(Date.now() - hoursAgo * 3600_000) },
      });
    }

    await authorized();

    expect(
      vi.mocked(syncShowFromTmdb).mock.calls.map(([showId]) => showId),
    ).toEqual(["2", "3", "1"]);
  });

  it("stops before the timeout kills it, and says how many it skipped", async () => {
    // Being terminated mid-loop takes the completion log and the session sweep
    // with it — so the run leaves no record, and expired sessions quietly stop
    // being deleted. Yielding early keeps both.
    for (const showId of ["1", "2", "3"]) {
      await seedShow({ showId, offsets: [-1], status: "watching" });
    }

    // Each show burns a minute of the budget, so only the first fits.
    const realNow = Date.now;
    let clock = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.mocked(syncShowFromTmdb).mockImplementation(async () => {
      clock += 60_000;
      return { name: "Test Show", episodeCount: 3 };
    });

    const { logger } = await import("@/lib/logger");
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const response = await authorized();

    expect(syncShowFromTmdb).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);

    // Warn, not info. A truncated run is the one worth noticing, and warnings
    // go to stderr — an info line among a year of identical info lines is not
    // noticing. Asserting the level is what keeps that true.
    expect(
      info.mock.calls.some(([event]) => event === "cron.refresh.completed"),
    ).toBe(false);

    const [, fields] = warn.mock.calls.find(
      ([event]) => event === "cron.refresh.completed",
    )!;

    expect(fields!.deadlineHit).toBe(true);
    expect(fields!.skipped).toBe(2);

    info.mockRestore();
    warn.mockRestore();
    vi.mocked(Date.now).mockRestore();
  });

  it("stays at info level on an ordinary run", async () => {
    await seedShow({ showId: "1", offsets: [-1], status: "watching" });

    const { logger } = await import("@/lib/logger");
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await authorized();

    const [, fields] = info.mock.calls.find(
      ([event]) => event === "cron.refresh.completed",
    )!;

    expect(fields!.deadlineHit).toBe(false);
    expect(fields!.skipped).toBe(0);
    expect(
      warn.mock.calls.some(([event]) => event === "cron.refresh.completed"),
    ).toBe(false);

    info.mockRestore();
    warn.mockRestore();
  });
});
