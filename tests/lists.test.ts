import { describe, expect, it } from "vitest";
import {
  LIST_NAME_MAX,
  MAX_ITEMS_PER_LIST,
  MAX_LISTS,
  isListItemWatched,
  isListKind,
  validateListName,
} from "@/lib/lists";
import type { MovieStatus } from "@/lib/types";

describe("list limits", () => {
  it("uses the spec values", () => {
    expect(LIST_NAME_MAX).toBe(60);
    expect(MAX_LISTS).toBe(50);
    expect(MAX_ITEMS_PER_LIST).toBe(500);
  });
});

describe("isListKind", () => {
  it.each([
    ["movie", true],
    ["show", true],
    ["tv", false],
    ["", false],
    [undefined, false],
    [1, false],
  ])("isListKind(%j) is %s", (value, expected) => {
    expect(isListKind(value)).toBe(expected);
  });
});

describe("validateListName", () => {
  it("trims surrounding whitespace", () => {
    expect(validateListName("  Family  ")).toEqual({ ok: true, name: "Family" });
  });

  it("accepts exactly the maximum length", () => {
    const name = "a".repeat(LIST_NAME_MAX);
    expect(validateListName(name)).toEqual({ ok: true, name });
  });

  it("counts length after trimming", () => {
    const name = "a".repeat(LIST_NAME_MAX);
    expect(validateListName(`  ${name}  `)).toEqual({ ok: true, name });
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["undefined", undefined],
    ["a number", 42],
    ["null", null],
  ])("rejects %s", (_label, input) => {
    expect(validateListName(input)).toEqual({
      ok: false,
      error: "Enter a name for the list.",
    });
  });

  it("rejects a name over the maximum length", () => {
    expect(validateListName("a".repeat(LIST_NAME_MAX + 1))).toEqual({
      ok: false,
      error: "Keep the name to 60 characters or fewer.",
    });
  });
});

describe("isListItemWatched", () => {
  const ticked = new Date("2026-01-01T00:00:00Z");
  type Row = {
    label: string;
    trackSeparately: boolean;
    tickedAt: Date | null;
    kind: "movie" | "show";
    movieStatus: MovieStatus | null;
    showFinished: boolean;
    expected: boolean;
  };
  const rows: Row[] = [
    { label: "personal movie watched", trackSeparately: false, tickedAt: null, kind: "movie", movieStatus: "watched", showFinished: false, expected: true },
    { label: "personal movie watchlist", trackSeparately: false, tickedAt: null, kind: "movie", movieStatus: "watchlist", showFinished: false, expected: false },
    { label: "personal movie not_interested", trackSeparately: false, tickedAt: null, kind: "movie", movieStatus: "not_interested", showFinished: false, expected: false },
    { label: "personal movie untracked", trackSeparately: false, tickedAt: null, kind: "movie", movieStatus: null, showFinished: false, expected: false },
    { label: "personal show finished", trackSeparately: false, tickedAt: null, kind: "show", movieStatus: null, showFinished: true, expected: true },
    { label: "personal show not finished", trackSeparately: false, tickedAt: null, kind: "show", movieStatus: null, showFinished: false, expected: false },
    { label: "personal movie ignores tickedAt", trackSeparately: false, tickedAt: ticked, kind: "movie", movieStatus: "watchlist", showFinished: false, expected: false },
    { label: "personal untracked movie ignores tickedAt", trackSeparately: false, tickedAt: ticked, kind: "movie", movieStatus: null, showFinished: false, expected: false },
    { label: "personal show ignores tickedAt", trackSeparately: false, tickedAt: ticked, kind: "show", movieStatus: null, showFinished: false, expected: false },
    { label: "together movie ticked", trackSeparately: true, tickedAt: ticked, kind: "movie", movieStatus: null, showFinished: false, expected: true },
    { label: "together movie not ticked", trackSeparately: true, tickedAt: null, kind: "movie", movieStatus: null, showFinished: false, expected: false },
    { label: "together show ticked", trackSeparately: true, tickedAt: ticked, kind: "show", movieStatus: null, showFinished: false, expected: true },
    { label: "together show not ticked", trackSeparately: true, tickedAt: null, kind: "show", movieStatus: null, showFinished: false, expected: false },
    { label: "together movie ignores Library watched", trackSeparately: true, tickedAt: null, kind: "movie", movieStatus: "watched", showFinished: false, expected: false },
    { label: "together show ignores Library finished", trackSeparately: true, tickedAt: null, kind: "show", movieStatus: null, showFinished: true, expected: false },
  ];

  it.each(rows)("$label", (row) => {
    expect(isListItemWatched(row)).toBe(row.expected);
  });
});
