"use client";

import { useOptimistic, useTransition } from "react";

import { pauseShow, resumeShow } from "@/app/actions";
import type { TrackStatus } from "@/lib/types";

interface PauseButtonProps {
  showId: string;
  status: TrackStatus | null;
}

/**
 * Sets a show aside, or picks it back up.
 *
 * Only shown for shows that are actually being watched or paused — pausing
 * something you never started is what the watchlist already means.
 *
 * There's a resume button as well as the implicit one (marking any episode
 * un-pauses automatically), because resuming a show you're *behind* on
 * shouldn't require pretending you've watched something.
 */
export function PauseButton({ showId, status }: PauseButtonProps) {
  // Derived from props, never copied into useState — the status changes from
  // elsewhere (marking an episode un-pauses), and a copy would go stale.
  const [current, setCurrent] = useOptimistic(status);
  const [pending, startTransition] = useTransition();

  if (current !== "watching" && current !== "paused") return null;

  const paused = current === "paused";

  function toggle() {
    startTransition(async () => {
      setCurrent(paused ? "watching" : "paused");
      if (paused) {
        await resumeShow(showId);
      } else {
        await pauseShow(showId);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-surface disabled:opacity-50"
      title={
        paused
          ? "Move back to Watching"
          : "Keep the history, but take it out of Watching"
      }
    >
      {paused ? "Resume" : "Pause"}
    </button>
  );
}
