import Link from "next/link";

import { MarkWatchedButton } from "@/components/mark-watched-button";
import { Poster } from "@/components/poster";
import { episodeCode } from "@/lib/episode-code";
import { caughtUpLabel } from "@/lib/format";
import type { TrackedShowSummary } from "@/lib/queries";

/**
 * The "Watching" list.
 *
 * No filtering here: finished shows live in the Archive, so this page only ever
 * holds things in progress. The old "hide finished shows" toggle — and the
 * client state and localStorage behind it — existed purely because finished
 * shows had nowhere else to go.
 *
 * A server component. `MarkWatchedButton` is the one client island per row.
 *
 * The count is derived from the rows actually rendered rather than tracked
 * optimistically. Marking the last aired episode of a show moves it out of this
 * bucket entirely, so an optimistic count would tick down while the row it
 * refers to is still on screen — two things on one screen disagreeing about
 * what just happened. The row leaves on the next server render instead, which
 * is also why nothing here removes it under the reader's thumb.
 */
export function ShowGrid({ shows }: { shows: TrackedShowSummary[] }) {
  return (
    <>
      <p className="mt-1.5 text-[12.5px] text-muted">
        {shows.length} show{shows.length === 1 ? "" : "s"} in progress
      </p>

      <ul className="mt-3.5 flex flex-col gap-2">
        {shows.map((show) => {
          const percent =
            show.airedCount === 0
              ? 0
              : Math.round((show.watchedCount / show.airedCount) * 100);

          return (
            <li
              key={show.showId}
              className="relative flex gap-3 rounded-[15px] border border-border bg-surface p-[11px]"
            >
              <Poster path={show.posterPath} name={show.name} width={52} />

              <div className="flex min-w-0 flex-1 flex-col justify-center gap-[7px]">
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/show/${show.showId}`}
                    className="min-w-0 flex-1 truncate text-[15.5px] font-medium tracking-[-0.01em] after:absolute after:inset-0 after:content-['']"
                  >
                    {show.name}
                  </Link>
                  <span className="shrink-0 font-mono text-[11px] text-muted">
                    {show.watchedCount} / {show.airedCount}
                  </span>
                </div>

                <div
                  className="h-1 overflow-hidden rounded-full bg-background"
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

                {show.nextUnwatched ? (
                  <div className="flex items-center gap-2.5">
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-[13px]">
                        {show.nextUnwatched.name ?? "Episode title to come"}
                      </span>
                      <span className="font-mono text-[10.5px] text-muted">
                        {episodeCode(
                          show.nextUnwatched.seasonNumber,
                          show.nextUnwatched.episodeNumber,
                        )}
                      </span>
                    </span>

                    {/* Above the stretched link rather than inside it: a
                        button nested in an anchor is invalid HTML. */}
                    <span className="relative">
                      <MarkWatchedButton
                        episodeId={show.nextUnwatched.id}
                        showName={show.name}
                        code={episodeCode(
                          show.nextUnwatched.seasonNumber,
                          show.nextUnwatched.episodeNumber,
                        )}
                      />
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-[7px] text-muted">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-3 shrink-0"
                      aria-hidden="true"
                    >
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                    <span className="text-[12.5px]">
                      {show.airedCount > 0
                        ? caughtUpLabel(show.showStatus)
                        : "No episodes aired yet"}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
