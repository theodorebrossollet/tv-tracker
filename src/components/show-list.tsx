import Link from "next/link";

import { AddButton } from "@/components/add-button";
import { Poster } from "@/components/poster";
import type { TrackedShowSummary } from "@/lib/queries";

interface ShowListProps {
  shows: TrackedShowSummary[];
  /** What to show under the title. */
  detail?: "available" | "progress";
}

/**
 * The compact one-per-row list used by Watchlist and Archive.
 *
 * The link and the button are siblings rather than nested: a `<button>` inside
 * an `<a>` is invalid HTML and assistive tech handles nested interactive
 * content unpredictably. The link is stretched across the card with an
 * `::after` overlay, and the button sits above it.
 */
export function ShowList({ shows, detail = "available" }: ShowListProps) {
  return (
    <ul className="mt-5 space-y-3">
      {shows.map((show) => (
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
  );
}
