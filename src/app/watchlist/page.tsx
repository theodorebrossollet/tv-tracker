import Link from "next/link";

import { AddButton } from "@/components/add-button";
import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { Poster } from "@/components/poster";
import { getTrackedShows, type TrackedShowSummary } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Watchlist · TV Tracker" };

export default async function WatchlistPage() {
  const [shows, paused] = await Promise.all([
    getTrackedShows("watchlist"),
    getTrackedShows("paused"),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold tracking-tight">Watchlist</h1>
        <p className="mt-1 text-sm text-muted">
          Shows you haven&rsquo;t started. Mark any episode watched and the show
          moves to Watching on its own.
        </p>

        {shows.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="Watchlist is empty"
              description="Add shows here when you want to remember to start them later."
              action={<FindShowButton />}
            />
          </div>
        ) : (
          <ShowList shows={shows} />
        )}
      </section>

      {/* Deliberately a separate section rather than mixed in: "never started"
          and "started then set aside" are different situations, and merging
          them would lose the progress information that makes paused useful. */}
      {paused.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold tracking-tight">Paused</h2>
          <p className="mt-1 text-sm text-muted">
            Started, then set aside. Your progress is kept, and these stay out
            of Watching and Upcoming episodes. Marking any episode watched
            brings a show back.
          </p>

          <ShowList shows={paused} showProgress />
        </section>
      ) : null}
    </div>
  );
}

function ShowList({
  shows,
  showProgress = false,
}: {
  shows: TrackedShowSummary[];
  showProgress?: boolean;
}) {
  return (
    <ul className="mt-5 space-y-3">
      {shows.map((show) => (
        // The link and the button are siblings, not nested: a <button> inside
        // an <a> is invalid HTML. The link is stretched across the card with an
        // ::after overlay, and the button sits above it.
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
              {showProgress
                ? `${show.watchedCount} / ${show.airedCount} watched`
                : `${show.airedCount} episode${show.airedCount === 1 ? "" : "s"} available`}
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
