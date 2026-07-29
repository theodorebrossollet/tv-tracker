import Link from "next/link";

import { AddButton } from "@/components/add-button";
import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { Poster } from "@/components/poster";
import { getTrackedShows } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Watchlist · TV Tracker" };

export default async function WatchlistPage() {
  const shows = await getTrackedShows("watchlist");

  return (
    <div>
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
        <ul className="mt-5 space-y-3">
          {shows.map((show) => (
            <li key={show.showId}>
              <Link
                href={`/show/${show.showId}`}
                className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-surface"
              >
                <Poster path={show.posterPath} name={show.name} width={64} />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{show.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {show.airedCount} episode{show.airedCount === 1 ? "" : "s"}{" "}
                    available
                  </p>
                </div>

                <AddButton
                  showId={show.showId}
                  status={show.status}
                  variant="icon"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
