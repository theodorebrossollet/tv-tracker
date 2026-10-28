import { describe, expect, it } from "vitest";

import { ROW_COMMIT, rowCommits, rowOffset } from "@/lib/swipe-row";

describe("rowOffset", () => {
  it("follows the finger rightwards, then slows to a third", () => {
    expect(rowOffset(40)).toBe(40);
    expect(rowOffset(132)).toBe(132);
    expect(rowOffset(162)).toBe(142);
  });

  it("never moves the card left of where it rests, and never returns NaN", () => {
    expect(rowOffset(-60)).toBe(0);
    expect(rowOffset(Number.NaN)).toBe(0);
    expect(rowOffset(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("rowCommits", () => {
  it("marks only at or past the threshold, and only rightwards", () => {
    expect(rowCommits(ROW_COMMIT - 1)).toBe(false);
    expect(rowCommits(ROW_COMMIT)).toBe(true);
    expect(rowCommits(-ROW_COMMIT * 2)).toBe(false);
    expect(rowCommits(Number.NaN)).toBe(false);
  });
});
