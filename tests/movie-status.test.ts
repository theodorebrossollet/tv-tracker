import { describe, expect, it } from "vitest";
import { movieStatusTargets, watchedAtFor } from "@/lib/movie-status";
import { isMovieStatus, type MovieStatus } from "@/lib/types";

const STATUSES: MovieStatus[] = ["watchlist", "watched", "not_interested"];

describe("movieStatusTargets", () => {
  it.each([
    [null, ["watchlist", "watched"]],
    ["watchlist", ["watched", "not_interested"]],
    ["watched", ["watchlist", "not_interested"]],
    ["not_interested", ["watchlist", "watched"]],
  ] as const)("from %s offers %j", (status, expected) => {
    expect(movieStatusTargets(status)).toEqual(expected);
  });

  it.each(STATUSES)("never contains its own input (%s)", (status) => {
    expect(movieStatusTargets(status)).not.toContain(status);
  });
});

describe("watchedAtFor", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("stamps now when moving to watched", () => {
    expect(watchedAtFor("watched", now)).toBe(now);
  });

  it.each(["watchlist", "not_interested"] as const)(
    "clears it when moving to %s",
    (status) => {
      expect(watchedAtFor(status, now)).toBeNull();
    },
  );
});

describe("isMovieStatus", () => {
  it.each(STATUSES)("accepts %s", (v) => {
    expect(isMovieStatus(v)).toBe(true);
  });

  it.each(["watching", "", undefined])("rejects %j", (v) => {
    expect(isMovieStatus(v)).toBe(false);
  });
});
