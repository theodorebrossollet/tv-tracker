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
 * Two rules the wording follows. The headline answers the question you opened
 * the show to ask — when do I get more? — rather than restating the label above
 * it; and whenever an episode is known, the card names it, so a show you follow
 * always tells you which episode you're waiting on even when nothing is
 * scheduled.
 *
 * Client-safe on purpose: the card that renders this is a client component, so
 * nothing here may reach `lib/tmdb.ts` or anything else importing `server-only`.
 *
 * This derives nothing about what has *aired* or what counts as *finished* —
 * those rules live in `lib/queries.ts` and `hasSeriesEnded`, and are passed in
 * already resolved. See AGENTS.md.
 */

import { hasSeriesEnded } from "@/lib/format";

/**
 * How many unwatched episodes the Next-up card is given to rotate through.
 *
 * Capped rather than complete. Skip walks to the following unwatched episode
 * without marking anything, so the card needs more than the one it is showing —
 * but a show you have just added has every episode unwatched, and shipping all
 * of them to power a button most visits never press is the payload problem the
 * show page was rebuilt to avoid. Eight is several presses' worth; past that
 * the rotation wraps.
 *
 * It lives here, and not beside the card it describes, because the *page*
 * slices with it and the page is a Server Component. Exported from the card's
 * `"use client"` module, it reached the server as a client reference rather
 * than as `8` — see the note in `page.tsx`, and `tests/client-boundary.test.ts`,
 * which fails if it ever moves back.
 */
export const NEXT_UP_QUEUE = 8;

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
  | "season-complete"
  /**
   * Aired episodes are still unwatched — which means this card should not be
   * on screen at all. See the note on the branch that returns it.
   */
  | "behind";

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
  const watchedCount = seasons.reduce(
    (total, season) => total + season.watchedCount,
    0,
  );
  const behind = airedCount - watchedCount;

  // Never claims more watched than was watched. The first version of this
  // line read `All ${airedCount} episodes watched` and never looked at
  // `watchedCount`, so it asserted a finished show whatever the truth was —
  // and it shipped saying "All 20 episodes watched" on a show with 15 of 20
  // watched, which is how it hid the mismatch the guard below now reports.
  const watchedLine = () =>
    watchedCount === airedCount
      ? `All ${airedCount} episode${airedCount === 1 ? "" : "s"} watched`
      : `${watchedCount} of ${airedCount} episodes watched`;

  // Which episode you're waiting on, named. TMDB usually has no title for an
  // unannounced episode, and "S02E06 · Untitled episode" is worse than
  // "S02E06" — the placeholder is longer than the fact and says less.
  const episodeLine = (episode: UpNextEpisode) =>
    episode.name ? `${episode.code} · ${episode.name}` : episode.code;

  // This card is only rendered when nothing aired is left to watch, so a show
  // with unwatched aired episodes cannot legitimately reach it. It has been
  // seen doing so — a show 15 of 20 watched, with the season strip correctly
  // showing 5 outstanding, rendered "Season 2 complete". Whatever produces
  // that, the card's job is to not add a third answer to a page already giving
  // two: it says what the counts say, and `show.progress_mismatch` in the page
  // logs the render so the cause can be found.
  if (behind > 0) {
    return {
      kind: "behind",
      label: "Not caught up",
      title: `${behind} episode${behind === 1 ? "" : "s"} left to watch`,
      detail: watchedLine(),
      icon: "clock",
    };
  }

  if (airedCount === 0) {
    return next?.date
      ? {
          kind: "premiere-scheduled",
          label: "Upcoming",
          title: `Premieres ${next.date}`,
          detail: episodeLine(next),
          icon: "clock",
        }
      : {
          kind: "premiere-unannounced",
          label: "Upcoming",
          // The headline carries the fact. "Not aired yet" restated the label
          // and left the one thing you came to find out on the second line.
          title: "No release date yet",
          detail: next ? episodeLine(next) : "Nothing has aired yet",
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
          detail: watchedLine(),
          icon: "check",
        }
      : {
          kind: "season-complete",
          label: `Season ${currentNumber} complete`,
          title: "No new episodes announced yet",
          detail: watchedLine(),
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
          detail: episodeLine(next),
          icon: "check",
        }
      : {
          kind: "season-unscheduled",
          label: `Up to date with season ${currentNumber}`,
          title: `No release date yet for the rest of season ${currentNumber}`,
          detail: episodeLine(next),
          icon: "check",
        };
  }

  return next.date
    ? {
        kind: "next-season-scheduled",
        label: `Season ${currentNumber} complete`,
        title: `Season ${next.seasonNumber} premieres ${next.date}`,
        detail: episodeLine(next),
        icon: "check",
      }
    : {
        kind: "next-season-announced",
        label: `Season ${currentNumber} complete`,
        title: `No release date yet for season ${next.seasonNumber}`,
        detail: episodeLine(next),
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
