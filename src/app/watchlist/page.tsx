import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Poster } from "@/components/poster";
import { TrackButtons } from "@/components/track-buttons";
import { getTrackedShows } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Watchlist · TV Tracker" };

export default async function WatchlistPage() {
  const shows = await getTrackedShows("watchlist");

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Watchlist</h1>
      <p className="mt-1 text-sm text-muted">
        Shows you want to start later. Move one to “Watching” when you begin it.
      </p>

      {shows.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="Watchlist is empty"
            description="Add shows here when you want to remember to start them later."
            action={{ href: "/search", label: "Find a show" }}
          />
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {shows.map((show) => (
            <li
              key={show.showId}
              className="flex gap-3 rounded-lg border border-border p-3"
            >
              <Link href={`/show/${show.showId}`} className="shrink-0">
                <Poster path={show.posterPath} name={show.name} width={64} />
              </Link>

              <div className="min-w-0 flex-1">
                <Link
                  href={`/show/${show.showId}`}
                  className="font-medium hover:underline"
                >
                  {show.name}
                </Link>

                <p className="mt-0.5 text-xs text-muted">
                  {show.airedCount} episode{show.airedCount === 1 ? "" : "s"}{" "}
                  available
                </p>

                <div className="mt-2.5">
                  <TrackButtons showId={show.showId} status={show.status} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
