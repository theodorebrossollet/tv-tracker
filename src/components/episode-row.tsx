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
}

export function EpisodeRow({
  episodeId,
  seasonNumber,
  episodeNumber,
  name,
  airDate,
  watched,
  aired,
}: EpisodeRowProps) {
  // Optimistic local state: the checkbox flips immediately and rolls back if
  // the action fails, rather than waiting for a round trip.
  const [checked, setChecked] = useState(watched);
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
    <li className="flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0">
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
        {formatAirDate(airDate)}
        {airDate && !aired ? " · upcoming" : ""}
      </span>
    </li>
  );
}
