// Limits for rewatch history. Pure, so client components and tests can import
// them without pulling in the database.

/** Past runs kept per show and account; starting over at this count is refused. */
export const MAX_PAST_RUNS = 20;

/** Past watches kept per movie and account; watching again at this count is refused. */
export const MAX_PAST_WATCHES = 20;

/**
 * What a title page hands its status menu so it can offer "Reset history":
 * `null` when there is nothing to delete. `pastRuns`/`pastWatches` is `null`
 * when the archive couldn't be read, which the menu words without a count; it
 * can't count as history by itself, so an unreadable archive with nothing
 * current to delete offers nothing. Shapes match the menus' `resetHistory`
 * props. Pure, and kept here rather than in a client module for the reason in
 * AGENTS.md: a server page must not read plain values out of "use client" files.
 */
export function showResetHistory(
  watched: number,
  pastRuns: readonly unknown[] | null,
): { watched: number; pastRuns: number | null } | null {
  if (watched === 0 && !pastRuns?.length) return null;

  return { watched, pastRuns: pastRuns === null ? null : pastRuns.length };
}

export function movieResetHistory(
  status: string | null,
  pastWatches: readonly unknown[] | null,
): { pastWatches: number | null; watched: boolean } | null {
  const watched = status === "watched";
  if (!watched && !pastWatches?.length) return null;

  return {
    pastWatches: pastWatches === null ? null : pastWatches.length,
    watched,
  };
}

/**
 * `showResetHistory` fed from a `getShowDetail` result. It must use
 * `watchedEpisodeCount` (every watched episode), never `watchedCount`, which
 * counts only AIRED ones while the reset deletes them all.
 */
export function showResetHistoryOf(show: {
  watchedEpisodeCount: number;
  pastRuns: readonly unknown[] | null;
}) {
  return showResetHistory(show.watchedEpisodeCount, show.pastRuns);
}
