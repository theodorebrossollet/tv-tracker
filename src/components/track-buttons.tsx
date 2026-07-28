"use client";

import { useState, useTransition } from "react";

import { trackShow, untrackShow } from "@/app/actions";
import type { TrackStatus } from "@/lib/types";

interface TrackButtonsProps {
  showId: string;
  /** Current list the show is on, or null when it isn't tracked yet. */
  status: TrackStatus | null;
  /** Adding a show downloads its episodes, so warn the user it takes a moment. */
  size?: "sm" | "md";
}

const BASE =
  "rounded-full border font-medium transition-colors disabled:opacity-50 disabled:cursor-wait";

export function TrackButtons({
  showId,
  status,
  size = "sm",
}: TrackButtonsProps) {
  // Optimistic local copy so the buttons react immediately; the server action
  // revalidates the page afterwards and the prop catches up.
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const padding = size === "md" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs";

  function run(next: TrackStatus | null) {
    setError(null);

    startTransition(async () => {
      const result = next
        ? await trackShow(showId, next)
        : await untrackShow(showId);

      if (result.ok) {
        setCurrent(next);
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(current === "watching" ? null : "watching")}
          className={`${BASE} ${padding} ${
            current === "watching"
              ? "border-accent bg-accent text-white"
              : "border-border hover:bg-surface"
          }`}
        >
          {current === "watching" ? "Watching ✓" : "Watching"}
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={() => run(current === "watchlist" ? null : "watchlist")}
          className={`${BASE} ${padding} ${
            current === "watchlist"
              ? "border-accent bg-accent text-white"
              : "border-border hover:bg-surface"
          }`}
        >
          {current === "watchlist" ? "Watchlist ✓" : "Watchlist"}
        </button>
      </div>

      {pending ? (
        <p className="text-xs text-muted">Fetching episodes from TMDB…</p>
      ) : null}
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
