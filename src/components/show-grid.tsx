import Image from "next/image";
import Link from "next/link";

import { MarkWatchedButton } from "@/components/mark-watched-button";
import { SwipeToMark } from "@/components/swipe-to-mark";
import { episodeCode, shortEpisodeCode } from "@/lib/episode-code";
import { caughtUpLabel, progressPercent } from "@/lib/format";
import { backdropUrl, posterUrl } from "@/lib/images";
import type { TrackedShowSummary } from "@/lib/queries";

/**
 * "Continue watching": every show in progress except the one the hero
 * features.
 *
 * A vertical list rather than the sideways carousel the Marquee mockup drew:
 * each row is a `SwipeToMark`, and a swipe right to mark watched cannot share
 * a row with a sideways scroll. The rows take the mockup's look instead — a
 * 16:9 thumbnail with the progress drawn on it, no outline.
 *
 * No filtering here: finished shows live in the Archive, so this list only
 * ever holds things in progress.
 *
 * A server component. Each row is a `SwipeToMark` holding server-rendered
 * content, plus `MarkWatchedButton`. Nothing removes a row under the reader's
 * thumb: marking the last aired episode moves the show out of this bucket on
 * the next server render.
 */
export function ShowGrid({ shows }: { shows: TrackedShowSummary[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-2.5">
      {shows.map((show) => {
        const percent = progressPercent(show.watchedCount, show.airedCount);
        const next = show.nextUnwatched;
        // The next episode's own frame says the most; the show's backdrop and
        // then its poster stand in when TMDB has no still yet.
        const thumb =
          backdropUrl(next?.stillPath, "w300") ??
          backdropUrl(show.backdropPath, "w300") ??
          posterUrl(show.posterPath, "w185");

        return (
          <SwipeToMark
            key={show.showId}
            episodeId={next?.id ?? null}
            className="flex items-center gap-3 rounded-2xl bg-surface p-2.5"
          >
            <div className="relative h-[63px] w-[112px] shrink-0 overflow-hidden rounded-[10px] bg-surface-raised">
              {thumb ? (
                <Image
                  src={thumb}
                  alt=""
                  fill
                  sizes="112px"
                  className="object-cover"
                />
              ) : null}
              <div
                className="absolute inset-x-2 bottom-1.5 h-[3px] overflow-hidden rounded-full bg-foreground/30"
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
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link
                href={`/show/${show.showId}`}
                className="truncate text-[15.5px] font-semibold tracking-[-0.01em] after:absolute after:inset-0 after:content-['']"
              >
                {show.name}
              </Link>

              {next ? (
                <span className="truncate text-[13px] text-muted">
                  <span className="tabular-nums">
                    {shortEpisodeCode(next.seasonNumber, next.episodeNumber)}
                  </span>
                  {next.name ? ` · ${next.name}` : ""}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[13px] text-muted">
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
                  {show.airedCount > 0
                    ? caughtUpLabel(show.showStatus)
                    : "No episodes aired yet"}
                </span>
              )}
            </div>

            {next ? (
              // Above the stretched link rather than inside it: a button
              // nested in an anchor is invalid HTML.
              <span className="relative">
                <MarkWatchedButton
                  episodeId={next.id}
                  showName={show.name}
                  code={episodeCode(next.seasonNumber, next.episodeNumber)}
                />
              </span>
            ) : null}
          </SwipeToMark>
        );
      })}
    </ul>
  );
}
