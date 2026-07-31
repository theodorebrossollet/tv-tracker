import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "@/proxy";

function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://example.test/", { headers });
}

function basic(username: string, password: string) {
  return { authorization: `Basic ${btoa(`${username}:${password}`)}` };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with a password configured", () => {
  const withPassword = () => vi.stubEnv("APP_PASSWORD", "correct horse");

  it("challenges a request with no credentials", async () => {
    withPassword();

    const response = await proxy(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("rejects the wrong password", async () => {
    withPassword();

    expect((await proxy(request(basic("x", "wrong")))).status).toBe(401);
  });

  it("accepts the right password", async () => {
    withPassword();

    expect((await proxy(request(basic("x", "correct horse")))).status).toBe(200);
  });

  it("ignores the username", async () => {
    // Browsers require both fields; only the password is meaningful here.
    withPassword();

    expect(
      (await proxy(request(basic("anyone at all", "correct horse")))).status,
    ).toBe(200);
  });

  it("rejects a password that merely starts correctly", async () => {
    withPassword();

    expect((await proxy(request(basic("x", "correct")))).status).toBe(401);
  });

  it("rejects a non-Basic scheme", async () => {
    // Notably a Bearer token: the cron's credential must not open the app.
    withPassword();

    expect(
      (await proxy(request({ authorization: "Bearer correct horse" }))).status,
    ).toBe(401);
  });

  it("rejects malformed base64 instead of throwing", async () => {
    withPassword();

    expect(
      (await proxy(request({ authorization: "Basic !!!not base64!!!" }))).status,
    ).toBe(401);
  });
});

describe("throttling wrong passwords", () => {
  const withPassword = () => vi.stubEnv("APP_PASSWORD", "correct horse");

  async function elapsed(run: () => Promise<unknown>) {
    const started = Date.now();
    await run();
    return Date.now() - started;
  }

  it("makes a wrong password wait before it is told so", async () => {
    withPassword();

    // Slows a serial guesser. Parallel requests sidestep it — the real control
    // is rate limiting at the platform edge.
    expect(
      await elapsed(() => proxy(request(basic("x", "wrong")))),
    ).toBeGreaterThanOrEqual(400);
  });

  it("does not delay the credential-less challenge", async () => {
    withPassword();

    // Every browser's opening request looks like this. Delaying it would put
    // half a second on the first load of every session for no security gain.
    expect(await elapsed(() => proxy(request()))).toBeLessThan(200);
  });

  it("does not delay a correct password", async () => {
    withPassword();

    expect(
      await elapsed(() => proxy(request(basic("x", "correct horse")))),
    ).toBeLessThan(200);
  });
});

describe("the matcher", () => {
  // The gate's one hole. Everything behind it must authenticate itself, so its
  // exact shape is worth pinning down.
  const gated = (pathname: string) =>
    new RegExp(`^${config.matcher[0]}$`).test(pathname);

  it("leaves the cron route to its own bearer-token check", () => {
    expect(gated("/api/cron/refresh-episodes")).toBe(false);
  });

  it("gates a route that merely starts with the same prefix", () => {
    // Written as `api/cron` the lookahead matched by prefix, so this would
    // have slipped past the password gate by accident.
    expect(gated("/api/cron-debug")).toBe(true);
  });

  it("gates pages and server action POSTs", () => {
    expect(gated("/")).toBe(true);
    expect(gated("/show/1399")).toBe(true);
    expect(gated("/settings")).toBe(true);
  });

  it("leaves static assets open", () => {
    expect(gated("/_next/static/chunk.js")).toBe(false);
    expect(gated("/favicon.ico")).toBe(false);
  });
});

describe("with no password configured", () => {
  it("serves normally in development", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "development");

    expect((await proxy(request())).status).toBe(200);
  });

  it("refuses to serve in production rather than sitting open", async () => {
    // A deployment that forgot the variable must not silently expose the data.
    vi.stubEnv("APP_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "production");

    const response = await proxy(request());

    expect(response.status).toBe(503);
    // No challenge header: no password could satisfy it, so prompting is wrong.
    expect(response.headers.get("www-authenticate")).toBeNull();
  });
});
