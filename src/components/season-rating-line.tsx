import { RatingValue } from "@/components/rating-value";
import { coverageText } from "@/lib/ratings";

/**
 * The active season's average, above its episode list. Nothing when no episode
 * in the season is rated. No `"use client"`: the show page renders it on the
 * server from numbers `getShowDetail` already returned.
 */
export function SeasonRatingLine({
  average,
  rated,
  watched,
}: {
  average: number | null;
  rated: number;
  watched: number;
}) {
  if (average === null) return null;

  const coverage = coverageText(rated, watched, "season");

  return (
    <p className="flex items-center gap-2 px-2 text-xs text-muted">
      <RatingValue value={average} average />
      {coverage ? <span className="text-faint">{coverage}</span> : null}
    </p>
  );
}
