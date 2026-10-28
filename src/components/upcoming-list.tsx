import Link from "next/link";

import { Poster } from "@/components/poster";
import { ShowMoreLink } from "@/components/show-more-link";
import { StatusBadge } from "@/components/status-badge";
import type { UpcomingEpisode } from "@/lib/queries";
import { formatAirDateShort } from "@/lib/format";
import {
  groupLabel,
  groupRows,
  isSoon,
  LATER,
  rowDetail,
  upcomingRows,
  type UpcomingRow,
} from "@/lib/upcoming-days";

/** How many rows to show at first, and to add per click. */
export const UPCOMING_PAGE_SIZE = 15;

/** Search param this list expands with. */
export const UPCOMING_PARAM = "upcoming";

interface UpcomingListProps {
  episodes: UpcomingEpisode[];
  searchParams: Record<string, string | string[] | undefined>;
  limit: number;
}

/**
 * The upcoming-episodes list, by day, revealed a page at a time.
 *
 * A server component: the query caps at 90 episodes, and previously all of them
 * serialised into the page whether or not anyone expanded the list. Now only
 * the rows being shown are rendered, and "Load more" is a URL rather than
 * client state. Movies have their own list (`UpcomingMoviesList`).
 *
 * Pages count rows, not episodes (`upcomingRows`): a season dropped at once is
 * one row, and so is everything a show has scheduled past this week.
 */
export function UpcomingList({
  episodes,
  searchParams,
  limit,
}: UpcomingListProps) {
  const rows = upcomingRows(episodes);
  const shown = rows.slice(0, limit);
  const remaining = rows.length - shown.length;

  return (
    <>
      {groupRows(shown).map(({ group, rows: groupedRows }) => (
        <div key={group} className="mt-4 first:mt-3">
          <h3
            className={`text-[12px] font-semibold uppercase tracking-[0.06em] ${
              group !== LATER && isSoon(group) ? "text-highlight" : "text-faint"
            }`}
          >
            {groupLabel(group)}
          </h3>
          <ul className="mt-1">
            {groupedRows.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </ul>
        </div>
      ))}

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

function Row({ row }: { row: UpcomingRow }) {
  return (
    <li className="border-b border-border-faint last:border-b-0">
      <Link
        href={`/show/${row.showId}`}
        className="flex items-center gap-[11px] py-[9px]"
      >
        <Poster path={row.posterPath} name={row.showName} width={34} />

        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex items-center gap-[7px]">
            <span className="min-w-0 truncate text-sm font-medium">
              {row.showName}
            </span>
            {/* Only worth flagging the ones you haven't started — a
                "Watching" badge on most rows would be noise. */}
            {row.status === "watchlist" ? (
              <StatusBadge status={row.status} />
            ) : null}
          </span>

          <span className="truncate text-[12px] tabular-nums text-faint">
            {rowDetail(row)}
          </span>
        </div>

        {/* Under Later the header no longer dates the row, so it dates
            itself, and says how much more of the show is scheduled. */}
        {row.group === LATER ? (
          <span className="flex shrink-0 flex-col items-end gap-[3px] text-xs text-faint">
            {formatAirDateShort(row.episodes[0].airDate.toISOString())}
            {row.more > 0 ? (
              <span className="text-[11px]">+{row.more} more</span>
            ) : null}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
