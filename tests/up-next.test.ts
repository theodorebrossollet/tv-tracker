import { describe, expect, it } from "vitest";

import { currentSeason, upNextState } from "@/lib/up-next";

type Season = { seasonNumber: number; airedCount: number; watchedCount: number };

const season = (
  seasonNumber: number,
  airedCount: number,
  watchedCount: number,
): Season => ({ seasonNumber, airedCount, watchedCount });

const next = (seasonNumber: number, date: string | null) => ({
  seasonNumber,
  code: `S0${seasonNumber}E01`,
  name: "Cold Harbor",
  date,
});

describe("what the card says when nothing aired is left to watch", () => {
  it("announces a premiere for a show that hasn't aired anything", () => {
    const state = upNextState({
      showStatus: "Returning Series",
      seasons: [season(1, 0, 0)],
      next: next(1, "21 Sep 2026"),
    });

    expect(state.kind).toBe("premiere-scheduled");
    expect(state.title).toBe("Premieres 21 Sep 2026");
    // A tick would claim you're up to date with a show you haven't started.
    expect(state.icon).toBe("clock");
  });

  it("says so when the premiere has no date either", () => {
    const state = upNextState({
      showStatus: "Returning Series",
      seasons: [season(1, 0, 0)],
      next: next(1, null),
    });

    expect(state.kind).toBe("premiere-unannounced");
    // The headline is the answer, not a restatement of the label above it.
    expect(state.title).toBe("No release date yet");
    expect(state.detail).toBe("S01E01 · Cold Harbor");
    expect(state.icon).toBe("clock");
  });

  it("calls a finished series finished", () => {
    const state = upNextState({
      showStatus: "Ended",
      seasons: [season(1, 10, 10), season(2, 8, 8)],
      next: null,
    });

    expect(state.kind).toBe("series-finished");
    expect(state.label).toBe("Series finished");
    expect(state.detail).toBe("All 18 episodes watched");
  });

  it("treats Canceled the same as Ended", () => {
    expect(
      upNextState({
        showStatus: "Canceled",
        seasons: [season(1, 10, 10)],
        next: null,
      }).kind,
    ).toBe("series-finished");
  });

  it("counts a single-episode show without an extra s", () => {
    expect(
      upNextState({
        showStatus: "Ended",
        seasons: [season(1, 1, 1)],
        next: null,
      }).detail,
    ).toBe("All 1 episode watched");
  });

  it("distinguishes the rest of the season you're in from the season being over", () => {
    // The case this whole module exists for: midway through season 2, every
    // released episode watched, the remaining ones undated. "Caught up ·
    // Nothing scheduled" read as "this show is done".
    const state = upNextState({
      showStatus: "Returning Series",
      seasons: [season(1, 10, 10), season(2, 5, 5)],
      next: next(2, null),
    });

    expect(state.kind).toBe("season-unscheduled");
    expect(state.label).toBe("Up to date with season 2");
    expect(state.title).toBe("No release date yet for the rest of season 2");
    // Which episode you're waiting on, named — the card is otherwise the one
    // place in the app that tells a followed show's holder nothing at all.
    expect(state.detail).toBe("S02E01 · Cold Harbor");
  });

  it("names the date when the rest of the season has one", () => {
    const state = upNextState({
      showStatus: "Returning Series",
      seasons: [season(1, 10, 10), season(2, 5, 5)],
      next: next(2, "21 Sep 2026"),
    });

    expect(state.kind).toBe("season-continues");
    expect(state.title).toBe("Season 2 continues 21 Sep 2026");
  });

  it("says a season is complete and the next one dated", () => {
    const state = upNextState({
      showStatus: "Returning Series",
      seasons: [season(1, 10, 10), season(2, 8, 8), season(3, 0, 0)],
      next: next(3, "21 Sep 2026"),
    });

    expect(state.kind).toBe("next-season-scheduled");
    expect(state.label).toBe("Season 2 complete");
    expect(state.title).toBe("Season 3 premieres 21 Sep 2026");
  });

  it("says a season is complete and the next one merely announced", () => {
    const state = upNextState({
      showStatus: "Returning Series",
      seasons: [season(1, 10, 10), season(2, 8, 8), season(3, 0, 0)],
      next: next(3, null),
    });

    expect(state.kind).toBe("next-season-announced");
    expect(state.label).toBe("Season 2 complete");
    expect(state.title).toBe("No release date yet for season 3");
    expect(state.detail).toBe("S03E01 · Cold Harbor");
  });

  it("says a running show has nothing announced at all", () => {
    const state = upNextState({
      showStatus: "Returning Series",
      seasons: [season(1, 10, 10), season(2, 8, 8)],
      next: null,
    });

    expect(state.kind).toBe("season-complete");
    expect(state.label).toBe("Season 2 complete");
    expect(state.title).toBe("No new episodes announced yet");
    expect(state.detail).toBe("All 18 episodes watched");
  });

  it("names the episode by code alone when TMDB has no title for it", () => {
    // Future episodes usually have no title, and "S03E01 · Untitled episode"
    // is longer than the code and says less than it.
    const state = upNextState({
      showStatus: "Returning Series",
      seasons: [season(1, 10, 10), season(2, 8, 8)],
      next: { ...next(3, null), name: null },
    });

    expect(state.detail).toBe("S03E01");
  });

  it("reads the season you're in off what has aired, not off what TMDB lists", () => {
    // A show between seasons already carries next season's episode rows, so
    // "the last season" would be one with nothing aired and nothing watched —
    // and the label would read "Season 3 complete" while you wait for it.
    const state = upNextState({
      showStatus: "Returning Series",
      seasons: [season(1, 10, 10), season(2, 8, 8), season(3, 0, 0)],
      next: next(3, "21 Sep 2026"),
    });

    expect(state.label).toBe("Season 2 complete");
  });

  it("treats an unaired episode of the current season as a break, whatever the series status says", () => {
    // TMDB reports plenty of mid-season shows as "Ended" late; the episode
    // data is the more specific signal.
    const state = upNextState({
      showStatus: "Ended",
      seasons: [season(1, 5, 5)],
      next: next(1, null),
    });

    expect(state.kind).toBe("season-unscheduled");
  });
});

describe("which season a show opens on", () => {
  const seasons = [season(1, 10, 10), season(2, 8, 4), season(3, 0, 0)];

  it("takes the season holding the next unwatched episode", () => {
    expect(currentSeason(seasons, 2)).toBe(2);
  });

  it("falls back to the last season you've watched into when you're caught up", () => {
    // The bug: caught up on season 2 meant no preference at all, so every
    // visit opened on season 1 and cost a tap to get back to where you are.
    expect(currentSeason([season(1, 10, 10), season(2, 5, 5), season(3, 0, 0)])).toBe(2);
  });

  it("suggests nothing for a show you haven't started", () => {
    expect(currentSeason([season(1, 0, 0)])).toBeUndefined();
  });
});
