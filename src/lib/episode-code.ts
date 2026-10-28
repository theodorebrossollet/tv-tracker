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

/**
 * "S2 · E7" — the unpadded form the Marquee screens show beside artwork, where
 * the padded code reads as an identifier rather than a place in a show.
 * Accessible names keep `episodeCode`, which is what tests and screen readers
 * already know.
 */
export function shortEpisodeCode(
  seasonNumber: number,
  episodeNumber: number,
): string {
  return `S${seasonNumber} · E${episodeNumber}`;
}
