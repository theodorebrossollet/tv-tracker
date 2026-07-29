"use client";

import { useOptimistic, useState, useTransition } from "react";

import { markEpisodeWatched, unmarkEpisodeWatched } from "@/app/actions";
import { formatAirDate } from "@/lib/format";

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

/** 49 → "49m", 95 → "1h 35m". */
function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
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

  const code = `S${String(seasonNumber).padStart(2, "0")}E${String(
    episodeNumber,
  ).padStart(2, "0")}`;

  return (
    <li
      className={`border-b border-border last:border-b-0 border-l-2 transition-colors ${
        optimisticWatched
          ? "border-l-accent bg-accent/[0.07]"
          : "border-l-transparent"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={optimisticWatched}
          aria-label={`${name ?? code}${aired ? "" : " (not aired yet)"}`}
          onClick={toggle}
          disabled={pending || !aired}
          title={aired ? undefined : "Hasn't aired yet"}
          className={`flex min-w-0 flex-1 items-center gap-3 text-left ${
            aired ? "cursor-pointer" : "cursor-not-allowed"
          }`}
        >
          <span
            className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
              optimisticWatched
                ? "border-accent bg-accent text-white"
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

          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs text-muted">{code}</span>
            <span
              className={`min-w-0 flex-1 truncate text-sm ${
                optimisticWatched
                  ? "text-muted line-through"
                  : aired
                    ? ""
                    : "text-muted"
              }`}
            >
              {name ?? "Untitled episode"}
            </span>
          </span>
        </button>

        <span className="shrink-0 text-xs text-muted">
          {runtime ? `${formatRuntime(runtime)} · ` : ""}
          {formatAirDate(airDate)}
          {airDate && !aired ? " · upcoming" : ""}
        </span>

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
            className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-surface hover:text-foreground"
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
        ) : (
          // Keeps the date column aligned on rows with no synopsis.
          <span className="size-[26px] shrink-0" aria-hidden="true" />
        )}
      </div>

      {expanded && overview ? (
        <p className="px-3 pb-3 pl-10 text-xs leading-relaxed text-muted">
          {overview}
        </p>
      ) : null}
    </li>
  );
}
