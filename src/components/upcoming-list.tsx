import Link from "next/link";

import { Poster } from "@/components/poster";
import { ShowMoreLink } from "@/components/show-more-link";
import { StatusBadge } from "@/components/status-badge";
import { episodeCode } from "@/lib/episode-code";
import { daysUntil, relativeAirDate } from "@/lib/format";
import type { UpcomingEpisode } from "@/lib/queries";

/** How many rows to show at first, and to add per click. */
export const UPCOMING_PAGE_SIZE = 15;

/** Search param this list expands with. */
export const UPCOMING_PARAM = "upcoming";

/**
 * Inside this many days the date is worth noticing rather than just reading,
 * so it takes the accent. Matches where `relativeAirDate` stops counting days
 * and starts printing a date — the two would look arbitrary if they disagreed.
 */
const SOON_DAYS = 7;

interface UpcomingListProps {
  episodes: UpcomingEpisode[];
  searchParams: Record<string, string | string[] | undefined>;
  limit: number;
}

/**
 * The upcoming-episodes list, revealed a page at a time.
 *
 * A server component: the query caps at 90 episodes, and previously all of them
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
      <ul className="mt-3">
        {shown.map((episode) => {
          const iso = episode.airDate.toISOString();
          const soon = daysUntil(iso) < SOON_DAYS;

          return (
            <li key={episode.episodeId} className="border-b border-border-faint">
              <Link
                href={`/show/${episode.showId}`}
                className="flex items-center gap-[11px] py-[11px]"
              >
                <Poster
                  path={episode.posterPath}
                  name={episode.showName}
                  width={34}
                />

                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="flex items-center gap-[7px]">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {episode.showName}
                    </span>
                    {/* Only worth flagging the ones you haven't started — a
                        "Watching" badge on most rows would be noise. */}
                    {episode.status === "watchlist" ? (
                      <StatusBadge status={episode.status} />
                    ) : null}
                  </span>

                  <span className="truncate font-mono text-[10.5px] text-faint">
                    {episodeCode(episode.seasonNumber, episode.episodeNumber)}
                    {episode.name ? ` · ${episode.name}` : ""}
                  </span>
                </div>

                <span
                  className={`shrink-0 text-xs ${
                    soon ? "text-accent-deep" : "text-faint"
                  }`}
                >
                  {relativeAirDate(iso)}
                </span>
              </Link>
            </li>
          );
        })}
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
