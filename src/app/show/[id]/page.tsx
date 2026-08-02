import { notFound } from "next/navigation";

import { AddButton } from "@/components/add-button";
import { AlternateAvailability } from "@/components/alternate-availability";
import { Availability } from "@/components/availability";
import { EpisodeRow } from "@/components/episode-row";
import { PauseButton } from "@/components/pause-button";
import { Poster } from "@/components/poster";
import { limitFrom } from "@/components/show-more-link";
import { Trailer, type TrailerOption } from "@/components/trailer";
import { SeasonActions } from "./season-actions";
import { formatAirDate, showMetaLine } from "@/lib/format";
import { requireOnboardedSession } from "@/lib/auth";
import {
  coveredAtHome,
  findAlternateCountries,
  parseProviderIds,
} from "@/lib/alternate-countries";
import { getShowDetail } from "@/lib/queries";
import { pickCountry } from "@/lib/pick-country";
import { isTmdbShowId } from "@/lib/show-id";
import { describeError, logger } from "@/lib/logger";
import { getSettings } from "@/lib/shows";
import {
  getSeasonTrailers,
  getShowTrailer,
  getWatchProviders,
  getWatchRegions,
  TmdbError,
} from "@/lib/tmdb";

/** Rows shown before "see more" in the alternate-countries list. */
const ALT_COUNTRY_PARAM = "altCountries";
const ALT_COUNTRY_PAGE_SIZE = 6;

export const dynamic = "force-dynamic";

interface ShowPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ShowPageProps) {
  const { id } = await params;
  // Also gated: metadata runs before the component and would otherwise read a
  // show's tracked state without a session. `getShowDetail` is memoized per
  // request, so this costs nothing the component doesn't already pay.
  const { user } = await requireOnboardedSession();
  const show = isTmdbShowId(id) ? await getShowDetail(user.id, id) : null;

  return { title: show ? `${show.name} · TV Tracker` : "Show · TV Tracker" };
}

export default async function ShowPage({
  params,
  searchParams,
}: ShowPageProps) {
  const { id } = await params;
  const params_ = await searchParams;
  const { user } = await requireOnboardedSession();

  // The route param is untrusted: it flows into a TMDB request path, the Show
  // cache key, and revalidatePath. Anything that isn't an id is a 404, not a
  // request worth making.
  if (!isTmdbShowId(id)) notFound();

  const [show, settings] = await Promise.all([
    getShowDetail(user.id, id),
    getSettings(user.id),
  ]);

  // getShowDetail falls back to TMDB for shows that aren't tracked, so a null
  // here means TMDB doesn't know this id either.
  if (!show) notFound();

  // Availability and the trailer are nice-to-haves: if TMDB is unreachable or
  // rate-limits us, the rest of the page should still render.
  let countries: Awaited<ReturnType<typeof getWatchProviders>> = [];
  let regions: Awaited<ReturnType<typeof getWatchRegions>> = [];
  let trailer: Awaited<ReturnType<typeof getShowTrailer>> = null;
  let seasonTrailers: Awaited<ReturnType<typeof getSeasonTrailers>> = [];

  try {
    [countries, regions, trailer, seasonTrailers] = await Promise.all([
      getWatchProviders(id),
      getWatchRegions(),
      getShowTrailer(id),
      getSeasonTrailers(
        id,
        show.seasons.map((season) => season.seasonNumber),
      ),
    ]);
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    logger.warn("show.extras_unavailable", describeError(error));
  }

  // The show-wide trailer first, then any season that has one of its own.
  const trailerOptions: TrailerOption[] = [
    ...(trailer
      ? [
          {
            id: "show",
            label: "Show",
            shortLabel: "Show",
            videoKey: trailer.key,
            name: trailer.name,
          },
        ]
      : []),
    ...seasonTrailers.map((entry) => ({
      id: `season-${entry.seasonNumber}`,
      label: `Season ${entry.seasonNumber}`,
      shortLabel: `S${entry.seasonNumber}`,
      videoKey: entry.key,
      name: entry.name,
    })),
  ];

  // Names are looked up rather than shipped: only the countries this show is
  // actually available in need one, not every region TMDB knows about.
  const nameFor = (code: string) =>
    regions.find((region) => region.code === code)?.name ?? code;

  const hasSettingsCountry = countries.some(
    (country) => country.code === settings.country,
  );

  const selectedCountry = pickCountry(
    countries,
    params_.country,
    settings.country,
  );

  const countryOptions = countries.map((country) => ({
    code: country.code,
    name: nameFor(country.code),
  }));

  // Only worth surfacing when the country actually being shown doesn't
  // already have the show on one of the user's own services — nothing to
  // gain from pointing at another country otherwise.
  const providerIds = parseProviderIds(settings.providerIds);
  const alternateCountries = coveredAtHome(
    countries,
    providerIds,
    selectedCountry?.code,
  )
    ? []
    : findAlternateCountries(countries, providerIds, selectedCountry?.code);

  const altCountryLimit = limitFrom(
    params_,
    ALT_COUNTRY_PARAM,
    ALT_COUNTRY_PAGE_SIZE,
  );
  const shownAlternateCountries = alternateCountries
    .slice(0, altCountryLimit)
    .map((country) => ({ ...country, name: nameFor(country.code) }));
  const remainingAlternateCountries =
    alternateCountries.length - shownAlternateCountries.length;

  const metaLine = showMetaLine(show);
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

          {metaLine ? (
            <p className="mt-2 text-xs text-muted">{metaLine}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-start gap-2">
            <AddButton showId={show.id} status={show.status} />
            <PauseButton showId={show.id} status={show.status} />
          </div>

          <p className="mt-3 text-xs text-muted">
            Episode data last refreshed{" "}
            {formatAirDate(show.lastSynced.toISOString())}
          </p>
        </div>
      </div>

      {selectedCountry ? (
        <Availability
          selected={selectedCountry}
          options={countryOptions}
          selectedName={nameFor(selectedCountry.code)}
          settingsCountryUnavailable={
            settings.country && !hasSettingsCountry
              ? { code: settings.country, name: nameFor(settings.country) }
              : null
          }
        />
      ) : null}

      {shownAlternateCountries.length > 0 ? (
        <AlternateAvailability
          shown={shownAlternateCountries}
          remaining={remainingAlternateCountries}
          param={ALT_COUNTRY_PARAM}
          current={params_}
          step={ALT_COUNTRY_PAGE_SIZE}
        />
      ) : null}

      {trailerOptions.length > 0 ? (
        <Trailer options={trailerOptions} showName={show.name} />
      ) : null}

      <div className="mt-8 space-y-6">
        {show.seasons.map((season) => {
          const aired = season.episodes.filter(
            (episode) => episode.airDate !== null && episode.airDate <= now,
          );
          const watchedCount = aired.filter((episode) => episode.watched).length;
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
                    watched={episode.watched}
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
