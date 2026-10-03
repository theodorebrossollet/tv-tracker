import Link from "next/link";

import { Poster } from "@/components/poster";
import { PosterGrid } from "@/components/poster-grid";
import { RatingValue } from "@/components/rating-value";
import { ShowMoreLink } from "@/components/show-more-link";
import { CheckIcon, StatusMenu } from "@/components/status-sheet";
import type { TrackedShowSummary } from "@/lib/queries";
import type { ViewMode } from "@/lib/view-mode";

interface LibraryListProps {
  shows: TrackedShowSummary[];
  /**
   * `sunken` is the quieter treatment the handoff gives the secondary section
   * of each segment — Paused under the watchlist, Stopped under Finished.
   */
  tone?: "card" | "sunken";
  /** What to show under the title. */
  detail?: "available" | "progress" | "unaired";
  /** Puts an accent tick before the counter, for the Finished section. */
  tick?: boolean;
  /** Search-param name this list expands with — unique per list on a page. */
  param: string;
  searchParams: Record<string, string | string[] | undefined>;
  limit: number;
  /** Rows (the default) or a grid of posters. */
  view?: ViewMode;
}

/**
 * One section of the Library screen.
 *
 * A server component, like the `ShowList` it replaces: only the rows being
 * shown are rendered and the summaries never cross into the client bundle.
 * `StatusMenu` is the one client island per row, carrying the four values it
 * needs rather than riding along with every field of every show.
 *
 * The link and the menu are siblings rather than nested — a `<button>` inside
 * an `<a>` is invalid HTML and assistive tech handles nested interactive
 * content unpredictably. The link stretches across the card with an `::after`
 * overlay and the menu sits above it in its own stacking context.
 */
export function LibraryList({
  shows,
  tone = "card",
  detail = "available",
  tick = false,
  param,
  searchParams,
  limit,
  view = "rows",
}: LibraryListProps) {
  const shown = shows.slice(0, limit);
  const remaining = shows.length - shown.length;

  return (
    <>
      {view === "posters" ? (
        <PosterGrid
          items={shown.map((show) => ({
            key: show.showId,
            href: `/show/${show.showId}`,
            title: show.name,
            posterPath: show.posterPath,
            seen: tick,
            rating: show.ratingAverage,
            ratingIsAverage: true,
            quiet: tone === "sunken",
          }))}
        />
      ) : (
      <ul className="flex flex-col gap-2">
        {shown.map((show) => (
          <li
            key={show.showId}
            className={`relative flex items-center gap-3 rounded-[15px] border p-[11px] transition-colors ${
              tone === "sunken"
                ? "border-border bg-surface-sunken"
                : "border-border bg-surface"
            }`}
          >
            <Poster path={show.posterPath} name={show.name} width={44} />

            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <Link
                href={`/show/${show.showId}`}
                className={`truncate text-[15px] font-medium tracking-[-0.01em] after:absolute after:inset-0 after:content-[''] ${
                  tone === "sunken" ? "text-muted" : ""
                }`}
              >
                {show.name}
              </Link>

              <span className="flex items-center gap-1.5 text-xs text-muted">
                {tick ? <CheckIcon className="size-[11px] text-accent" /> : null}
                {detail === "progress"
                  ? `${show.watchedCount} / ${show.airedCount} watched`
                  : detail === "unaired"
                    ? "Not aired yet"
                    : `${show.airedCount} episode${
                      show.airedCount === 1 ? "" : "s"
                    } available`}
                {show.ratingAverage !== null ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <RatingValue value={show.ratingAverage} average />
                  </>
                ) : null}
              </span>
            </div>

            <div className="relative">
              <StatusMenu
                showId={show.showId}
                name={show.name}
                status={show.status}
                finished={show.fullyWatched}
              />
            </div>
          </li>
        ))}
      </ul>
      )}

      {remaining > 0 ? (
        <ShowMoreLink
          param={param}
          current={searchParams}
          step={LIBRARY_PAGE_SIZE}
          shown={shown.length}
          remaining={remaining}
          label="Show"
        />
      ) : null}
    </>
  );
}

/** Rows shown before the first "show more", and added per click. */
export const LIBRARY_PAGE_SIZE = 10;
