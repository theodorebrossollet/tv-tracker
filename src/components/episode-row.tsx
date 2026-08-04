"use client";

import { useOptimistic, useState, useTransition } from "react";

import { markEpisodeWatched, unmarkEpisodeWatched } from "@/app/actions";
import { episodeCode } from "@/lib/episode-code";
import { formatAirDate, formatRuntime } from "@/lib/format";

interface EpisodeRowProps {
  episodeId: string;
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  airDate: string | null;
  watched: boolean;
  /** Computed on the server so server and client agree during hydration. */
  aired: boolean;
  runtime: number | null;
  overview: string | null;
}

export function EpisodeRow({
  episodeId,
  seasonNumber,
  episodeNumber,
  name,
  airDate,
  watched,
  aired,
  runtime,
  overview,
}: EpisodeRowProps) {
  // useOptimistic, not useState: the displayed value is derived from the
  // `watched` prop, so it follows the server after a revalidation. The previous
  // useState version initialised once and then ignored props — which meant
  // "Mark all watched" updated the database and the season counter while the
  // rows themselves stayed visibly unwatched.
  const [optimisticWatched, setOptimisticWatched] = useOptimistic(watched);
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle() {
    // Episodes that haven't aired can't be marked, matching what
    // "Mark all watched" does for the season.
    if (!aired) return;

    startTransition(async () => {
      setOptimisticWatched(!watched);

      // No manual rollback needed: when the transition ends, the optimistic
      // value is dropped and the prop wins — the refreshed one on success, the
      // original one on failure.
      if (watched) {
        await unmarkEpisodeWatched(episodeId);
      } else {
        await markEpisodeWatched(episodeId);
      }
    });
  }

  const code = episodeCode(seasonNumber, episodeNumber);

  return (
    <li
      className={`rounded-xl transition-colors ${
        optimisticWatched ? "bg-accent/[0.06]" : ""
      }`}
    >
      <div className="flex min-h-[52px] items-center gap-3 px-2 py-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={optimisticWatched}
          aria-label={`${name ?? code}${aired ? "" : " (not aired yet)"}`}
          onClick={toggle}
          disabled={pending || !aired}
          title={aired ? undefined : "Hasn't aired yet"}
          className={`flex min-w-0 flex-1 items-center gap-3 text-left ${
            aired ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-[7px] border transition-colors ${
              optimisticWatched
                ? "border-accent bg-accent text-on-accent"
                : aired
                  ? "border-muted"
                  : "border-dashed border-border"
            }`}
          >
            {optimisticWatched ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-3"
              >
                <path d="m5 13 4 4L19 7" />
              </svg>
            ) : null}
          </span>

          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* Not struck through. The tint and the filled box carry it: a
                strikethrough on every watched row of a long season turns the
                list into a wall of crossed-out text. */}
            <span
              className={`truncate text-[14.5px] ${
                optimisticWatched || !aired ? "text-muted" : ""
              }`}
            >
              {name ?? "Untitled episode"}
            </span>

            <span className="truncate font-mono text-[10.5px] text-faint">
              {code}
              {runtime ? ` · ${formatRuntime(runtime)}` : ""}
              {` · ${formatAirDate(airDate)}`}
              {airDate && !aired ? " · upcoming" : ""}
            </span>
          </span>
        </button>

        {/* Synopses are hidden by default: a 92-episode show would otherwise
            be an unusable wall of text. */}
        {overview ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? `Hide synopsis for ${code}`
                : `Show synopsis for ${code}`
            }
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={`size-3.5 transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : null}
      </div>

      {expanded && overview ? (
        <p className="px-2 pb-3 pl-11 text-xs leading-relaxed text-muted">
          {overview}
        </p>
      ) : null}
    </li>
  );
}
