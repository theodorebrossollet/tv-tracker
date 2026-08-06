// The search params this app reads, and the one way links carry them forward.
//
// Both list controls — "show more" and the show page's tab/season strip — build
// their href by copying the current params and changing one. Copying them
// *wholesale* is the obvious way to do that and the wrong one: a URL's params
// are attacker-supplied like any other input, so every unrecognised key in the
// address bar was being reflected into every generated link on the page. That
// is params × links of server-side rendering and payload, driven entirely by
// whoever wrote the URL — reachable through a link sent to someone else, and
// with no upper bound.
//
// Naming the params instead makes the cost a property of the app rather than of
// the request. It also documents, in one place, the full set of things a URL
// here is allowed to say — which was previously only discoverable by reading
// five components.
//
// Nothing in here may import a server-only module: both callers are shared
// between server and client components.

/**
 * Every param any screen reads, in the order links emit them.
 *
 * Fixed order rather than the URL's, so the same state always produces the same
 * href — which keeps them comparable and cacheable, and stops a link changing
 * shape depending on how the visitor arrived.
 *
 * Adding a param here is the second half of adding one to a screen; a param
 * this list doesn't name survives being read off the URL that names it, but
 * won't be carried across a "show more" click or a tab switch.
 */
export const KNOWN_PARAMS = [
  // Show page.
  "tab",
  "season",
  "country",
  "altCountries",
  // Dashboard.
  "upcoming",
  // Library — watchlist segment, then archive.
  "watchlist",
  "paused",
  "finished",
  "stopped",
  // Settings.
  "providers",
] as const;

export type SearchParams = Record<string, string | string[] | undefined>;

/** The last value of a repeated param, or undefined. */
export function oneParam(
  params: SearchParams,
  key: string,
): string | undefined {
  const raw = params[key];
  return Array.isArray(raw) ? raw.at(-1) : raw;
}

/**
 * The known params from `current`, ready to be modified and stringified.
 *
 * `except` drops one on the way through — the "show more" links set their own
 * param from a computed row count rather than carrying the old value.
 */
export function carryParams(
  current: SearchParams,
  except?: string,
): URLSearchParams {
  const next = new URLSearchParams();

  for (const key of KNOWN_PARAMS) {
    if (key === except) continue;

    const value = oneParam(current, key);
    if (value === undefined) continue;

    next.set(key, value);
  }

  return next;
}
