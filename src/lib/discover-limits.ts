// Shared by the Discover server actions and its client components, so it must
// not import prisma or anything server-only. It also can't live in
// `app/discover-actions.ts`: a "use server" file may export only async
// functions.

/** Most dismissed suggestions one account may keep; bounds the table. */
export const MAX_DISMISSED = 2000;

/** Fewest qualifying seeds needed before suggestions are shown. */
export const MIN_SEEDS = 3;

export type SuggestionKind = "movie" | "show";

export function isSuggestionKind(value: unknown): value is SuggestionKind {
  return value === "movie" || value === "show";
}
