import Link from "next/link";

import { AddButton } from "@/components/add-button";
import { Poster } from "@/components/poster";
import { ShowMoreLink } from "@/components/show-more-link";
import type { TrackedShowSummary } from "@/lib/queries";

interface ShowListProps {
  shows: TrackedShowSummary[];
  /** What to show under the title. */
  detail?: "available" | "progress";
  /** Rows shown before the first "show more", and added per click. */
  pageSize?: number;
  /** Search-param name this list expands with — unique per list on a page. */
  param: string;
  /** The page's current search params, for building the expand link. */
  searchParams: Record<string, string | string[] | undefined>;
  /** How many rows to render, already read off the URL by the page. */
  limit: number;
}

/**
 * The compact one-per-row list used by Watchlist and Archive.
 *
 * Paginated because the Archive only grows — finished shows accumulate forever,
 * where Watching and Watchlist churn. Each list expands under its own search
 * param rather than sharing one, so a long Finished section can't bury the
 * Stopped section underneath it.
 *
 * A server component: only the rows being shown are rendered, and the summaries
 * never cross into the client bundle. `AddButton` is still a client island per
 * row — it has to be, it's interactive — but it now carries only the two values
 * it needs instead of riding along with every field of every show.
 *
 * The link and the button are siblings rather than nested: a `<button>` inside
 * an `<a>` is invalid HTML and assistive tech handles nested interactive
 * content unpredictably. The link is stretched across the card with an
 * `::after` overlay, and the button sits above it.
 */
export function ShowList({
  shows,
  detail = "available",
  pageSize = 10,
  param,
  searchParams,
  limit,
}: ShowListProps) {
  const shown = shows.slice(0, limit);
  const remaining = shows.length - shown.length;

  return (
    <>
      <ul className="mt-5 space-y-3">
        {shown.map((show) => (
          <li
            key={show.showId}
            className="relative flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-surface"
          >
            <Poster path={show.posterPath} name={show.name} width={64} />

            <div className="min-w-0 flex-1">
              <Link
                href={`/show/${show.showId}`}
                className="truncate font-medium after:absolute after:inset-0 after:content-['']"
              >
                {show.name}
              </Link>
              <p className="mt-0.5 text-xs text-muted">
                {detail === "progress"
                  ? `${show.watchedCount} / ${show.airedCount} watched`
                  : `${show.airedCount} episode${
                      show.airedCount === 1 ? "" : "s"
                    } available`}
              </p>
            </div>

            <div className="relative">
              <AddButton
                showId={show.showId}
                status={show.status}
                variant="icon"
              />
            </div>
          </li>
        ))}
      </ul>

      {remaining > 0 ? (
        <ShowMoreLink
          param={param}
          current={searchParams}
          step={pageSize}
          shown={shown.length}
          remaining={remaining}
          label="Show"
        />
      ) : null}
    </>
  );
}
