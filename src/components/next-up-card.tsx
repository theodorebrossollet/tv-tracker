"use client";

import { useOptimistic, useState, useTransition } from "react";

import { markEpisodeWatched } from "@/app/actions";
import { episodeCode } from "@/lib/episode-code";

export interface NextUpEpisode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  /** Pre-formatted server-side: "Season 2 · 49m · 28 Feb 2025". */
  meta: string;
}

/**
 * The queue the Next-up card rotates through.
 *
 * Capped rather than complete. Skip walks to the following unwatched episode
 * without marking anything, so the card needs more than the one it is showing —
 * but a show you have just added has every episode unwatched, and shipping all
 * of them to power a button most visits never press is the payload problem the
 * rest of this page was rebuilt to avoid. Eight is several presses' worth; past
 * that the rotation wraps, which is what the handoff asks for when everything
 * left has been skipped.
 */
export const NEXT_UP_QUEUE = 8;

export function NextUpCard({ queue }: { queue: NextUpEpisode[] }) {
  const [index, setIndex] = useState(0);
  const [marked, setMarked] = useOptimistic(false);
  const [pending, startTransition] = useTransition();

  // Derived from the props, so a server revalidation that changes what is
  // unwatched moves the card rather than being ignored. `index` is only a
  // position within whatever queue the server most recently sent, and the wrap
  // happens here rather than when it is set — one place, and it covers both
  // skipping past the end and the queue shrinking underneath a position that
  // was valid when it was chosen.
  const episode = queue[index % queue.length];
  if (!episode) return null;

  const code = episodeCode(episode.seasonNumber, episode.episodeNumber);

  return (
    <div className="rounded-2xl border border-border bg-surface p-[15px]">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-accent-deep">
          Next up
        </span>
        <span className="font-mono text-[11px] text-faint">{code}</span>
      </div>

      <p className="mt-[7px] text-[17px] font-medium tracking-[-0.01em]">
        {episode.name ?? "Untitled episode"}
      </p>
      <p className="mt-[5px] text-xs text-faint">{episode.meta}</p>

      <div className="mt-[13px] flex gap-2">
        <button
          type="button"
          onClick={() => {
            startTransition(async () => {
              setMarked(true);
              await markEpisodeWatched(episode.id);
              // The server decides what is next; reset so the card shows the
              // head of the refreshed queue rather than a stale offset into it.
              setIndex(0);
            });
          }}
          disabled={pending}
          className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[13px] bg-accent text-[15px] font-semibold text-on-accent transition-opacity ${
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
            className="size-[15px]"
            aria-hidden="true"
          >
            <path d="m5 13 4 4L19 7" />
          </svg>
          Mark watched
        </button>

        {queue.length > 1 ? (
          <button
            type="button"
            onClick={() => setIndex((current) => current + 1)}
            disabled={pending}
            aria-label={`Skip ${code}`}
            className="min-h-12 rounded-[13px] border border-border px-4 text-sm text-muted transition-colors hover:text-foreground"
          >
            Skip
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface CaughtUpCardProps {
  /** The next unaired episode, when one is announced. */
  next: { code: string; name: string | null; date: string } | null;
  countdown: string | null;
}

/**
 * What the Next-up card becomes when nothing aired is left to watch.
 *
 * A different shape rather than a disabled version of the same card: Mark
 * watched and Skip have nothing to act on, and a greyed-out button invites the
 * tap it will refuse.
 */
export function CaughtUpCard({ next, countdown }: CaughtUpCardProps) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface-sunken p-[15px]">
      <div className="flex items-center gap-2 text-accent-deep">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3"
          aria-hidden="true"
        >
          <path d="m5 13 4 4L19 7" />
        </svg>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em]">
          All caught up
        </span>
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">
            {next ? (next.name ?? "Untitled episode") : "Nothing scheduled"}
          </p>
          <p className="mt-1 text-xs text-faint">
            {next ? (
              <>
                <span className="font-mono">{next.code}</span> · {next.date}
              </>
            ) : (
              "No air date announced"
            )}
          </p>
        </div>

        {countdown ? (
          <span className="shrink-0 rounded-full border border-accent-border bg-accent-tint px-2.5 py-1 text-[11px] text-accent-deep">
            {countdown}
          </span>
        ) : null}
      </div>
    </div>
  );
}
