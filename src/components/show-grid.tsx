import Link from "next/link";

import { Poster } from "@/components/poster";
import { caughtUpLabel } from "@/lib/format";
import type { TrackedShowSummary } from "@/lib/queries";

function episodeCode(seasonNumber: number, episodeNumber: number) {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(
    episodeNumber,
  ).padStart(2, "0")}`;
}

/**
 * The "Watching" list.
 *
 * No filtering here any more: finished shows live in the Archive, so this page
 * only ever holds things in progress. The old "hide finished shows" toggle —
 * and the client-side state and localStorage behind it — existed purely
 * because finished shows had nowhere else to go.
 */
export function ShowGrid({ shows }: { shows: TrackedShowSummary[] }) {
  return (
    <>
      <p className="mt-1 text-sm text-muted">
        {shows.length} show{shows.length === 1 ? "" : "s"} in progress
      </p>

      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {shows.map((show) => {
          const percent =
            show.airedCount === 0
              ? 0
              : Math.round((show.watchedCount / show.airedCount) * 100);

          return (
            <li key={show.showId}>
              <Link
                href={`/show/${show.showId}`}
                className="flex gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-surface"
              >
                <Poster path={show.posterPath} name={show.name} width={64} />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{show.name}</p>

                  <p className="mt-0.5 text-xs text-muted">
                    {show.watchedCount} / {show.airedCount} aired episodes
                    watched
                  </p>

                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"
                    role="progressbar"
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${show.name} progress`}
                  >
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <p className="mt-2 truncate text-xs">
                    {show.nextUnwatched ? (
                      <>
                        <span className="text-muted">Next up: </span>
                        <span className="font-mono">
                          {episodeCode(
                            show.nextUnwatched.seasonNumber,
                            show.nextUnwatched.episodeNumber,
                          )}
                        </span>{" "}
                        {show.nextUnwatched.name ?? ""}
                      </>
                    ) : (
                      <span className="text-muted">
                        {show.airedCount > 0
                          ? caughtUpLabel(show.showStatus)
                          : "No episodes aired yet"}
                      </span>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
