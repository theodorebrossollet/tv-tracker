// Rating rules, kept pure (no server-only imports) so the rating strip and the
// screens can share them with the server actions and queries, and all of them
// test without React.
//
// A rating is a whole number from 1 to 10. "Unrated" is null, never 0, so a
// stored value is always a real opinion and averages never need to skip zeros.

export const RATING_MIN = 1;
export const RATING_MAX = 10;

/** True for an integer in 1..10. Rejects strings, NaN, Infinity and null. */
export function isRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= RATING_MIN &&
    value <= RATING_MAX
  );
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Mean of a season's episode ratings, or null when none are rated. */
export function seasonAverage(ratings: number[]): number | null {
  return mean(ratings);
}

/**
 * Mean of the season averages that exist. A season with no ratings is left out
 * rather than counted as zero, so it can't drag the show's average down.
 */
export function showAverage(seasonAverages: Array<number | null>): number | null {
  return mean(
    seasonAverages.filter((average): average is number => average !== null),
  );
}

/** A single rating as shown: a whole number. */
export function formatRating(rating: number): string {
  return String(rating);
}

/**
 * An average as shown: always one decimal, rounding half up on the tenths
 * digit. Rounds before formatting because `toFixed` alone rounds the binary
 * value, which isn't always the half-up result people expect.
 */
export function formatAverage(average: number): string {
  return (Math.round(average * 10) / 10).toFixed(1);
}

/**
 * Says how much an average rests on, but only when it's partial: some episodes
 * are rated and some watched ones aren't. Null when nothing is rated (there is
 * no average to qualify) or when everything is (nothing to caveat). `rated >
 * watched` can't happen, and returns null defensively rather than a nonsense
 * line.
 */
export function coverageText(
  rated: number,
  watched: number,
  scope: "season" | "show",
): string | null {
  if (rated < 1 || rated >= watched) return null;
  return scope === "show"
    ? `${rated} of ${watched} watched episodes rated`
    : `${rated} of ${watched} rated`;
}
