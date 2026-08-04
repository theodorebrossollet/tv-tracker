/**
 * "S02E07" — the padded episode code shown wherever an episode is named.
 *
 * Shared rather than redefined per list: the dashboard, the upcoming list and
 * the show page all render it, and three private copies had already started to
 * drift on padding.
 */
export function episodeCode(
  seasonNumber: number,
  episodeNumber: number,
): string {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(
    episodeNumber,
  ).padStart(2, "0")}`;
}
