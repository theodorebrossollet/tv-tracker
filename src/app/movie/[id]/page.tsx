import Link from "next/link";
import { notFound } from "next/navigation";

import { AddToListButton } from "@/components/add-to-list-button";
import { AlternateAvailability } from "@/components/alternate-availability";
import { Availability } from "@/components/availability";
import { CastRow } from "@/components/cast-row";
import { MarkMovieWatchedButton } from "@/components/mark-movie-watched-button";
import { MovieAddButton } from "@/components/movie-add-button";
import { MovieStatusMenu } from "@/components/movie-status-menu";
import { PastWatches } from "@/components/past-watches";
import { Poster } from "@/components/poster";
import { RatingStrip } from "@/components/rating-strip";
import { Trailer } from "@/components/trailer";
import { WatchAgainButton } from "@/components/watch-again-button";
import { limitFrom } from "@/components/show-more-link";
import {
  coveredAtHome,
  findAlternateCountries,
  parseProviderIds,
} from "@/lib/alternate-countries";
import { requireOnboardedSession } from "@/lib/auth";
import { formatRuntime } from "@/lib/format";
import { describeError, logger } from "@/lib/logger";
import { pickCountry } from "@/lib/pick-country";
import { getListsForTitle, getMovieDetail } from "@/lib/queries";
import { movieResetHistory } from "@/lib/rewatch";
import { isTmdbMovieId } from "@/lib/show-id";
import { getSettings } from "@/lib/shows";
import {
  getMovieExtras,
  getMovieWatchProviders,
  getWatchRegions,
  TmdbError,
  type TmdbMovieExtras,
} from "@/lib/tmdb";

export const dynamic = "force-dynamic";

/** Search param the alternate-countries list reveals itself with. */
const ALT_COUNTRY_PARAM = "altCountries";
/** Rows shown before "show more" in the alternate-countries list. */
const ALT_COUNTRY_PAGE_SIZE = 6;

interface MoviePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
}: Pick<MoviePageProps, "params">) {
  const { id } = await params;
  // Also gated: metadata runs before the component and would otherwise read a
  // movie's tracked state without a session. `getMovieDetail` is memoized per
  // request, so this costs nothing the component doesn't already pay.
  const { user } = await requireOnboardedSession();
  const movie = isTmdbMovieId(id) ? await getMovieDetail(user.id, id) : null;

  return { title: movie ? `${movie.title} · TV Tracker` : "Movie · TV Tracker" };
}

export default async function MoviePage({
  params,
  searchParams,
}: MoviePageProps) {
  const { id } = await params;
  const params_ = await searchParams;
  const { user } = await requireOnboardedSession();

  // Untrusted: the id flows into a TMDB request path and the Movie cache key.
  if (!isTmdbMovieId(id)) notFound();

  const movie = await getMovieDetail(user.id, id);
  // Falls back to TMDB for movies nobody has cached, so null means TMDB
  // doesn't know the id either.
  if (!movie) notFound();

  // A read, never a write: viewing a page must not change anything. Secondary
  // to the page, so a failure (say, code deployed before the `add_lists`
  // migration) drops the button rather than taking the page down.
  const lists = await getListsForTitle(user.id, "movie", id).catch((error) => {
    logger.warn("lists.for_title_failed", describeError(error));
    return null;
  });

  // Tagline, cast, trailer and the rest. Cosmetic, so TMDB being slow or down
  // drops the extras instead of the page.
  const extras: TmdbMovieExtras | null = await getMovieExtras(id).catch(
    (error) => {
      logger.warn("movie.extras_failed", describeError(error));
      return null;
    },
  );

  // Where to watch. Like the extras above, a nice-to-have: TMDB being down or
  // rate-limiting drops the section, not the page. The settings country and
  // services decide which country is shown first and what counts as "yours".
  const settings = await getSettings(user.id);
  let countries: Awaited<ReturnType<typeof getMovieWatchProviders>> = [];
  let regions: Awaited<ReturnType<typeof getWatchRegions>> = [];
  try {
    [countries, regions] = await Promise.all([
      getMovieWatchProviders(id),
      getWatchRegions(),
    ]);
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    logger.warn("movie.availability_unavailable", describeError(error));
  }
  const availabilityKnown = countries.length > 0 || regions.length > 0;

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

  // Measured against the settings country, not the one being browsed: see the
  // show page, which this mirrors.
  const homeCountry = settings.country ?? undefined;
  const providerIds = parseProviderIds(settings.providerIds);
  const alternateCountries = coveredAtHome(countries, providerIds, homeCountry)
    ? []
    : findAlternateCountries(countries, providerIds, homeCountry);
  const altCountryLimit = limitFrom(
    params_,
    ALT_COUNTRY_PARAM,
    ALT_COUNTRY_PAGE_SIZE,
  );
  const shownAlternateCountries = alternateCountries
    .slice(0, altCountryLimit)
    .map((country) => ({ ...country, name: nameFor(country.code) }));

  // Built from what the page already read. Offered whenever there is something
  // to delete, which includes an untracked movie that only has past watches.
  const resetHistory = movieResetHistory(movie.status, movie.pastWatches);

  const year =
    movie.releaseDate && !Number.isNaN(movie.releaseDate.getTime())
      ? String(movie.releaseDate.getUTCFullYear())
      : null;
  const meta = [
    year,
    movie.runtime ? formatRuntime(movie.runtime) : null,
    movie.genres,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="pb-6 pt-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/"
          aria-label="Back"
          className="-ml-2 flex size-10 items-center justify-center rounded-full"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[19px]"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>

        <div className="flex items-center gap-2">
          {lists ? (
            <AddToListButton kind="movie" titleId={movie.id} lists={lists} />
          ) : null}

          {/* An untracked movie normally has no pill — the buttons below add
              it. With past watches it gets one, so "Reset history" is
              reachable; it reads "Not tracked" and offers the usual rows. */}
          {movie.status || resetHistory ? (
            <MovieStatusMenu
              movieId={movie.id}
              title={movie.title}
              status={movie.status}
              variant="pill"
              resetHistory={resetHistory}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-end gap-3.5">
        <Poster path={movie.posterPath} name={movie.title} width={92} />

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold leading-[27px] tracking-[-0.025em]">
            {movie.title}
          </h1>
          {extras?.tagline ? (
            <p className="mt-1 text-[13px] italic leading-[18px] text-muted">
              {extras.tagline}
            </p>
          ) : null}
          {meta ? (
            <p className="mt-[5px] text-xs leading-4 text-muted">{meta}</p>
          ) : null}
          {extras?.directors.length ? (
            <p className="mt-[3px] text-xs leading-4 text-muted">
              Directed by {extras.directors.join(", ")}
            </p>
          ) : null}
          {extras?.score ? (
            <p className="mt-[3px] text-xs leading-4 text-muted">
              TMDB {extras.score.toFixed(1)}/10
            </p>
          ) : null}
          {extras?.collection ? (
            <p className="mt-[3px] text-xs leading-4 text-muted">
              Part of {extras.collection}
            </p>
          ) : null}
        </div>
      </div>

      {movie.status !== "watched" && movie.status !== "not_interested" ? (
        <div className="mt-5 flex flex-wrap items-start gap-2">
          {movie.status === null ? (
            <MovieAddButton movieId={movie.id} status={null} variant="full" />
          ) : null}
          <MarkMovieWatchedButton movieId={movie.id} />
        </div>
      ) : null}

      {movie.status === "watched" ? (
        <section className="mt-5">
          <h2 className="mb-2 text-xs font-medium leading-4 text-muted">
            Your rating
          </h2>
          <RatingStrip kind="movie" id={movie.id} rating={movie.rating} />
          <div className="mt-3">
            <WatchAgainButton
              movieId={movie.id}
              watchedAt={movie.watchedAt?.toISOString() ?? null}
              rating={movie.rating}
            />
          </div>
        </section>
      ) : null}

      <PastWatches watches={movie.pastWatches} />

      {movie.overview ? (
        <p className="mt-5 text-sm leading-[21px] text-muted">
          {movie.overview}
        </p>
      ) : null}

      {extras?.trailer ? (
        <div className="mt-5">
          <Trailer
            options={[
              {
                id: "movie",
                label: "Movie",
                videoKey: extras.trailer.key,
                name: extras.trailer.name,
              },
            ]}
            showName={movie.title}
          />
        </div>
      ) : null}

      {availabilityKnown ? (
        <>
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
          ) : (
            <p className="mt-8 rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted">
              No streaming, rental or purchase option listed for this movie.
            </p>
          )}

          {shownAlternateCountries.length > 0 ? (
            <AlternateAvailability
              shown={shownAlternateCountries}
              remaining={
                alternateCountries.length - shownAlternateCountries.length
              }
              param={ALT_COUNTRY_PARAM}
              current={params_}
              step={ALT_COUNTRY_PAGE_SIZE}
            />
          ) : null}
        </>
      ) : null}

      {extras ? <CastRow cast={extras.cast} /> : null}
    </div>
  );
}
