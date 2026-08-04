"use client";

import { useOptimistic, useTransition } from "react";

import { markEpisodeWatched } from "@/app/actions";

interface MarkWatchedButtonProps {
  episodeId: string;
  /** For the label — "Mark S02E07 watched" is ambiguous in a list of ten. */
  showName: string;
  code: string;
}

/**
 * Marks the next episode watched without leaving the dashboard.
 *
 * The single most important change on this screen: it removes the tap-in,
 * scroll, tap, tap-back loop that marking an episode costs otherwise.
 *
 * What it does *not* do is advance the row to the following episode on its
 * own. The row only knows the episode it is showing, so the next one comes
 * from the server — `markEpisodeWatched` revalidates and the transition stays
 * pending until that render lands, which is what `useOptimistic` holds the
 * pressed state for. Shipping the next two episodes per row to avoid a round
 * trip would put a second episode's worth of data into every row for a tap
 * most of them never receive.
 */
export function MarkWatchedButton({
  episodeId,
  showName,
  code,
}: MarkWatchedButtonProps) {
  // Derived from the transition, not copied into `useState`. The row is
  // re-rendered by the server the moment the action lands, and a state copy
  // would keep showing "marked" against whatever the row says next.
  const [marked, setMarked] = useOptimistic(false);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      // Sits inside a card whose link is stretched across it.
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();

        startTransition(async () => {
          setMarked(true);
          await markEpisodeWatched(episodeId);
        });
      }}
      disabled={pending}
      aria-label={`Mark ${showName} ${code} watched`}
      title="Mark watched"
      // 32px of button inside 44px of hit area, per the handoff's note about
      // padding the one deliberately small target out in code.
      className="relative -m-1.5 flex size-11 shrink-0 items-center justify-center"
    >
      <span
        className={`flex size-8 items-center justify-center rounded-full bg-accent text-on-accent transition-opacity ${
          marked ? "opacity-60" : ""
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5"
          aria-hidden="true"
        >
          <path d="m5 13 4 4L19 7" />
        </svg>
      </span>
    </button>
  );
}
