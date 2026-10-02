"use client";

import { useOptimistic, useState, useTransition } from "react";

import { addMovieToWatchlist, removeMovie } from "@/app/actions";
import type { MovieStatus } from "@/lib/types";

interface MovieAddButtonProps {
  movieId: string;
  /** Current list the movie is on, or null when it isn't tracked. */
  status: MovieStatus | null;
  /** `icon` is the bare circular +, for dense lists. */
  variant?: "icon" | "full";
}

const LABELS: Record<MovieStatus, string> = {
  watchlist: "On watchlist",
  watched: "Watched",
  not_interested: "Not interested",
};

/**
 * "+" adds a movie to the watchlist; tracked, it removes it. Moving between
 * watched / not interested happens from the movie page, not here.
 */
export function MovieAddButton({
  movieId,
  status,
  variant = "full",
}: MovieAddButtonProps) {
  // Derived from the prop via useOptimistic, not copied into useState: the
  // status can change on the movie page for reasons this button never sees.
  const [current, setCurrent] = useOptimistic(status);
  // Plain state, not optimistic: optimistic values are dropped when the
  // transition ends, which would erase the message the moment it appeared.
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tracked = current !== null;

  function toggle(event: React.MouseEvent) {
    // These buttons sit inside links on the list pages.
    event.preventDefault();
    event.stopPropagation();

    setError(null);

    startTransition(async () => {
      setCurrent(tracked ? null : "watchlist");

      const result = tracked
        ? await removeMovie(movieId)
        : await addMovieToWatchlist(movieId);

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
            ? "border-accent bg-accent text-on-accent"
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
            ? "border-accent bg-accent text-on-accent"
            : "border-border hover:bg-surface"
        }`}
      >
        <span className="text-base leading-none">{tracked ? "✓" : "+"}</span>
        {tracked ? LABELS[current] : "Add to watchlist"}
      </button>

      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
