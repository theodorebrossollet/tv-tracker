"use client";

import { useState, useTransition } from "react";

import { watchMovieAgain } from "@/app/rewatch-actions";
import { Sheet } from "@/components/sheet";
import { useViewerTimeZone } from "@/components/watched-date";
import { formatWatchedDate } from "@/lib/format";
import { formatRating } from "@/lib/ratings";

interface WatchAgainButtonProps {
  movieId: string;
  /** ISO instant of the current watch, or null when it has no date. */
  watchedAt: string | null;
  rating: number | null;
}

/**
 * "Watch again" on a watched movie: a confirmation sheet, then
 * `watchMovieAgain`. The open flag and the error are plain state so the message
 * is still there once the transition settles; both are cleared on open and on
 * close so a late failure from a dismissed request never shows on the next open.
 */
export function WatchAgainButton({
  movieId,
  watchedAt,
  rating,
}: WatchAgainButtonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function show() {
    setError(null);
    setOpen(true);
  }

  function close() {
    setError(null);
    setOpen(false);
  }

  function confirm() {
    setError(null);

    startTransition(async () => {
      const result = await watchMovieAgain(movieId);

      if (!result.ok) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }

      setOpen(false);
    });
  }

  const zone = useViewerTimeZone();
  const date = watchedAt ? formatWatchedDate(watchedAt, zone) : null;
  const kept =
    `Your ${date ? `${date} ` : ""}watch` +
    (rating !== null ? ` and its rating (${formatRating(rating)}) are` : " is");

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        className="min-h-[46px] rounded-full border border-border px-[22px] text-[15px] font-medium transition-colors hover:bg-surface"
      >
        Watch again
      </button>

      {open ? (
        <Sheet title="Log a new watch?" onClose={close}>
          <p className="px-1.5 text-[13px] leading-relaxed text-muted">
            {kept} kept in Past watches. The movie shows as watched today with
            no rating.
          </p>

          {error ? (
            <p role="alert" className="mt-2 px-1.5 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-3.5 flex gap-2 px-1.5 pb-1">
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="min-h-[46px] flex-1 rounded-full border border-border px-[22px] text-[15px] font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="min-h-[46px] flex-1 rounded-full bg-accent px-[22px] text-[15px] font-semibold text-on-accent disabled:opacity-50"
            >
              Watch again
            </button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
