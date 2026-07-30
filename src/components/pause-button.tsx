"use client";

import { useOptimistic, useTransition } from "react";

import { pauseShow, resumeShow, stopShow } from "@/app/actions";
import type { TrackStatus } from "@/lib/types";

interface SetAsideButtonsProps {
  showId: string;
  status: TrackStatus | null;
}

const BUTTON =
  "rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-surface disabled:opacity-50";

/**
 * Pause, Stop, and the way back from either.
 *
 * Only rendered for a show that's actually been started — setting aside
 * something you never began is what the watchlist already is.
 *
 * Pause and Stop are mechanically identical; the difference is whether you mean
 * to come back, which is what makes the two lists worth looking at separately
 * later. Once set aside, the pair collapses to a single Resume, plus the option
 * to switch between the two intents without going through Watching.
 */
export function PauseButton({ showId, status }: SetAsideButtonsProps) {
  // Derived from props, never copied into useState: the status also changes
  // from elsewhere (marking an episode resumes a show), and a copy would go
  // stale until a reload.
  const [current, setCurrent] = useOptimistic(status);
  const [pending, startTransition] = useTransition();

  const active = current === "watching";
  const setAside = current === "paused" || current === "stopped";

  if (!active && !setAside) return null;

  function run(next: TrackStatus, action: () => Promise<unknown>) {
    startTransition(async () => {
      setCurrent(next);
      await action();
    });
  }

  if (setAside) {
    const other: TrackStatus = current === "paused" ? "stopped" : "paused";

    return (
      <>
        <button
          type="button"
          onClick={() => run("watching", () => resumeShow(showId))}
          disabled={pending}
          className={BUTTON}
          title="Move back to Watching"
        >
          Resume
        </button>

        <button
          type="button"
          onClick={() =>
            run(other, () =>
              other === "paused" ? pauseShow(showId) : stopShow(showId),
            )
          }
          disabled={pending}
          className={`${BUTTON} text-muted`}
          title={
            other === "paused"
              ? "You might come back to it after all"
              : "You're not coming back to this one"
          }
        >
          {other === "paused" ? "Move to Paused" : "Move to Stopped"}
        </button>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => run("paused", () => pauseShow(showId))}
        disabled={pending}
        className={BUTTON}
        title="Set aside for now — keeps your progress"
      >
        Pause
      </button>

      <button
        type="button"
        onClick={() => run("stopped", () => stopShow(showId))}
        disabled={pending}
        className={BUTTON}
        title="Given up on it — keeps your progress, moves to the Archive"
      >
        Stop
      </button>
    </>
  );
}
