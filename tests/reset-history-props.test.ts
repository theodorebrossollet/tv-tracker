import { describe, expect, it } from "vitest";

import { movieResetHistory, showResetHistory } from "@/lib/rewatch";

describe("showResetHistory", () => {
  it("is offered when something is watched", () => {
    expect(showResetHistory(3, [])).toEqual({ watched: 3, pastRuns: 0 });
  });

  it("is offered with past runs only", () => {
    expect(showResetHistory(0, [{}, {}])).toEqual({ watched: 0, pastRuns: 2 });
  });

  it("carries unreadable history as null when something is watched", () => {
    expect(showResetHistory(2, null)).toEqual({ watched: 2, pastRuns: null });
  });

  it("is withheld with nothing watched and unreadable or empty history", () => {
    expect(showResetHistory(0, null)).toBeNull();
    expect(showResetHistory(0, [])).toBeNull();
  });
});

describe("movieResetHistory", () => {
  it("is offered for a watched movie", () => {
    expect(movieResetHistory("watched", [])).toEqual({
      pastWatches: 0,
      watched: true,
    });
  });

  it("is offered for any movie with past watches", () => {
    expect(movieResetHistory(null, [{}])).toEqual({
      pastWatches: 1,
      watched: false,
    });
    expect(movieResetHistory("watchlist", [{}, {}])).toEqual({
      pastWatches: 2,
      watched: false,
    });
  });

  it("carries unreadable history as null", () => {
    expect(movieResetHistory("watched", null)).toEqual({
      pastWatches: null,
      watched: true,
    });
  });

  it("is withheld when there is nothing to reset", () => {
    expect(movieResetHistory(null, [])).toBeNull();
    expect(movieResetHistory(null, null)).toBeNull();
    expect(movieResetHistory("watchlist", [])).toBeNull();
    expect(movieResetHistory("not_interested", null)).toBeNull();
  });
});
