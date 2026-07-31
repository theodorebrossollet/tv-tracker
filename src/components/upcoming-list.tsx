"use client";

import Link from "next/link";
import { useState } from "react";

import { Poster } from "@/components/poster";
import { StatusBadge } from "@/components/status-badge";
import { relativeAirDate } from "@/lib/format";
import type { UpcomingEpisode } from "@/lib/queries";

/** How many rows to show at first, and to add per click. */
const PAGE_SIZE = 15;

function episodeCode(seasonNumber: number, episodeNumber: number) {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(
    episodeNumber,
  ).padStart(2, "0")}`;
}

/**
 * The upcoming-episodes list, revealed a page at a time.
 *
 * All the rows are already on the page — this only controls how many are
 * rendered, so "Load more" costs no request. The server caps the query well
 * above the page size, which is what actually bounds the payload.
 */
export function UpcomingList({ episodes }: { episodes: UpcomingEpisode[] }) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  const shown = episodes.slice(0, visible);
  const remaining = episodes.length - shown.length;

  return (
    <>
      <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
        {shown.map((episode) => (
          <li key={episode.episodeId}>
            <Link
              href={`/show/${episode.showId}`}
              className="flex items-center gap-3 p-3 transition-colors hover:bg-surface"
            >
              <Poster
                path={episode.posterPath}
                name={episode.showName}
                width={40}
              />

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {episode.showName}
                  {/* Only worth flagging the ones you haven't started — a
                      "Watching" badge on most rows would be noise. */}
                  {episode.status === "watchlist" ? (
                    <StatusBadge status={episode.status} />
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted">
                  <span className="font-mono">
                    {episodeCode(episode.seasonNumber, episode.episodeNumber)}
                  </span>
                  {episode.name ? ` · ${episode.name}` : ""}
                </p>
              </div>

              <span className="shrink-0 text-xs text-muted">
                {relativeAirDate(episode.airDate.toISOString())}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => setVisible((count) => count + PAGE_SIZE)}
          className="mt-3 w-full rounded-full border border-border py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          Load {Math.min(PAGE_SIZE, remaining)} more
          <span className="ml-1.5 text-xs">({remaining} left)</span>
        </button>
      ) : null}
    </>
  );
}
