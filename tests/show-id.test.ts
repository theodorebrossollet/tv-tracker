import { describe, expect, it } from "vitest";

import { isTmdbShowId } from "@/lib/show-id";

describe("show id validation", () => {
  it("accepts a plain TMDB id", () => {
    expect(isTmdbShowId("1399")).toBe(true);
  });

  it("rejects values that redirect the TMDB request path", () => {
    // Each of these interpolates into `/tv/${id}` as a different endpoint —
    // the last one because `new URL` normalises the traversal away.
    for (const crafted of [
      "1399/season/1",
      "1399?append_to_response=x",
      "1399/../../authentication",
      "1399#fragment",
    ]) {
      expect(isTmdbShowId(crafted)).toBe(false);
    }
  });

  it("rejects the empty and whitespace-only cases", () => {
    expect(isTmdbShowId("")).toBe(false);
    expect(isTmdbShowId("  ")).toBe(false);
    expect(isTmdbShowId(" 1399 ")).toBe(false);
  });

  it("rejects ids that merely start with digits", () => {
    // `\d+` unanchored would let this through, and it is the shape a crafted
    // value actually takes.
    expect(isTmdbShowId("1399abc")).toBe(false);
  });
});
