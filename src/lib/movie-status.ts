import type { MovieStatus } from "@/lib/types";

// Movie status rules, kept pure (no server-only imports) so the status menu can
// share them with the server actions and both test without React.
//
// Unlike shows, every movie status can reach every other: there is no progress
// to protect. An untracked movie can go straight to "watched" for a film
// already seen, without a detour through the watchlist.

/** A status the user can move a movie *to*, plus removal. */
export type MovieStatusTarget = MovieStatus | "remove";

/**
 * The statuses reachable from `status`, in the order they should be listed.
 *
 * Excludes the current value: the menu renders that separately as the checked
 * row, so a target appearing here is always a real change. Removal is offered
 * from every tracked state and is not part of this list.
 */
export function movieStatusTargets(status: MovieStatus | null): MovieStatus[] {
  switch (status) {
    case null:
      return ["watchlist", "watched"];
    case "watchlist":
      return ["watched", "not_interested"];
    case "watched":
      return ["watchlist", "not_interested"];
    case "not_interested":
      return ["watchlist", "watched"];
  }
}

/**
 * The `watchedAt` to store when moving to `next`: now for "watched", cleared
 * (null) for anything else. Rewatching isn't modelled, so there is no history
 * to preserve when moving away.
 */
export function watchedAtFor(next: MovieStatus, now: Date): Date | null {
  return next === "watched" ? now : null;
}

/**
 * Splits a watchlist into movies that are out and movies that aren't. A movie
 * with no release date counts as not out: nothing says it can be watched.
 */
export function splitByRelease<T extends { releaseDate: Date | null }>(
  movies: T[],
  now: Date = new Date(),
): { released: T[]; unreleased: T[] } {
  const released: T[] = [];
  const unreleased: T[] = [];

  for (const movie of movies) {
    (movie.releaseDate && movie.releaseDate <= now ? released : unreleased).push(
      movie,
    );
  }

  return { released, unreleased };
}
