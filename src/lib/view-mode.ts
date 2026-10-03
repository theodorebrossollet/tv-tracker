// How a list of titles is laid out: one per row, or as a grid of posters.
// Pure and client-safe; the cookie itself is read in `get-view-mode.ts` and
// written by `app/view-actions.ts`.

export type ViewMode = "rows" | "posters";

/** Name of the cookie holding the choice. One choice for lists and the Library. */
export const VIEW_COOKIE = "view";

/** A year. It is a layout preference, so it can last. */
export const VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isViewMode(value: unknown): value is ViewMode {
  return value === "rows" || value === "posters";
}

/** Anything that is not a known mode (missing, hand-edited, stale) is rows. */
export function parseViewMode(value: unknown): ViewMode {
  return isViewMode(value) ? value : "rows";
}
