"use client";

import { useOptimistic, useTransition } from "react";

import { addToWatchlist, removeShow } from "@/app/actions";
import type { TrackStatus } from "@/lib/types";

interface AddButtonProps {
  showId: string;
  /** Current list the show is on, or null when it isn't tracked. */
  status: TrackStatus | null;
  /** `icon` is the bare circular +, for dense lists. */
  variant?: "icon" | "full";
}

const LABELS: Record<TrackStatus, string> = {
  watchlist: "On watchlist",
  watching: "Watching",
  paused: "Paused",
  stopped: "Stopped",
};

/**
 * The single entry point for tracking a show: "+" adds it to the watchlist.
 * There's no separate "watching" button — a show promotes itself once you mark
 * an episode watched (see markEpisodeWatched).
 */
export function AddButton({
  showId,
  status,
  variant = "full",
}: AddButtonProps) {
  // Derived from the prop via useOptimistic, not copied into useState. The
  // status changes for reasons this button never sees — marking an episode
  // promotes a show to "watching", unmarking the last one sends it back to the
  // watchlist — and a useState copy would keep displaying whatever the status
  // was when the page first rendered.
  const [current, setCurrent] = useOptimistic(status);
  const [error, setError] = useOptimistic<string | null, string | null>(
    null,
    (_, next) => next,
  );
  const [pending, startTransition] = useTransition();

  const tracked = current !== null;

  function toggle(event: React.MouseEvent) {
    // These buttons sit inside links on the list pages.
    event.preventDefault();
    event.stopPropagation();

    startTransition(async () => {
      setCurrent(tracked ? null : "watchlist");

      const result = tracked
        ? await removeShow(showId)
        : await addToWatchlist(showId);

      // No manual rollback: when the transition ends the optimistic value is
      // dropped and the prop wins either way.
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  const label = tracked
    ? `Remove ${LABELS[current].toLowerCase()}`
    : "Add to watchlist";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title={label}
        aria-label={label}
        className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-lg leading-none transition-colors disabled:opacity-50 ${
          tracked
            ? "border-accent bg-accent text-white"
            : "border-border hover:bg-surface"
        }`}
      >
        {tracked ? "✓" : "+"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={label}
        className={`flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
          tracked
            ? "border-accent bg-accent text-white"
            : "border-border hover:bg-surface"
        }`}
      >
        <span className="text-base leading-none">{tracked ? "✓" : "+"}</span>
        {tracked ? LABELS[current] : "Add to watchlist"}
      </button>

      {pending && !tracked ? (
        <p className="text-xs text-muted">Fetching episodes from TMDB…</p>
      ) : null}
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
