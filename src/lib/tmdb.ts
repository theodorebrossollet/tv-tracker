import "server-only";

import { describeError, logger } from "@/lib/logger";

// Thin wrapper around the TMDB API. Endpoints are listed in
// docs/technical-design.md section 6.
//
// This module is server-only: the API key must never reach the browser.

const TMDB_BASE = "https://api.themoviedb.org/3";

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

export interface TmdbSearchResult {
  id: number;
  name: string;
  posterPath: string | null;
  overview: string | null;
  firstAirYear: string | null;
}

export interface TmdbShowDetails {
  id: number;
  name: string;
  posterPath: string | null;
  overview: string | null;
  seasonNumbers: number[];
  firstAirDate: Date | null;
  lastAirDate: Date | null;
  /** "Ended" | "Returning Series" | "In Production" in practice. */
  status: string | null;
  network: string | null;
  /** Comma-separated, in TMDB's own order. */
  genres: string | null;
}

export interface TmdbEpisode {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  airDate: Date | null;
  /** Minutes, when TMDB knows it. */
  runtime: number | null;
  overview: string | null;
}

/**
 * TMDB accepts either a v4 read access token (a JWT, sent as a Bearer header)
 * or a v3 API key (sent as a query param). Detecting which one we were given
 * saves you from having to know the difference when setting up the project.
 */
function buildRequest(path: string, params: Record<string, string>) {
  const key = process.env.TMDB_API_KEY;

  if (!key) {
    throw new TmdbError(
      "TMDB_API_KEY is not set. Copy .env.example to .env and add your key.",
    );
  }

  const url = new URL(`${TMDB_BASE}${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  const headers: Record<string, string> = { accept: "application/json" };
  const isReadAccessToken = key.split(".").length === 3;

  if (isReadAccessToken) {
    headers.Authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set("api_key", key);
  }

  return { url, headers };
}

// In-process cache for the slow-changing endpoints (streaming regions, video
// lists). Next's own fetch cache can't be used here: these pages are
// `dynamic = "force-dynamic"`, which forces `fetchCache: "force-no-store"` and
// discards any `next: { revalidate }` the fetch asks for — measured, not
// assumed. Without this, opening one Game of Thrones page cost 11 TMDB
// requests, every time.
//
// Per-process, so a restart or a second serverless instance re-warms it. That's
// fine for data measured in days, and it avoids a schema change for something
// this peripheral.
const responseCache = new Map<
  string,
  { value: Promise<unknown>; expiresAt: number }
>();

async function cached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = responseCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as Promise<T>;

  // Expired entries are never read again, only replaced — so without this
  // sweep the map grows by one dead entry per show ever browsed, for the life
  // of the process. Amortised here rather than on a timer: a misses-only
  // workload is the only one that grows the map, and it pays as it goes.
  const now = Date.now();
  for (const [staleKey, entry] of responseCache) {
    if (entry.expiresAt <= now) responseCache.delete(staleKey);
  }

  // The *promise* is cached, not the resolved value, and it goes in before
  // anything is awaited — so concurrent callers that miss together share one
  // request instead of each firing their own. A cold instance rendering a show
  // page fans out to providers, regions and a trailer per season at once, and
  // without this every simultaneous viewer multiplied that whole burst.
  const value = load();
  responseCache.set(key, { value, expiresAt: now + ttlSeconds * 1000 });

  // A rejection evicts itself: caching a failure would serve it for the full
  // TTL, turning one bad minute into a day of no trailers. Guarded so a later
  // entry under the same key isn't deleted by an older promise's failure.
  value.catch(() => {
    if (responseCache.get(key)?.value === value) responseCache.delete(key);
  });

  return value;
}

/**
 * How long to wait on TMDB before giving up on a single request.
 *
 * Node's fetch defaults to a 300s headers/body timeout — five times the 60s
 * `maxDuration` on both the cron route and the show page, so without a bound of
 * our own an unresponsive TMDB doesn't fail, it just takes the whole function
 * down with it.
 *
 * The cron is where that actually costs something. Its deadline check runs
 * *between* shows, and a show is a sequential walk of every season, so one slow
 * show is one unbounded iteration — the run gets killed mid-loop and takes the
 * completion log and the expired-session sweep with it, which is precisely what
 * `DEADLINE_MS` exists to prevent. Eight seconds is many times TMDB's normal
 * response and still leaves a ten-season walk inside the budget.
 */
const REQUEST_TIMEOUT_MS = 8_000;

async function tmdbFetch<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const { url, headers } = buildRequest(path, params);

  let response: Response;
  try {
    // Show data isn't cached here — it's cached in our own database instead
    // (see the Show/Episode models), which is the caching layer the design doc
    // calls for. Endpoints that aren't per-show go through `cached()` above.
    response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    // Covers the timeout above as well as a genuine transport failure — both
    // arrive here, and "couldn't reach TMDB" is the honest answer to each.
    //
    // `TmdbError.message` is handed straight to the browser by `toResult`, and
    // a transport failure's message is not ours to vet — undici doesn't
    // normally put the URL in it, but the request URL carries the v3 API key in
    // its query string, so this is the one place a key could reach a visitor.
    // The detail goes to the log instead, where `describeError` keeps name and
    // message only; the visitor gets a fixed string.
    logger.warn("tmdb.unreachable", describeError(cause));
    throw new TmdbError("Could not reach TMDB. Please try again.");
  }

  if (!response.ok) {
    const detail =
      response.status === 401
        ? "TMDB rejected the API key — check TMDB_API_KEY."
        : `TMDB request failed (${response.status}).`;
    throw new TmdbError(detail, response.status);
  }

  return (await response.json()) as T;
}

/**
 * The zone air dates are anchored to.
 *
 * TMDB gives a calendar date with no time, so "when does this episode become
 * watchable" needs a convention. US Eastern is the least-wrong one: most of
 * what this app tracks premieres on a US schedule, and treating the date as
 * midnight UTC (the previous behaviour) unlocked episodes several hours before
 * anywhere in the Americas had reached that date at all.
 *
 * Using the zone name rather than a fixed -05:00 means daylight saving is
 * handled — EST in winter, EDT in summer.
 */
const AIR_DATE_ZONE = "America/New_York";

const ZONE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: AIR_DATE_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** How far `AIR_DATE_ZONE` is from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(at: Date): number {
  const parts = ZONE_PARTS.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  const asIfUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    // Intl can emit hour 24 for midnight in some locales; normalise it.
    read("hour") % 24,
    read("minute"),
    read("second"),
  );

  return asIfUtc - at.getTime();
}

/**
 * Parses TMDB's "YYYY-MM-DD" air dates as midnight in `AIR_DATE_ZONE`,
 * tolerating empty strings.
 *
 * Stored as the equivalent UTC instant, so every `airDate <= now` comparison in
 * the app keeps working unchanged. Because the zone is behind UTC, the UTC
 * calendar date still matches the broadcast date, and `formatAirDate` (which
 * formats in UTC) still shows the right day.
 */
/**
 * Parsed air dates, keyed by the bare `YYYY-MM-DD` string.
 *
 * Each parse runs `Intl.DateTimeFormat.formatToParts` twice and scans its
 * output, and a sync parses every episode of every season — a 300-episode show
 * on every nightly cron visit, for a value that can only ever be one thing.
 *
 * Timestamps rather than `Date` objects, so callers can't mutate a shared one.
 * Bounded in practice by the number of distinct dates TV has ever aired on.
 */
const airDateCache = new Map<string, number | null>();

function parseAirDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const hit = airDateCache.get(value);
  if (hit !== undefined) return hit === null ? null : new Date(hit);

  const midnightUtc = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(midnightUtc.getTime())) {
    airDateCache.set(value, null);
    return null;
  }

  // local = utc + offset, and we want local to read as midnight, so shift the
  // UTC instant back by the offset.
  const firstPass = new Date(midnightUtc.getTime() - zoneOffsetMs(midnightUtc));

  // Re-check at the result in case the first guess sat the other side of a
  // daylight-saving switch.
  const settled = new Date(midnightUtc.getTime() - zoneOffsetMs(firstPass));

  airDateCache.set(value, settled.getTime());

  return settled;
}

interface RawSearchResponse {
  results: Array<{
    id: number;
    name: string;
    poster_path: string | null;
    overview: string | null;
    first_air_date?: string | null;
  }>;
}

/**
 * Short, because a search result is the one thing here that genuinely changes:
 * a new show appears the day TMDB adds it. A minute is long enough to cover
 * what the overlay actually does — reopening it, retyping a title, backing out
 * of a show and searching the same thing again — without holding a stale answer
 * long enough for anyone to notice.
 *
 * Worth caching at all because this is the only TMDB call an ordinary
 * interaction makes on every use, and the only one a signed-in caller can drive
 * at will: the action is POST-able directly with no cooldown, and TMDB's rate
 * limit is shared by everyone using the app.
 */
const SEARCH_CACHE_SECONDS = 60;

export async function searchTvShows(
  query: string,
): Promise<TmdbSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Keyed on the exact query string, so two people searching the same title
  // within the window share one request. Case included: TMDB treats "The Wire"
  // and "the wire" as the same search, but folding them here would be this
  // module deciding that on its behalf.
  const data = await cached(`search:${trimmed}`, SEARCH_CACHE_SECONDS, () =>
    tmdbFetch<RawSearchResponse>("/search/tv", {
      query: trimmed,
      include_adult: "false",
    }),
  );

  return data.results.map((result) => ({
    id: result.id,
    name: result.name,
    posterPath: result.poster_path,
    overview: result.overview || null,
    firstAirYear: result.first_air_date
      ? result.first_air_date.slice(0, 4)
      : null,
  }));
}

interface RawShowResponse {
  id: number;
  name: string;
  poster_path: string | null;
  overview: string | null;
  seasons: Array<{ season_number: number; episode_count: number }>;
  first_air_date: string | null;
  last_air_date: string | null;
  status: string | null;
  networks?: Array<{ name: string }>;
  genres?: Array<{ name: string }>;
}

export async function getShowDetails(
  tmdbShowId: string | number,
): Promise<TmdbShowDetails> {
  const data = await tmdbFetch<RawShowResponse>(`/tv/${tmdbShowId}`);

  return {
    id: data.id,
    name: data.name,
    // Not validated here, unlike provider links and YouTube ids — the two
    // exceptions to this module's "check TMDB's values where the response is
    // mapped" rule, and worth knowing why rather than reading as an omission.
    // Image paths are only ever concatenated into an `image.tmdb.org` URL by
    // `lib/images.ts` and handed to `next/image`, whose `remotePatterns` in
    // next.config.ts pins both host and `/t/p/**` path. A path trying to escape
    // normalises to something that fails that check and simply doesn't render.
    // The guarantee is the allow-list, so it belongs there; if these paths ever
    // reach a plain <img>, it moves here.
    posterPath: data.poster_path,
    overview: data.overview || null,
    // Season 0 is TMDB's "Specials" bucket; skip it, and skip empty seasons
    // that would just cost us a request for nothing.
    seasonNumbers: data.seasons
      .filter((season) => season.season_number > 0 && season.episode_count > 0)
      .map((season) => season.season_number),
    // These are plain calendar dates like an episode's, so they go through the
    // same US-Eastern anchoring — otherwise a show that premiered on the 1st
    // could display as the 31st of the previous month.
    firstAirDate: parseAirDate(data.first_air_date),
    lastAirDate: parseAirDate(data.last_air_date),
    status: data.status || null,
    // Primary network only; TMDB lists co-producers that add noise.
    network: data.networks?.[0]?.name ?? null,
    genres: data.genres?.length
      ? data.genres.map((genre) => genre.name).join(", ")
      : null,
  };
}

interface RawSeasonResponse {
  episodes: Array<{
    id: number;
    season_number: number;
    episode_number: number;
    name: string | null;
    air_date: string | null;
    runtime: number | null;
    overview: string | null;
  }>;
}

export async function getSeasonEpisodes(
  tmdbShowId: string | number,
  seasonNumber: number,
): Promise<TmdbEpisode[]> {
  const data = await tmdbFetch<RawSeasonResponse>(
    `/tv/${tmdbShowId}/season/${seasonNumber}`,
  );

  return data.episodes.map((episode) => ({
    id: episode.id,
    seasonNumber: episode.season_number,
    episodeNumber: episode.episode_number,
    name: episode.name || null,
    airDate: parseAirDate(episode.air_date),
    // Both already present in this response — no extra request needed.
    runtime: episode.runtime ?? null,
    overview: episode.overview || null,
  }));
}

/**
 * Fetches every episode of a show. Seasons are requested sequentially rather
 * than in parallel to stay well inside TMDB's rate limits — tracking a show is
 * a one-off action, so the extra second doesn't matter.
 */
export async function getAllEpisodes(
  tmdbShowId: string | number,
  seasonNumbers: number[],
): Promise<TmdbEpisode[]> {
  const episodes: TmdbEpisode[] = [];

  for (const seasonNumber of seasonNumbers) {
    episodes.push(...(await getSeasonEpisodes(tmdbShowId, seasonNumber)));
  }

  return episodes;
}

// ---------------------------------------------------------------------------
// Streaming availability
//
// TMDB sources this from JustWatch. Their terms require attributing JustWatch
// wherever it's displayed — see the show page.
// ---------------------------------------------------------------------------

export interface WatchProvider {
  id: number;
  name: string;
  logoPath: string | null;
}

export interface CountryAvailability {
  /** ISO 3166-1 alpha-2, e.g. "FR". */
  code: string;
  /** Deep link to the TMDB "watch" page for this show and country. */
  link: string | null;
  /** Included with a subscription. */
  flatrate: WatchProvider[];
  /** Free, possibly ad-supported. */
  free: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
}

interface RawProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority?: number;
}

interface RawProvidersResponse {
  results?: Record<
    string,
    {
      link?: string;
      flatrate?: RawProvider[];
      free?: RawProvider[];
      ads?: RawProvider[];
      rent?: RawProvider[];
      buy?: RawProvider[];
    }
  >;
}

function mapProviders(list: RawProvider[] | undefined): WatchProvider[] {
  if (!list) return [];

  return [...list]
    // display_priority is TMDB's own "show this one first" ordering.
    .sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999))
    .map((provider) => ({
      id: provider.provider_id,
      name: provider.provider_name,
      logoPath: provider.logo_path,
    }));
}

/**
 * Availability moves faster than trailers — titles do enter and leave
 * catalogues — so it gets hours where the video lists get a day. Still cached:
 * this was the one per-show-page TMDB call made fresh on every view.
 */
const PROVIDER_CACHE_SECONDS = 60 * 60 * 6;

/**
 * A provider link we're willing to render as an `href`, or null.
 *
 * These go straight into an anchor, and React only *warns* about a
 * `javascript:` URL — it renders it anyway, one click from running script in
 * the visitor's session. Requiring https rules that out along with every other
 * scheme, and is what these links have always been in practice.
 *
 * Checked here rather than in the component so the guarantee holds for every
 * consumer, and so the validation stays on the server side of the `server-only`
 * boundary this codebase keeps.
 */
function httpsLinkOrNull(link: string | null | undefined): string | null {
  if (!link) return null;

  try {
    return new URL(link).protocol === "https:" ? link : null;
  } catch {
    // Not a URL at all.
    return null;
  }
}

/**
 * Where a show can be streamed, keyed by country code. TMDB returns every
 * country it has data for in one response, so a country switcher costs no
 * extra requests.
 */
export async function getWatchProviders(
  tmdbShowId: string | number,
): Promise<CountryAvailability[]> {
  const data = await cached(
    `providers:${tmdbShowId}`,
    PROVIDER_CACHE_SECONDS,
    () =>
      tmdbFetch<RawProvidersResponse>(`/tv/${tmdbShowId}/watch/providers`),
  );

  return Object.entries(data.results ?? {})
    .map(([code, entry]) => ({
      code,
      link: httpsLinkOrNull(entry.link),
      flatrate: mapProviders(entry.flatrate),
      // TMDB splits "free" and "ads"; both mean "watchable without paying".
      free: [...mapProviders(entry.free), ...mapProviders(entry.ads)],
      rent: mapProviders(entry.rent),
      buy: mapProviders(entry.buy),
    }))
    .filter(
      (entry) =>
        entry.flatrate.length +
          entry.free.length +
          entry.rent.length +
          entry.buy.length >
        0,
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}

export interface WatchRegion {
  code: string;
  name: string;
}

interface RawRegionsResponse {
  results?: Array<{ iso_3166_1: string; english_name: string }>;
}

/**
 * Countries TMDB has streaming data for. Cached for a day — this list changes
 * about never, and it's fetched on every settings page view.
 */
export async function getWatchRegions(): Promise<WatchRegion[]> {
  const data = await cached("regions", 60 * 60 * 24, () =>
    tmdbFetch<RawRegionsResponse>("/watch/providers/regions", {
      language: "en-US",
    }),
  );

  return (data.results ?? [])
    .map((region) => ({ code: region.iso_3166_1, name: region.english_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface RawProviderListResponse {
  results?: RawProvider[];
}

/**
 * Every TV streaming provider TMDB knows about for a region — for the
 * settings page's "which services do you have" picker.
 *
 * Ranked by `display_priority`, same as `mapProviders`, and that ordering is
 * load-bearing rather than cosmetic: TMDB lists several hundred providers per
 * region, which is far more than belongs in one page's payload, so the picker
 * renders a slice of the front of this list and reveals the rest by URL. The
 * caller re-sorts what it actually shows into alphabetical order — popularity
 * decides *which* services appear, name order makes them scannable once they
 * do. Ties fall back to the name so the ranking is stable across requests.
 *
 * Cached for a day, same as `getWatchRegions` — provider catalogues change
 * about as often as the country list does.
 */
export async function getWatchProviderList(
  region: string,
): Promise<WatchProvider[]> {
  const data = await cached(`provider-list:${region}`, 60 * 60 * 24, () =>
    tmdbFetch<RawProviderListResponse>("/watch/providers/tv", {
      watch_region: region,
      language: "en-US",
    }),
  );

  return [...(data.results ?? [])]
    .sort(
      (a, b) =>
        (a.display_priority ?? 999) - (b.display_priority ?? 999) ||
        a.provider_name.localeCompare(b.provider_name),
    )
    .map((provider) => ({
      id: provider.provider_id,
      name: provider.provider_name,
      logoPath: provider.logo_path,
    }));
}

// ---------------------------------------------------------------------------
// Trailers
// ---------------------------------------------------------------------------

export interface TmdbVideo {
  /** YouTube video id, for the embed URL. */
  key: string;
  name: string;
  type: string;
}

interface RawVideosResponse {
  results?: Array<{
    key: string;
    name: string;
    site: string;
    type: string;
    official?: boolean;
    published_at?: string;
  }>;
}

/**
 * A usable YouTube video id.
 *
 * The value is interpolated into a thumbnail URL and an embed URL, so it has to
 * be safe to sit inside a URL path — this charset excludes `/`, `?`, `#` and
 * `.`, which is everything that could redirect the path or bolt on a query.
 * That is the whole security property, and it's checked here rather than at the
 * two render sites so a third one can't reintroduce the gap.
 *
 * Deliberately not `{11}`, though every id YouTube has ever issued is 11
 * characters: pinning the length would buy no extra safety and would silently
 * drop the trailer for anything unusual, with no error and nothing logged.
 */
const YOUTUBE_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Picks the single best trailer out of a TMDB videos response.
 *
 * Only YouTube is handled: it's the overwhelming majority of what TMDB returns,
 * and every other site would need its own embed handling for a rare case.
 */
function pickBestTrailer(data: RawVideosResponse): TmdbVideo | null {
  const candidates = (data.results ?? []).filter(
    (video) => video.site === "YouTube" && YOUTUBE_KEY.test(video.key),
  );

  if (candidates.length === 0) return null;

  // Prefer an official trailer, then any trailer, then a teaser. Anything else
  // — featurettes, recaps, opening credits, behind-the-scenes — is rejected
  // outright: season video lists are mostly those, and a "Trailer" button that
  // opens a recap is worse than no button.
  const rank = (video: (typeof candidates)[number]) => {
    if (video.type === "Trailer") return video.official ? 0 : 1;
    if (video.type === "Teaser") return video.official ? 2 : 3;
    return 99;
  };

  const best = [...candidates]
    .map((video) => ({ video, score: rank(video) }))
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score)[0];

  if (!best) return null;

  return { key: best.video.key, name: best.video.name, type: best.video.type };
}

/** Trailers change rarely, so a day of caching keeps them off the hot path. */
const VIDEO_CACHE_SECONDS = 60 * 60 * 24;

export async function getShowTrailer(
  tmdbShowId: string | number,
): Promise<TmdbVideo | null> {
  return pickBestTrailer(
    await cached(`videos:${tmdbShowId}`, VIDEO_CACHE_SECONDS, () =>
      tmdbFetch<RawVideosResponse>(`/tv/${tmdbShowId}/videos`, {
        language: "en-US",
      }),
    ),
  );
}

export interface SeasonTrailer extends TmdbVideo {
  seasonNumber: number;
}

/**
 * Trailers for individual seasons, for the ones that have any.
 *
 * Coverage is patchy — plenty of seasons have no trailer at all, and some have
 * only featurettes — so this returns just the seasons that yielded something,
 * rather than an entry per season.
 *
 * Seasons are fetched in parallel because they're independent and cached for a
 * day; a long-running show would otherwise serialise eight round trips.
 */
export async function getSeasonTrailers(
  tmdbShowId: string | number,
  seasonNumbers: number[],
): Promise<SeasonTrailer[]> {
  const results = await Promise.all(
    seasonNumbers.map(async (seasonNumber) => {
      try {
        const data = await cached(
          `videos:${tmdbShowId}:${seasonNumber}`,
          VIDEO_CACHE_SECONDS,
          () =>
            tmdbFetch<RawVideosResponse>(
              `/tv/${tmdbShowId}/season/${seasonNumber}/videos`,
              { language: "en-US" },
            ),
        );

        const trailer = pickBestTrailer(data);
        return trailer ? { ...trailer, seasonNumber } : null;
      } catch {
        // One season failing shouldn't cost the whole page its trailers.
        return null;
      }
    }),
  );

  return results
    .filter((entry): entry is SeasonTrailer => entry !== null)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}
