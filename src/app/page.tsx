import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { Poster } from "@/components/poster";
import { ShowGrid } from "@/components/show-grid";
import { relativeAirDate } from "@/lib/format";
import { getTrackedShows, getUpcomingEpisodes } from "@/lib/queries";

// Everything on this page comes from the database and changes as soon as you
// mark an episode watched, so there's nothing worth prerendering at build time.
export const dynamic = "force-dynamic";

function episodeCode(seasonNumber: number, episodeNumber: number) {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(
    episodeNumber,
  ).padStart(2, "0")}`;
}

export default async function DashboardPage() {
  const [watching, upcoming] = await Promise.all([
    getTrackedShows("watching"),
    getUpcomingEpisodes(15),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold tracking-tight">Watching</h1>

        {watching.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing in progress"
              description="Shows land here automatically once you mark an episode watched. Add one to your watchlist to get started."
              action={<FindShowButton />}
            />
          </div>
        ) : (
          <ShowGrid shows={watching} />
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">
          Upcoming episodes
        </h2>
        <p className="mt-1 text-sm text-muted">
          Across everything you&rsquo;re watching and everything on your
          watchlist. Air dates come from TMDB and refresh twice a day.
        </p>

        {upcoming.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing scheduled"
              description="None of your tracked shows have an announced air date coming up."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {upcoming.map((episode) => (
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
                      {episode.status === "watchlist" ? (
                        <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted">
                          watchlist
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted">
                      <span className="font-mono">
                        {episodeCode(
                          episode.seasonNumber,
                          episode.episodeNumber,
                        )}
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
        )}
      </section>
    </div>
  );
}
