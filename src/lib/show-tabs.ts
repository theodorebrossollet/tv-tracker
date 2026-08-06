/**
 * The show page's two URL params.
 *
 * Both are client state in the handoff and both are search params here, for the
 * reason `ShowMoreLink` already exists: the Watch and About panels are server
 * components that fetch from TMDB, so holding the segment in `useState` would
 * mean rendering all three and hiding two — shipping every provider, region and
 * trailer on every show view, for panels most visits never open.
 *
 * As params, the page can skip those four TMDB calls entirely unless the tab
 * that needs them is the one being asked for, and render one season's episodes
 * instead of all of them.
 *
 * Both are read through the functions below rather than off the object, because
 * a search param is as attacker-supplied as any other input — the same reason
 * `limitFrom` bounds the list params.
 */

import {
  carryParams,
  oneParam as one,
  type SearchParams as Params,
} from "@/lib/search-params";

export const SHOW_TABS = ["episodes", "watch", "about"] as const;

export type ShowTab = (typeof SHOW_TABS)[number];

export const TAB_PARAM = "tab";
export const SEASON_PARAM = "season";

/** Anything that isn't a known tab is the default one, not an error. */
export function tabFrom(params: Params): ShowTab {
  const value = one(params, TAB_PARAM);

  return SHOW_TABS.includes(value as ShowTab) ? (value as ShowTab) : "episodes";
}

/**
 * The season to render, always one this show actually has.
 *
 * Falls back to the season holding the next unwatched episode — opening a show
 * you're partway through should land on the part you're partway through, not on
 * season 1. `available` is expected in ascending order.
 */
export function seasonFrom(
  params: Params,
  available: number[],
  preferred?: number,
): number {
  const parsed = Number(one(params, SEASON_PARAM));

  if (Number.isInteger(parsed) && available.includes(parsed)) return parsed;
  if (preferred !== undefined && available.includes(preferred)) return preferred;

  return available[0] ?? 1;
}

/**
 * Builds a link that changes one param and keeps the rest.
 *
 * The tab and the season have to travel together: switching tab while holding
 * season 3 and coming back to a page that forgot it is the kind of small
 * betrayal that makes a control feel broken.
 *
 * "The rest" means the params in `KNOWN_PARAMS`, not everything in the URL —
 * see `lib/search-params.ts`. `changes` is not filtered, because it comes from
 * this codebase rather than from the request.
 */
export function showHref(
  current: Params,
  changes: Record<string, string | number | undefined>,
): string {
  const next = carryParams(current);

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) next.delete(key);
    else next.set(key, String(value));
  }

  const query = next.toString();
  return query ? `?${query}` : "?";
}
