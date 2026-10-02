import { describe, expect, it } from "vitest";
import {
  RATING_MAX,
  RATING_MIN,
  coverageText,
  formatAverage,
  formatRating,
  isRating,
  seasonAverage,
  showAverage,
} from "@/lib/ratings";

describe("rating bounds", () => {
  it("spans 1 to 10", () => {
    expect(RATING_MIN).toBe(1);
    expect(RATING_MAX).toBe(10);
  });
});

describe("isRating", () => {
  it.each([
    [1, true],
    [5, true],
    [10, true],
    [0, false],
    [11, false],
    [-3, false],
    [5.5, false],
    ["7", false],
    [NaN, false],
    [Infinity, false],
    [null, false],
    [undefined, false],
  ])("isRating(%j) is %s", (value, expected) => {
    expect(isRating(value)).toBe(expected);
  });
});

describe("seasonAverage", () => {
  it.each([
    [[8, 6], 7],
    [[7], 7],
    [[], null],
  ])("seasonAverage(%j) is %s", (ratings, expected) => {
    expect(seasonAverage(ratings)).toBe(expected);
  });
});

describe("showAverage", () => {
  it.each([
    [[7, null, 9], 8],
    [[7], 7],
    [[null, null], null],
    [[], null],
  ])("showAverage(%j) is %s", (averages, expected) => {
    expect(showAverage(averages)).toBe(expected);
  });
});

describe("formatRating", () => {
  it("is a whole number", () => {
    expect(formatRating(8)).toBe("8");
  });
});

describe("formatAverage", () => {
  it.each([
    [8, "8.0"],
    [7.4, "7.4"],
    [7.25, "7.3"],
    [10, "10.0"],
    [1, "1.0"],
  ])("formatAverage(%s) is %s", (average, expected) => {
    expect(formatAverage(average)).toBe(expected);
  });
});

describe("coverageText", () => {
  it.each([
    [0, 5, null],
    [1, 5, "1 of 5"],
    [4, 5, "4 of 5"],
    [5, 5, null],
    [6, 5, null],
  ])("season scope (%s, %s)", (rated, watched, suffix) => {
    expect(coverageText(rated, watched, "season")).toBe(
      suffix === null ? null : `${suffix} rated`,
    );
  });

  it.each([
    [0, 5, null],
    [1, 5, "1 of 5"],
    [4, 5, "4 of 5"],
    [5, 5, null],
    [6, 5, null],
  ])("show scope (%s, %s)", (rated, watched, prefix) => {
    expect(coverageText(rated, watched, "show")).toBe(
      prefix === null ? null : `${prefix} watched episodes rated`,
    );
  });
});
