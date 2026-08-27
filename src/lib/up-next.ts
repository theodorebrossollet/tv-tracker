/**
 * What the Episodes tab says when there is nothing aired left to watch.
 *
 * "Caught up" was the only answer here, and it covered situations that have
 * nothing to do with each other: a series that has ended, a season you have
 * finished with the next one already dated, and a show you are midway through
 * whose remaining episodes TMDB hasn't scheduled. That last one is the one
 * that reads as a bug — you are in the middle of season 2 and the app tells
 * you you're caught up, with no hint that it means "on everything released so
 * far". Each case gets its own wording instead.
 *
 * Client-safe on purpose: the card that renders this is a client component, so
 * nothing here may reach `lib/tmdb.ts` or anything else importing `server-only`.
 *
 * This derives nothing about what has *aired* or what counts as *finished* —
 * those rules live in `lib/queries.ts` and `hasSeriesEnded`, and are passed in
 * already resolved. See AGENTS.md.
 */

import { hasSeriesEnded } from "@/lib/format";

export interface SeasonProgress {
  seasonNumber: number;
  /** Episodes of this season that have aired, per `getShowDetail`. */
  airedCount: number;
  watchedCount: number;
}

/** The first episode that hasn't aired yet, dated or not. */
export interface UpNextEpisode {
  seasonNumber: number;
  /** "S03E01" — formatted by the caller, which owns `episodeCode`. */
  code: string;
  name: string | null;
  /** Pre-formatted air date, or null when TMDB hasn't scheduled it. */
  date: string | null;
}

export type UpNextKind =
  /** Nothing has aired, and the premiere has a date. */
  | "premiere-scheduled"
  /** Nothing has aired and no date is announced. */
  | "premiere-unannounced"
  /** Every aired episode watched, and TMDB says the series is over. */
  | "series-finished"
  /** More of the season you're in, with a date. */
  | "season-continues"
  /** More of the season you're in, unscheduled. */
  | "season-unscheduled"
  /** Season done, next one dated. */
  | "next-season-scheduled"
  /** Season done, next one listed but unscheduled. */
  | "next-season-announced"
  /** Season done, nothing further announced, series still running. */
  | "season-complete";

export interface UpNextState {
  kind: UpNextKind;
  /** The small mono label at the top of the card. */
  label: string;
  /** The headline: what situation you're actually in. */
  title: string;
  /** The supporting line under it. */
  detail: string;
  /**
   * A tick claims you're up to date, which is false before a show has aired
   * anything — there the card is an announcement, not an achievement.
   */
  icon: "check" | "clock";
}

/**
 * Describes the state of a show with nothing aired-and-unwatched left.
 *
 * Only called in that case: while an aired episode is unwatched the card is
 * the Next-up one, which has something to act on.
 */
export function upNextState({
  showStatus,
  seasons,
  next,
}: {
  showStatus: string | null;
  /** Ascending by season number, as `getShowDetail` returns them. */
  seasons: SeasonProgress[];
  next: UpNextEpisode | null;
}): UpNextState {
  const airedCount = seasons.reduce(
    (total, season) => total + season.airedCount,
    0,
  );

  if (airedCount === 0) {
    return next?.date
      ? {
          kind: "premiere-scheduled",
          label: "Upcoming",
          title: `Premieres ${next.date}`,
          detail: `${next.code} · ${next.name ?? "Untitled episode"}`,
          icon: "clock",
        }
      : {
          kind: "premiere-unannounced",
          label: "Upcoming",
          title: "Not aired yet",
          detail: "No air date announced",
          icon: "clock",
        };
  }

  // The season you are actually sitting in: the last one with anything aired.
  // Not the last season TMDB lists, which for a show between seasons is the
  // announced one you have watched none of.
  const current =
    [...seasons].reverse().find((season) => season.airedCount > 0) ?? null;
  const currentNumber = current?.seasonNumber ?? 1;

  if (!next) {
    return hasSeriesEnded(showStatus)
      ? {
          kind: "series-finished",
          label: "Series finished",
          title: "You've watched every episode",
          detail: `All ${airedCount} episode${airedCount === 1 ? "" : "s"} watched`,
          icon: "check",
        }
      : {
          kind: "season-complete",
          label: `Season ${currentNumber} complete`,
          title: "Waiting on a new season",
          detail: "No further episodes announced",
          icon: "check",
        };
  }

  // An unaired episode of the season you're in means the season isn't over,
  // whatever TMDB's series status says — a mid-season break, not a wait for a
  // renewal, and the two deserve different words.
  const sameSeason = next.seasonNumber === currentNumber;

  if (sameSeason) {
    return next.date
      ? {
          kind: "season-continues",
          label: `Up to date with season ${currentNumber}`,
          title: `Season ${currentNumber} continues ${next.date}`,
          detail: `${next.code} · ${next.name ?? "Untitled episode"}`,
          icon: "check",
        }
      : {
          kind: "season-unscheduled",
          label: `Up to date with season ${currentNumber}`,
          title: `More of season ${currentNumber} to come`,
          detail: "No air date announced for the rest of the season",
          icon: "check",
        };
  }

  return next.date
    ? {
        kind: "next-season-scheduled",
        label: `Season ${currentNumber} complete`,
        title: `Season ${next.seasonNumber} premieres ${next.date}`,
        detail: `${next.code} · ${next.name ?? "Untitled episode"}`,
        icon: "check",
      }
    : {
        kind: "next-season-announced",
        label: `Season ${currentNumber} complete`,
        title: `Season ${next.seasonNumber} announced`,
        detail: "No air date announced yet",
        icon: "check",
      };
}

/**
 * The season to open a show on when the URL doesn't name one.
 *
 * `preferred` is the season holding the next unwatched aired episode, which is
 * the right answer whenever there is one. When there isn't — you're caught up
 * — the old fallback was season 1, so a show you're two seasons into opened on
 * a season you finished a year ago and every visit cost a tap to get back to
 * where you are. The last season you've watched into is that place.
 */
export function currentSeason(
  seasons: SeasonProgress[],
  preferred?: number,
): number | undefined {
  if (preferred !== undefined) return preferred;

  return [...seasons].reverse().find((season) => season.watchedCount > 0)
    ?.seasonNumber;
}
