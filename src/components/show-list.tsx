"use client";

import Link from "next/link";
import { useState } from "react";

import { AddButton } from "@/components/add-button";
import { Poster } from "@/components/poster";
import type { TrackedShowSummary } from "@/lib/queries";

interface ShowListProps {
  shows: TrackedShowSummary[];
  /** What to show under the title. */
  detail?: "available" | "progress";
  /** Rows shown before the first "show more", and added per click. */
  pageSize?: number;
}

/**
 * The compact one-per-row list used by Watchlist and Archive.
 *
 * Paginated because the Archive only grows — finished shows accumulate forever,
 * where Watching and Watchlist churn. Each list holds its own count rather than
 * sharing one, so a long Finished section can't bury the Stopped section
 * underneath it.
 *
 * Every row is already on the page; this only controls how many are rendered,
 * so expanding costs no request.
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
}: ShowListProps) {
  const [visible, setVisible] = useState(pageSize);

  const shown = shows.slice(0, visible);
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
        <button
          type="button"
          onClick={() => setVisible((count) => count + pageSize)}
          className="mt-3 w-full rounded-full border border-border py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          Show {Math.min(pageSize, remaining)} more
          <span className="ml-1.5 text-xs">({remaining} left)</span>
        </button>
      ) : null}
    </>
  );
}
