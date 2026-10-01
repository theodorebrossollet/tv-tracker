import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

const get = () => proxy(new NextRequest("https://example.test/"));

describe("content security policy", () => {
  it("allows scripts only by nonce, never 'unsafe-inline'", () => {
    const policy = get().headers.get("content-security-policy")!;
    const scriptSrc = policy.split("; ").find((d) => d.startsWith("script-src"))!;

    expect(scriptSrc).toMatch(/'nonce-[^']+'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("issues a different nonce on every request", () => {
    const nonce = (r: Response) =>
      r.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1];

    expect(nonce(get())).not.toBe(nonce(get()));
  });

  it("keeps the framing and form restrictions", () => {
    const policy = get().headers.get("content-security-policy")!;

    for (const directive of [
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-src https://www.youtube-nocookie.com",
    ]) {
      expect(policy).toContain(directive);
    }
  });
});
