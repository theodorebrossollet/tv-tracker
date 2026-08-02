import Link from "next/link";

import { Poster } from "@/components/poster";
import { ShowMoreLink } from "@/components/show-more-link";
import { StatusBadge } from "@/components/status-badge";
import { relativeAirDate } from "@/lib/format";
import type { UpcomingEpisode } from "@/lib/queries";

/** How many rows to show at first, and to add per click. */
export const UPCOMING_PAGE_SIZE = 15;

/** Search param this list expands with. */
export const UPCOMING_PARAM = "upcoming";

function episodeCode(seasonNumber: number, episodeNumber: number) {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(
    episodeNumber,
  ).padStart(2, "0")}`;
}

interface UpcomingListProps {
  episodes: UpcomingEpisode[];
  searchParams: Record<string, string | string[] | undefined>;
  limit: number;
}

/**
 * The upcoming-episodes list, revealed a page at a time.
 *
 * A server component: the query caps at 50 episodes, and previously all of them
 * serialised into the page whether or not anyone expanded the list. Now only
 * the rows being shown are rendered, and "Load more" is a URL rather than
 * client state.
 */
export function UpcomingList({
  episodes,
  searchParams,
  limit,
}: UpcomingListProps) {
  const shown = episodes.slice(0, limit);
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
        <ShowMoreLink
          param={UPCOMING_PARAM}
          current={searchParams}
          step={UPCOMING_PAGE_SIZE}
          shown={shown.length}
          remaining={remaining}
          label="Load"
        />
      ) : null}
    </>
  );
}
