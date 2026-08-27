import { notFound } from "next/navigation";

import { AlternateAvailability } from "@/components/alternate-availability";
import { Availability } from "@/components/availability";
import { EpisodeRow } from "@/components/episode-row";
import {
  CaughtUpCard,
  NEXT_UP_QUEUE,
  NextUpCard,
  type NextUpEpisode,
} from "@/components/next-up-card";
import { RefreshStrip } from "@/components/refresh-strip";
import { limitFrom } from "@/components/show-more-link";
import { ShowHeader } from "@/components/show-header";
import {
  SeasonTabs,
  ShowSegments,
  type SeasonSummary,
} from "@/components/show-tabs";
import { StatusMenu } from "@/components/status-sheet";
import { Trailer, type TrailerOption } from "@/components/trailer";
import {
  countdownTo,
  formatAirDate,
  formatRuntime,
  showMetaLine,
} from "@/lib/format";
import { episodeCode } from "@/lib/episode-code";
import { requireOnboardedSession } from "@/lib/auth";
import {
  coveredAtHome,
  findAlternateCountries,
  parseProviderIds,
} from "@/lib/alternate-countries";
import { getShowDetail } from "@/lib/queries";
import { pickCountry } from "@/lib/pick-country";
import { seasonFrom, tabFrom } from "@/lib/show-tabs";
import { currentSeason, upNextState } from "@/lib/up-next";
import { isTmdbShowId } from "@/lib/show-id";
import { describeError, logger } from "@/lib/logger";
// STALE_AFTER_MS is imported rather than restated: it is the threshold
// `ensureShowCached` schedules the background re-sync on, and the "Checking for
// new episodes…" line below is a claim about that. Two copies would drift and
// the page would start announcing a refresh nothing had queued.
import { getSettings, STALE_AFTER_MS } from "@/lib/shows";
import {
  getSeasonTrailers,
  getShowTrailer,
  getWatchProviders,
  getWatchRegions,
  TmdbError,
} from "@/lib/tmdb";

/** Search param the alternate-countries list reveals itself with. */
const ALT_COUNTRY_PARAM = "altCountries";
/** Rows shown before "show more" in the alternate-countries list. */
const ALT_COUNTRY_PAGE_SIZE = 6;

export const dynamic = "force-dynamic";

/**
 * A manual refresh is a full multi-season TMDB walk, and `getAllEpisodes`
 * fetches seasons sequentially — eleven round trips for a ten-season show.
 * Vercel's default function timeout is 10s, which a long-running show will
 * exceed; the Hobby ceiling is 60.
 */
export const maxDuration = 60;

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

  const tab = tabFrom(params_);
  const now = new Date();

  // ---------------------------------------------------------------------
  // Progress, next up, and what the seasons strip says.
  // ---------------------------------------------------------------------

  // Counts, per-episode `aired`, and `finished` all come from `getShowDetail`.
  // This page used to derive them, which put a second implementation of both
  // rules a directory away from the one the lists use — see the note there.
  const { airedCount, watchedCount, finished } = show;

  const allEpisodes = show.seasons.flatMap((entry) => entry.episodes);

  // Seasons are sorted and episodes ordered within them, so the first unaired
  // one is the next to come — whether or not TMDB has dated it. The undated
  // ones matter: they are what tells "you're up to date with season 2, the
  // rest isn't scheduled" apart from "season 2 is over".
  const nextUnaired = allEpisodes.find((episode) => !episode.aired) ?? null;

  // The next one that has actually been *scheduled*, which is the only kind
  // the header can promise a date for.
  const nextScheduled =
    allEpisodes.find(
      (episode) => !episode.aired && episode.airDate !== null,
    ) ?? null;

  // Presentation, so it stays here: the queue is capped for the payload's sake
  // and each entry carries a pre-formatted line. What it must *not* do is
  // decide again what "aired" means.
  const unwatchedQueue: NextUpEpisode[] = allEpisodes
    .filter((episode) => episode.aired && !episode.watched)
    .slice(0, NEXT_UP_QUEUE)
    .map((episode) => ({
      id: episode.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      name: episode.name,
      meta: [
        `Season ${episode.seasonNumber}`,
        episode.runtime ? formatRuntime(episode.runtime) : null,
        formatAirDate(episode.airDate?.toISOString() ?? null),
      ]
        .filter(Boolean)
        .join(" · "),
    }));

  // The queue and the season pills answer one question — which aired episodes
  // are unwatched — from one array, so they cannot legitimately disagree. They
  // have: a show reading 15 of 20 watched, with the strip correctly showing 5
  // outstanding on season 2, rendered the caught-up card, which only appears
  // when this queue is empty. Nothing in this file can produce that, so the
  // cause is upstream of `getShowDetail` and needs a render to point at.
  if (unwatchedQueue.length === 0 && airedCount > watchedCount) {
    logger.error("show.progress_mismatch", {
      showId: show.id,
      airedCount,
      watchedCount,
      episodeCount: allEpisodes.length,
      // Named per season: whichever season the difference sits in is where the
      // rows worth looking at are.
      seasons: show.seasons.map((season) => ({
        seasonNumber: season.seasonNumber,
        aired: season.airedCount,
        watched: season.watchedCount,
        episodes: season.episodes.length,
      })),
    });
  }

  const seasonSummaries: SeasonSummary[] = show.seasons.map((season) => ({
    seasonNumber: season.seasonNumber,
    unwatched: season.airedCount - season.watchedCount,
    hasAired: season.airedCount > 0,
    allWatched: season.allWatched,
  }));

  // Opening a show you're partway through should land on the part you're
  // partway through — the season with the next unwatched episode, or, when
  // there is nothing left to watch, the last one you watched into.
  const activeSeason = seasonFrom(
    params_,
    seasonSummaries.map((season) => season.seasonNumber),
    currentSeason(show.seasons, unwatchedQueue[0]?.seasonNumber),
  );
  const season = show.seasons.find(
    (entry) => entry.seasonNumber === activeSeason,
  );

  // ---------------------------------------------------------------------
  // TMDB extras, fetched only for the tab that shows them.
  //
  // These are four requests — providers, regions, the show trailer and one
  // per season — and the Episodes tab displays none of them. Skipping them
  // there is most of what moving the segment into the URL buys.
  // ---------------------------------------------------------------------

  let countries: Awaited<ReturnType<typeof getWatchProviders>> = [];
  let regions: Awaited<ReturnType<typeof getWatchRegions>> = [];
  let trailer: Awaited<ReturnType<typeof getShowTrailer>> = null;
  let seasonTrailers: Awaited<ReturnType<typeof getSeasonTrailers>> = [];

  if (tab !== "episodes") {
    // Availability and the trailer are nice-to-haves: if TMDB is unreachable
    // or rate-limits us, the rest of the page should still render.
    try {
      if (tab === "watch") {
        [countries, regions] = await Promise.all([
          getWatchProviders(id),
          getWatchRegions(),
        ]);
      } else {
        [trailer, seasonTrailers] = await Promise.all([
          getShowTrailer(id),
          getSeasonTrailers(
            id,
            show.seasons.map((entry) => entry.seasonNumber),
          ),
        ]);
      }
    } catch (error) {
      if (!(error instanceof TmdbError)) throw error;
      logger.warn("show.extras_unavailable", describeError(error));
    }
  }

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

  // Measured against the settings country, NOT `selectedCountry`. The country
  // switcher is a browsing affordance — "do I already have this at home"
  // doesn't change when you peek at another region, and keying off the browsed
  // country got it wrong both ways: peeking at GB while living in FR listed FR
  // itself as somewhere to VPN to, and a show with no FR listing at all fell
  // back to some arbitrary first country whose coverage then suppressed the
  // section entirely. Undefined when no country is set, which yields nothing.
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

  const upcoming = nextScheduled
    ? {
        code: episodeCode(
          nextScheduled.seasonNumber,
          nextScheduled.episodeNumber,
        ),
        // Safe: `nextScheduled` is only matched when it carries a date.
        date: nextScheduled.airDate as Date,
      }
    : null;

  // Which of the nothing-left-to-watch situations this show is in. Every case
  // is enumerated in `upNextState`; the page only supplies the facts.
  const upNext = upNextState({
    showStatus: show.showStatus,
    seasons: show.seasons,
    next: nextUnaired
      ? {
          seasonNumber: nextUnaired.seasonNumber,
          code: episodeCode(
            nextUnaired.seasonNumber,
            nextUnaired.episodeNumber,
          ),
          name: nextUnaired.name,
          date: nextUnaired.airDate
            ? formatAirDate(nextUnaired.airDate.toISOString())
            : null,
        }
      : null,
  });

  // `now`, not `Date.now()`: one clock reading per render, and calling an
  // impure function during render is exactly what React's rules forbid.
  const refreshing =
    now.getTime() - show.lastSynced.getTime() > STALE_AFTER_MS;

  return (
    <div>
      <RefreshStrip
        showId={show.id}
        refreshedLabel={`Refreshed ${formatAirDate(show.lastSynced.toISOString())}`}
      />

      <ShowHeader
        showId={show.id}
        name={show.name}
        posterPath={show.posterPath}
        metaLine={showMetaLine(show)}
        watchedCount={watchedCount}
        airedCount={airedCount}
        status={show.status}
        finished={finished}
        nextAiring={
          upcoming
            ? `${upcoming.code} airs ${formatAirDate(upcoming.date.toISOString())}`
            : null
        }
      />

      <ShowSegments active={tab} params={params_} />

      {tab === "episodes" ? (
        <div className="mt-4 space-y-4">
          {unwatchedQueue.length > 0 ? (
            <NextUpCard queue={unwatchedQueue} />
          ) : (
            <CaughtUpCard
              state={upNext}
              // Tied to the episode the card is describing, not to whatever is
              // next on the calendar: counting down to season 3 under a line
              // about the rest of season 2 would be two different answers.
              countdown={
                nextUnaired?.airDate
                  ? countdownTo(nextUnaired.airDate.toISOString())
                  : null
              }
            />
          )}

          <SeasonTabs
            showId={show.id}
            seasons={seasonSummaries}
            active={activeSeason}
            params={params_}
          />

          <ul className="flex flex-col">
            {season?.episodes.map((episode) => (
              <EpisodeRow
                key={episode.id}
                episodeId={episode.id}
                seasonNumber={episode.seasonNumber}
                episodeNumber={episode.episodeNumber}
                name={episode.name}
                airDate={episode.airDate?.toISOString() ?? null}
                watched={episode.watched}
                aired={episode.aired}
                runtime={episode.runtime}
                overview={episode.overview}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "watch" ? (
        <div className="mt-4">
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
            <p className="rounded-2xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted">
              No streaming, rental or purchase option listed for this show.
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
        </div>
      ) : null}

      {tab === "about" ? (
        <div className="mt-4 space-y-6">
          {trailerOptions.length > 0 ? (
            <Trailer options={trailerOptions} showName={show.name} />
          ) : null}

          {show.overview ? (
            <p className="text-sm leading-relaxed text-muted">
              {show.overview}
            </p>
          ) : null}

          <dl className="divide-y divide-border-faint overflow-hidden rounded-[14px] border border-border bg-surface">
            <MetaRow label="Network" value={show.network} />
            <MetaRow label="Genres" value={show.genres} />
            <MetaRow
              label="Episodes"
              value={`${watchedCount} of ${airedCount} aired watched`}
            />
            <MetaRow
              label="Episode data"
              value={
                refreshing
                  ? "Checking for new episodes…"
                  : `Refreshed ${formatAirDate(show.lastSynced.toISOString())}`
              }
            />

            <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 text-[15px]">
              Status
              <StatusMenu
                showId={show.id}
                name={show.name}
                status={show.status}
                finished={finished}
                variant="pill"
              />
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;

  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 px-3.5 text-[15px]">
      <dt>{label}</dt>
      <dd className="min-w-0 truncate text-right text-muted">{value}</dd>
    </div>
  );
}
