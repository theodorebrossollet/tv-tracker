import { RatingValue } from "@/components/rating-value";
import { formatWatchedDate } from "@/lib/format";
import type { PastRun } from "@/lib/queries";

/** "5 Jan 2026 – 9 Feb 2026"; one date for a single day; "" with no dates. */
function dateRange(first: Date | null, last: Date | null): string {
  const a = first ? formatWatchedDate(first.toISOString()) : null;
  const b = last ? formatWatchedDate(last.toISOString()) : null;

  if (a && b) return a === b ? a : `${a} – ${b}`;
  return a ?? b ?? "";
}

/**
 * Archived runs of a rewatched show, newest first, read-only. Nothing for
 * `null` (history unavailable) or no runs. No `"use client"`: the show page
 * renders it on the server from `getShowDetail`'s `pastRuns`.
 */
export function PastRuns({ runs }: { runs: PastRun[] | null }) {
  if (!runs || runs.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="px-2 font-semibold">Past runs</h2>
      <ul className="flex flex-col gap-1">
        {runs.map((run) => {
          const range = dateRange(run.firstWatchedAt, run.lastWatchedAt);
          const count = `${run.episodeCount} ${
            run.episodeCount === 1 ? "episode" : "episodes"
          }`;
          const text = [`Run ${run.runNumber}`, range, count]
            .filter(Boolean)
            .join(" · ");

          return (
            <li
              key={run.runNumber}
              className="flex items-center gap-2 px-2 text-xs text-muted"
            >
              <span>{text}</span>
              {run.ratingAverage !== null ? (
                <RatingValue value={run.ratingAverage} average />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
