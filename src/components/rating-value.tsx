import { formatAverage, formatRating } from "@/lib/ratings";

/**
 * A read-only rating: "★ 8", or "★ 7.4" for an average. No `"use client"`, so
 * server and client components can both render it. Muted, never colour coded —
 * a score is a fact, not a status.
 */
export function RatingValue({
  value,
  average = false,
}: {
  value: number;
  average?: boolean;
}) {
  const shown = average ? formatAverage(value) : formatRating(value);
  const name = average
    ? `Average rating ${shown} out of 10`
    : `Rated ${shown} out of 10`;

  return (
    <span aria-label={name} role="img" className="whitespace-nowrap text-muted">
      <span aria-hidden="true">★</span> {shown}
    </span>
  );
}
