"use client";

import { useState, useTransition } from "react";

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
  // Optimistic local state: the checkbox flips immediately and rolls back if
  // the action fails, rather than waiting for a round trip.
  const [checked, setChecked] = useState(watched);
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !checked;
    setChecked(next);

    startTransition(async () => {
      const result = next
        ? await markEpisodeWatched(episodeId)
        : await unmarkEpisodeWatched(episodeId);

      if (!result.ok) {
        setChecked(!next);
      }
    });
  }

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          id={`ep-${episodeId}`}
          checked={checked}
          onChange={toggle}
          disabled={pending}
          className="size-4 shrink-0 accent-[var(--accent)]"
        />

        <label
          htmlFor={`ep-${episodeId}`}
          className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-baseline gap-x-2"
        >
          <span className="font-mono text-xs text-muted">
            S{String(seasonNumber).padStart(2, "0")}E
            {String(episodeNumber).padStart(2, "0")}
          </span>
          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              checked ? "text-muted line-through" : ""
            }`}
          >
            {name ?? "Untitled episode"}
          </span>
        </label>

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
                ? `Hide synopsis for episode ${episodeNumber}`
                : `Show synopsis for episode ${episodeNumber}`
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
