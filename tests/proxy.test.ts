import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

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

  it("challenges a request with no credentials", () => {
    withPassword();

    const response = proxy(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("rejects the wrong password", () => {
    withPassword();

    expect(proxy(request(basic("x", "wrong"))).status).toBe(401);
  });

  it("accepts the right password", () => {
    withPassword();

    expect(proxy(request(basic("x", "correct horse"))).status).toBe(200);
  });

  it("ignores the username", () => {
    // Browsers require both fields; only the password is meaningful here.
    withPassword();

    expect(proxy(request(basic("anyone at all", "correct horse"))).status).toBe(
      200,
    );
  });

  it("rejects a password that merely starts correctly", () => {
    withPassword();

    expect(proxy(request(basic("x", "correct"))).status).toBe(401);
  });

  it("rejects a non-Basic scheme", () => {
    // Notably a Bearer token: the cron's credential must not open the app.
    withPassword();

    expect(
      proxy(request({ authorization: "Bearer correct horse" })).status,
    ).toBe(401);
  });

  it("rejects malformed base64 instead of throwing", () => {
    withPassword();

    expect(proxy(request({ authorization: "Basic !!!not base64!!!" })).status).toBe(
      401,
    );
  });
});

describe("with no password configured", () => {
  it("serves normally in development", () => {
    vi.stubEnv("APP_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(proxy(request()).status).toBe(200);
  });

  it("refuses to serve in production rather than sitting open", () => {
    // A deployment that forgot the variable must not silently expose the data.
    vi.stubEnv("APP_PASSWORD", "");
    vi.stubEnv("NODE_ENV", "production");

    const response = proxy(request());

    expect(response.status).toBe(503);
    // No challenge header: no password could satisfy it, so prompting is wrong.
    expect(response.headers.get("www-authenticate")).toBeNull();
  });
});
