import { notFound } from "next/navigation";

import { AddButton } from "@/components/add-button";
import { Availability } from "@/components/availability";
import { EpisodeRow } from "@/components/episode-row";
import { Poster } from "@/components/poster";
import { Trailer } from "@/components/trailer";
import { SeasonActions } from "./season-actions";
import { formatAirDate } from "@/lib/format";
import { getShowDetail } from "@/lib/queries";
import { getSettings } from "@/lib/shows";
import {
  getShowTrailer,
  getWatchProviders,
  getWatchRegions,
  TmdbError,
} from "@/lib/tmdb";

export const dynamic = "force-dynamic";

interface ShowPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ShowPageProps) {
  const { id } = await params;
  const show = await getShowDetail(id);

  return { title: show ? `${show.name} · TV Tracker` : "Show · TV Tracker" };
}

export default async function ShowPage({ params }: ShowPageProps) {
  const { id } = await params;

  const [show, settings] = await Promise.all([getShowDetail(id), getSettings()]);

  // getShowDetail falls back to TMDB for shows that aren't tracked, so a null
  // here means TMDB doesn't know this id either.
  if (!show) notFound();

  // Availability and the trailer are nice-to-haves: if TMDB is unreachable or
  // rate-limits us, the rest of the page should still render.
  let countries: Awaited<ReturnType<typeof getWatchProviders>> = [];
  let regions: Awaited<ReturnType<typeof getWatchRegions>> = [];
  let trailer: Awaited<ReturnType<typeof getShowTrailer>> = null;

  try {
    [countries, regions, trailer] = await Promise.all([
      getWatchProviders(id),
      getWatchRegions(),
      getShowTrailer(id),
    ]);
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    console.error("Could not load availability or trailer:", error.message);
  }

  const regionNames = Object.fromEntries(
    regions.map((region) => [region.code, region.name]),
  );

  const hasSettingsCountry = countries.some(
    (country) => country.code === settings.country,
  );

  const now = new Date();

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row">
        <Poster
          path={show.posterPath}
          name={show.name}
          width={140}
          className="self-start"
        />

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{show.name}</h1>

          {show.overview ? (
            <p className="mt-2 text-sm text-muted">{show.overview}</p>
          ) : null}

          <div className="mt-4">
            <AddButton showId={show.id} status={show.status} />
          </div>

          <p className="mt-3 text-xs text-muted">
            Episode data last refreshed{" "}
            {formatAirDate(show.lastSynced.toISOString())}
          </p>
        </div>
      </div>

      {countries.length > 0 ? (
        <Availability
          countries={countries}
          regionNames={regionNames}
          defaultCode={hasSettingsCountry ? settings.country : null}
          settingsCountryUnavailable={
            settings.country && !hasSettingsCountry ? settings.country : null
          }
        />
      ) : null}

      {trailer ? (
        <Trailer
          videoKey={trailer.key}
          name={trailer.name}
          showName={show.name}
        />
      ) : null}

      <div className="mt-8 space-y-6">
        {show.seasons.map((season) => {
          const aired = season.episodes.filter(
            (episode) => episode.airDate !== null && episode.airDate <= now,
          );
          const watchedCount = aired.filter(
            (episode) => episode.watched !== null,
          ).length;
          const allWatched = aired.length > 0 && watchedCount === aired.length;

          return (
            <section key={season.seasonNumber}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">Season {season.seasonNumber}</h2>

                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">
                    {watchedCount} / {aired.length} watched
                  </span>

                  {aired.length > 0 ? (
                    <SeasonActions
                      showId={show.id}
                      seasonNumber={season.seasonNumber}
                      allWatched={allWatched}
                    />
                  ) : null}
                </div>
              </div>

              <ul className="mt-2 rounded-lg border border-border">
                {season.episodes.map((episode) => (
                  <EpisodeRow
                    key={episode.id}
                    episodeId={episode.id}
                    seasonNumber={episode.seasonNumber}
                    episodeNumber={episode.episodeNumber}
                    name={episode.name}
                    airDate={episode.airDate?.toISOString() ?? null}
                    watched={episode.watched !== null}
                    aired={episode.airDate !== null && episode.airDate <= now}
                    runtime={episode.runtime}
                    overview={episode.overview}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
