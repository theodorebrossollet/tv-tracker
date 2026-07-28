import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Poster } from "@/components/poster";
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
              title="Nothing tracked yet"
              description="Search for a show to start tracking your progress through it."
              action={{ href: "/search", label: "Find a show" }}
            />
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {watching.map((show) => {
              const percent =
                show.airedCount === 0
                  ? 0
                  : Math.round((show.watchedCount / show.airedCount) * 100);

              return (
                <li key={show.showId}>
                  <Link
                    href={`/show/${show.showId}`}
                    className="flex gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-surface"
                  >
                    <Poster
                      path={show.posterPath}
                      name={show.name}
                      width={64}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{show.name}</p>

                      <p className="mt-0.5 text-xs text-muted">
                        {show.watchedCount} / {show.airedCount} aired episodes
                        watched
                      </p>

                      <div
                        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"
                        role="progressbar"
                        aria-valuenow={percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${show.name} progress`}
                      >
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      <p className="mt-2 truncate text-xs">
                        {show.nextUnwatched ? (
                          <>
                            <span className="text-muted">Next up: </span>
                            <span className="font-mono">
                              {episodeCode(
                                show.nextUnwatched.seasonNumber,
                                show.nextUnwatched.episodeNumber,
                              )}
                            </span>{" "}
                            {show.nextUnwatched.name ?? ""}
                          </>
                        ) : (
                          <span className="text-muted">
                            {show.airedCount > 0
                              ? "All caught up"
                              : "No episodes aired yet"}
                          </span>
                        )}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold tracking-tight">
          Upcoming episodes
        </h2>
        <p className="mt-1 text-sm text-muted">
          Air dates come from TMDB and refresh twice a day.
        </p>

        {upcoming.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing scheduled"
              description="None of the shows you're watching have an announced air date coming up."
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
                    <p className="truncate text-sm font-medium">
                      {episode.showName}
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
