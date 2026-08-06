import Image from "next/image";
import Link from "next/link";

import { Poster } from "@/components/poster";
import { StatusMenu } from "@/components/status-sheet";
import { progressPercent } from "@/lib/format";
import { posterUrl } from "@/lib/images";
import type { TrackStatus } from "@/lib/types";

interface ShowHeaderProps {
  showId: string;
  name: string;
  posterPath: string | null;
  metaLine: string | null;
  watchedCount: number;
  airedCount: number;
  status: TrackStatus | null;
  finished: boolean;
  /** e.g. "S3E01 airs 21 Sep 2026". Omitted when nothing is scheduled. */
  nextAiring: string | null;
}

/**
 * The show page's header: backdrop, poster, title, progress.
 *
 * The backdrop is the show's own poster, blurred past recognition. The handoff
 * asks for TMDB's 16:9 backdrop, which the Show model has no column for — and
 * adding one means a migration, a mapping and a backfill script, because both
 * refresh paths key on time rather than completeness and would leave existing
 * rows blank until they aged out. Blurring the poster costs none of that, needs
 * no extra request (same CDN path, already in the payload), and at half opacity
 * behind the scrim it is indistinguishable from the real thing.
 */
export function ShowHeader({
  showId,
  name,
  posterPath,
  metaLine,
  watchedCount,
  airedCount,
  status,
  finished,
  nextAiring,
}: ShowHeaderProps) {
  const percent = progressPercent(watchedCount, airedCount);
  const backdrop = posterUrl(posterPath, "w500");

  return (
    <div className="relative -mx-4 overflow-hidden px-4 pb-[18px] pt-3">
      {backdrop ? (
        <>
          <div aria-hidden="true" className="absolute inset-0 scale-110">
            <Image
              src={backdrop}
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
            className="-ml-2 flex size-10 items-center justify-center rounded-full"
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

          <StatusMenu
            showId={showId}
            name={name}
            status={status}
            finished={finished}
            variant="pill"
          />
        </div>

        <div className="mt-3 flex items-end gap-3.5">
          <Poster
            path={posterPath}
            name={name}
            width={78}
            className="shadow-[0_10px_22px_-12px_rgba(0,0,0,.8)]"
          />

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold leading-[27px] tracking-[-0.025em]">
              {name}
            </h1>

            {metaLine ? (
              <p className="mt-[5px] text-xs leading-4 text-muted">{metaLine}</p>
            ) : null}

            {airedCount > 0 ? (
              <div className="mt-3 flex items-center gap-[9px]">
                <div
                  className="h-[5px] flex-1 overflow-hidden rounded-full bg-surface-sunken"
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
                <span className="font-mono text-[11px] text-accent-deep">
                  {percent}%
                </span>
              </div>
            ) : null}

            {nextAiring ? (
              <p className="mt-1.5 font-mono text-[10.5px] text-faint">
                {nextAiring}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
