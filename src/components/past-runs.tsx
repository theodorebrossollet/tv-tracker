import { RatingValue } from "@/components/rating-value";
import { WatchedRange } from "@/components/watched-date";
import type { PastRun } from "@/lib/queries";

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
          const hasDates = run.firstWatchedAt || run.lastWatchedAt;
          const count = `${run.episodeCount} ${
            run.episodeCount === 1 ? "episode" : "episodes"
          }`;

          return (
            <li
              key={run.runNumber}
              className="flex items-center gap-2 px-2 text-xs text-muted"
            >
              <span>
                {`Run ${run.runNumber} · `}
                {hasDates ? (
                  <>
                    <WatchedRange
                      first={run.firstWatchedAt?.toISOString() ?? null}
                      last={run.lastWatchedAt?.toISOString() ?? null}
                    />
                    {" · "}
                  </>
                ) : null}
                {count}
              </span>
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
