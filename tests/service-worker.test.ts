import { readFileSync } from "node:fs";
import { createContext, runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

// public/sw.js is served as a static file, never imported, so there is nothing
// to unit test in the ordinary way. Running the real file inside a fake
// ServiceWorkerGlobalScope tests the shipped bytes rather than a copy of the
// rules — and the rules are the part worth testing: a worker that caches the
// wrong response serves one account's page to another, which no amount of
// server-side scoping would catch.

const ORIGIN = "https://tv-tracker.example";

interface FakeResponse {
  ok: boolean;
  status: number;
  type: string;
  clone: () => FakeResponse;
}

const response = (over: Partial<FakeResponse> = {}): FakeResponse => {
  const value: FakeResponse = {
    ok: true,
    status: 200,
    type: "basic",
    clone: () => value,
    ...over,
  };
  return value;
};

/** Loads sw.js into a fresh fake scope and returns the handles to drive it. */
function loadWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const store = new Map<string, FakeResponse>();

  const cache = {
    put: vi.fn(async (request: { url: string }, value: FakeResponse) => {
      store.set(request.url, value);
    }),
  };

  const fetchMock = vi.fn(async () => response());

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };

  const caches = {
    match: vi.fn(async (request: { url: string }) => store.get(request.url)),
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };

  const context = createContext({
    self,
    caches,
    fetch: fetchMock,
    URL,
    Promise,
    console,
  });

  runInNewContext(readFileSync("public/sw.js", "utf8"), context);

  /** Drives the fetch handler and reports whether it took over the request. */
  async function handleFetch(url: string, fetched = response()) {
    fetchMock.mockResolvedValueOnce(fetched);

    let responded: Promise<FakeResponse> | null = null;
    const handler = listeners.get("fetch");
    if (!handler) throw new Error("sw.js registered no fetch handler");

    handler({
      request: { url, method: "GET" },
      respondWith: (promise: Promise<FakeResponse>) => {
        responded = promise;
      },
    });

    if (responded) await responded;

    return { intercepted: responded !== null, cached: [...store.keys()] };
  }

  return { handleFetch, cache, store };
}

let worker: ReturnType<typeof loadWorker>;

beforeEach(() => {
  worker = loadWorker();
});

describe("what the shell cache stores", () => {
  it("caches build output and icons", async () => {
    const chunk = await worker.handleFetch(`${ORIGIN}/_next/static/chunks/main.js`);
    expect(chunk.intercepted).toBe(true);
    expect(chunk.cached).toContain(`${ORIGIN}/_next/static/chunks/main.js`);

    const icon = await worker.handleFetch(`${ORIGIN}/icon-192.png`);
    expect(icon.cached).toContain(`${ORIGIN}/icon-192.png`);
  });

  it("leaves page routes alone entirely", async () => {
    // Every page is force-dynamic because it renders live, per-account watch
    // state. Caching one would serve it to whoever asks next.
    for (const path of ["/", "/settings", "/watchlist", "/show/1396", "/login"]) {
      const result = await worker.handleFetch(`${ORIGIN}${path}`);
      expect(result.intercepted, path).toBe(false);
      expect(result.cached, path).toEqual([]);
    }
  });

  it("never stores a 401 or a redirect, even for a cacheable path", async () => {
    await worker.handleFetch(
      `${ORIGIN}/_next/static/chunks/a.js`,
      response({ ok: false, status: 401 }),
    );
    await worker.handleFetch(
      `${ORIGIN}/_next/static/chunks/b.js`,
      response({ ok: false, status: 302 }),
    );

    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it("stores only responses it can actually read", async () => {
    // A real opaque response has status 0 and `ok: false`, so the status check
    // above already excludes it — this pins the `type === "basic"` guard, which
    // is defence in depth rather than the primary control. The response below
    // is deliberately impossible (a 200 that is also opaque) precisely to
    // isolate that guard from the ones in front of it.
    await worker.handleFetch(
      `${ORIGIN}/_next/static/chunks/c.js`,
      response({ type: "opaque", status: 200, ok: true }),
    );

    expect(worker.cache.put).not.toHaveBeenCalled();
  });

  it("ignores other origins", async () => {
    const result = await worker.handleFetch("https://image.tmdb.org/t/p/w500/x.jpg");

    expect(result.intercepted).toBe(false);
  });
});
