import Image from "next/image";
import Link from "next/link";
import type { ComponentProps } from "react";

import { AddToListButton } from "@/components/add-to-list-button";
import { Poster } from "@/components/poster";
import { RatingValue } from "@/components/rating-value";
import { StatusMenu } from "@/components/status-sheet";
import { progressPercent } from "@/lib/format";
import { backdropUrl, posterUrl } from "@/lib/images";
import type { TitleListMembership } from "@/lib/queries";
import type { TrackStatus } from "@/lib/types";

interface ShowHeaderProps {
  showId: string;
  name: string;
  posterPath: string | null;
  /** TMDB's 16:9 artwork; null until the show is re-synced since it existed. */
  backdropPath?: string | null;
  metaLine: string | null;
  watchedCount: number;
  airedCount: number;
  status: TrackStatus | null;
  finished: boolean;
  /** e.g. "S3E01 airs 21 Sep 2026". Omitted when nothing is scheduled. */
  nextAiring: string | null;
  /**
   * The caller's lists, for the "Add to list" control beside the status pill.
   * Null or absent when the read failed: the button is then left out.
   */
  lists?: TitleListMembership[] | null;
  /** The show average and, when partial, its coverage. Null/absent: nothing. */
  rating?: { average: number; coverage: string | null } | null;
  /**
   * Which run of the show this is. Labelled only above 1; null when the
   * history couldn't be read, so no number is guessed.
   */
  runNumber?: number | null;
  /** Passed straight to the pill's `StatusMenu`. */
  startOver?: ComponentProps<typeof StatusMenu>["startOver"];
  /** Passed straight to the pill's `StatusMenu`. */
  resetHistory?: ComponentProps<typeof StatusMenu>["resetHistory"];
}

/**
 * The show page's header: artwork, title, progress.
 *
 * With a backdrop (the Marquee look) the show's 16:9 artwork runs full-bleed
 * behind the header, sharp, and the title sits large over its lower edge; the
 * poster is left out, since the artwork already says which show this is.
 *
 * Without one — a show not re-synced since backdrops were stored — it falls
 * back to the older treatment: the poster blurred past recognition behind a
 * scrim, with the poster itself beside the title.
 */
export function ShowHeader({
  showId,
  name,
  posterPath,
  backdropPath = null,
  metaLine,
  watchedCount,
  airedCount,
  status,
  finished,
  nextAiring,
  lists,
  rating,
  runNumber,
  startOver,
  resetHistory,
}: ShowHeaderProps) {
  const percent = progressPercent(watchedCount, airedCount);
  const artwork = backdropUrl(backdropPath, "w1280");
  const blurred = artwork ? null : posterUrl(posterPath, "w500");

  return (
    // Bleeds up through `main`'s top padding as well as out to the sides, so
    // the tint starts at the top of the screen; the padding gives the same
    // amount back, leaving the content where it was. It used to start below
    // the refresh strip, which no longer holds that line when closed.
    <div className="relative -mx-4 -mt-6 overflow-hidden px-4 pb-[18px] pt-9 sm:-mx-6 sm:-mt-10 sm:px-6 sm:pt-[3.25rem]">
      {artwork ? (
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[400px]">
          <Image
            src={artwork}
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 1024px, 100vw"
            className="object-cover"
          />
          {/* Dark at the top for the controls, clear through the middle, the
              page colour at the bottom where the title sits. */}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_55%,transparent)_0%,transparent_30%,color-mix(in_srgb,var(--background)_45%,transparent)_62%,var(--background)_100%)]" />
        </div>
      ) : blurred ? (
        <>
          <div aria-hidden="true" className="absolute inset-0 scale-110">
            <Image
              src={blurred}
              alt=""
              fill
              sizes="100vw"
              className="object-cover object-top opacity-50 blur-[28px] saturate-150"
            />
          </div>
          {/* Scrim, not a tint: the header's own text sits on top of whatever
              the poster happens to be, and a bright one would swallow it. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-background from-[22%] to-background/70"
          />
        </>
      ) : null}

      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/"
            aria-label="Back"
            // A glass circle: it sits over artwork that can be any colour.
            className="flex size-11 items-center justify-center rounded-full border border-accent-border bg-background/45 backdrop-blur-md"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[19px]"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>

          <div className="flex items-center gap-2">
            {lists ? (
              <AddToListButton kind="show" titleId={showId} lists={lists} />
            ) : null}

            <StatusMenu
              showId={showId}
              name={name}
              status={status}
              finished={finished}
              variant="pill"
              startOver={startOver}
              resetHistory={resetHistory}
            />
          </div>
        </div>

        <div
          className={`flex items-end gap-3.5 ${artwork ? "mt-[164px]" : "mt-3"}`}
        >
          {artwork ? null : (
            <Poster
              path={posterPath}
              name={name}
              width={78}
              className="shadow-[0_10px_22px_-12px_rgba(0,0,0,.8)]"
            />
          )}

          <div className="min-w-0 flex-1">
            <h1
              className={
                artwork
                  ? "text-[42px] leading-none font-extrabold tracking-[-0.04em]"
                  : "text-2xl font-semibold leading-[27px] tracking-[-0.025em]"
              }
            >
              {name}
            </h1>

            {metaLine ? (
              <p className="mt-[5px] text-xs leading-4 text-muted">{metaLine}</p>
            ) : null}

            {airedCount > 0 ? (
              <div className="mt-3 flex items-center gap-[9px]">
                <div
                  className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/20"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${name} progress`}
                >
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="text-[12px] tabular-nums text-accent-deep">
                  {percent}%
                </span>
                {runNumber != null && runNumber > 1 ? (
                  <span className="text-[12px] tabular-nums text-faint">
                    Run {runNumber}
                  </span>
                ) : null}
              </div>
            ) : null}

            {rating ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px]">
                <RatingValue value={rating.average} average />
                {rating.coverage ? (
                  <span className="text-[12px] tabular-nums text-faint">
                    {rating.coverage}
                  </span>
                ) : null}
              </p>
            ) : null}

            {nextAiring ? (
              <p className="mt-1.5 text-[12px] tabular-nums text-faint">
                {nextAiring}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
