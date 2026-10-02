"use client";

import { useState, useTransition } from "react";

import { setMovieStatus } from "@/app/actions";

/**
 * "Mark watched" on the movie page. Works on an untracked movie too: the action
 * caches it and creates the row.
 *
 * No `useState` copy of server state: the page re-renders from the server once
 * the action revalidates, and the button disappears (or the pill changes) then.
 * The error line is plain state: optimistic state is dropped when the
 * transition ends, which would erase the message the moment it appeared.
 */
export function MarkMovieWatchedButton({ movieId }: { movieId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function markWatched() {
    setError(null);

    startTransition(async () => {

      const result = await setMovieStatus(movieId, "watched");
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={markWatched}
        disabled={pending}
        className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        Mark watched
      </button>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
