import { describe, expect, it } from "vitest";

import {
  FAILURE_THRESHOLD,
  describeWait,
  isLockedOut,
  lockoutMs,
} from "@/lib/login-throttle";

describe("lockoutMs", () => {
  it("costs nothing below the threshold, so typos are free", () => {
    for (let failed = 0; failed < FAILURE_THRESHOLD; failed++) {
      expect(lockoutMs(failed), `${failed} failures`).toBe(0);
    }
  });

  it("starts locking at the threshold and doubles after", () => {
    const first = lockoutMs(FAILURE_THRESHOLD);
    const second = lockoutMs(FAILURE_THRESHOLD + 1);

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first * 2);
  });

  it("caps, so an account is never locked for days", () => {
    // An uncapped doubling turns a nuisance into real damage, and buys nothing:
    // five minutes already reduces a guesser to a few hundred tries a day.
    const capped = lockoutMs(FAILURE_THRESHOLD + 50);

    expect(capped).toBe(lockoutMs(FAILURE_THRESHOLD + 20));
    expect(capped).toBeLessThanOrEqual(300_000);
  });

  it("stays finite for absurd counts", () => {
    // 2 ** 1024 is Infinity, and Infinity survives Math.min against a number,
    // which would produce an Invalid Date downstream.
    for (const failed of [1000, 100_000, Number.MAX_SAFE_INTEGER]) {
      const result = lockoutMs(failed);
      expect(Number.isFinite(result), `${failed}`).toBe(true);
      expect(result).toBeLessThanOrEqual(300_000);
    }
  });
});

describe("isLockedOut", () => {
  const now = new Date("2026-08-01T12:00:00Z");

  it("is false when never locked", () => {
    expect(isLockedOut(null, now)).toBe(false);
  });

  it("is true while the lock is in the future, false once it passes", () => {
    expect(isLockedOut(new Date(now.getTime() + 1000), now)).toBe(true);
    expect(isLockedOut(new Date(now.getTime() - 1000), now)).toBe(false);
    // Exactly at the boundary the wait is over.
    expect(isLockedOut(new Date(now.getTime()), now)).toBe(false);
  });
});

describe("describeWait", () => {
  const now = new Date("2026-08-01T12:00:00Z");
  const inSeconds = (s: number) => new Date(now.getTime() + s * 1000);

  it("rounds up to something a person can act on", () => {
    expect(describeWait(inSeconds(20), now)).toBe("in about a minute");
    expect(describeWait(inSeconds(60), now)).toBe("in about a minute");
    expect(describeWait(inSeconds(61), now)).toBe("in about 2 minutes");
    expect(describeWait(inSeconds(300), now)).toBe("in about 5 minutes");
  });
});
