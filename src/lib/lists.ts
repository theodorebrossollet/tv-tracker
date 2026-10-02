import type { MovieStatus } from "@/lib/types";

// List rules, kept pure (no server-only imports) so the list actions, the
// queries and the client components share one definition and test without
// React or a database.

export type ListKind = "movie" | "show";

export function isListKind(value: unknown): value is ListKind {
  return value === "movie" || value === "show";
}

export const LIST_NAME_MAX = 60;
export const MAX_LISTS = 50;
export const MAX_ITEMS_PER_LIST = 500;

export type ListNameCheck =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * Validates a proposed list name, returning the trimmed value to store or a
 * message to show the user.
 *
 * Takes `unknown` because the caller is a server action reading FormData,
 * where nothing is guaranteed to be a string. Surrounding whitespace is
 * trimmed, and the length limit applies to what is stored.
 */
export function validateListName(name: unknown): ListNameCheck {
  const trimmed = typeof name === "string" ? name.trim() : "";

  if (!trimmed) {
    return { ok: false, error: "Enter a name for the list." };
  }

  if (trimmed.length > LIST_NAME_MAX) {
    return {
      ok: false,
      error: `Keep the name to ${LIST_NAME_MAX} characters or fewer.`,
    };
  }

  return { ok: true, name: trimmed };
}

/**
 * Whether a list item counts as watched.
 *
 * A personal list mirrors the Library: a movie is watched when its status is
 * "watched", a show when `showFinished` says so. The caller computes that with
 * the Library's own derived rule — nothing about episodes is decided here —
 * and any stored `tickedAt` is ignored. An untracked movie is never watched.
 *
 * A "together" list (`trackSeparately`) is the opposite: only `tickedAt`
 * counts, and the Library status is ignored, so ticking something off with
 * someone else never touches the user's own record.
 */
export function isListItemWatched(item: {
  trackSeparately: boolean;
  tickedAt: Date | null;
  kind: ListKind;
  movieStatus: MovieStatus | null;
  showFinished: boolean;
}): boolean {
  if (item.trackSeparately) return item.tickedAt !== null;
  return item.kind === "movie"
    ? item.movieStatus === "watched"
    : item.showFinished;
}
