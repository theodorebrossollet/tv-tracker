"use client";

import { useState, useTransition } from "react";

import { watchMovieAgain } from "@/app/rewatch-actions";
import { ConfirmSheet } from "@/components/confirm-sheet";
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
        className="min-h-[46px] rounded-full bg-surface px-[22px] text-[15px] font-medium transition-colors hover:bg-surface-raised"
      >
        Watch again
      </button>

      {open ? (
        <ConfirmSheet
          title="Log a new watch?"
          confirmLabel="Watch again"
          pending={pending}
          error={error}
          onConfirm={confirm}
          onCancel={close}
        >
            {kept} kept in Past watches. The movie shows as watched today with
            no rating.
        </ConfirmSheet>
      ) : null}
    </>
  );
}
