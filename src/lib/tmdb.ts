import "server-only";

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
}

export interface TmdbEpisode {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  airDate: Date | null;
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

async function tmdbFetch<T>(
  path: string,
  params: Record<string, string> = {},
  /** Seconds to let Next.js cache the response. 0 disables caching. */
  revalidate = 0,
): Promise<T> {
  const { url, headers } = buildRequest(path, params);

  let response: Response;
  try {
    // Show data isn't cached here — it's cached in our own database instead
    // (see the Show/Episode models), which is the caching layer the design doc
    // calls for. `revalidate` is for the handful of endpoints that aren't
    // per-show, like the list of streaming regions.
    response = await fetch(url, {
      headers,
      ...(revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" }),
    });
  } catch (cause) {
    throw new TmdbError(`Could not reach TMDB: ${(cause as Error).message}`);
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

/** Parses TMDB's "YYYY-MM-DD" air dates, tolerating empty strings. */
function parseAirDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

export async function searchTvShows(
  query: string,
): Promise<TmdbSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const data = await tmdbFetch<RawSearchResponse>("/search/tv", {
    query: trimmed,
    include_adult: "false",
  });

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
}

export async function getShowDetails(
  tmdbShowId: string | number,
): Promise<TmdbShowDetails> {
  const data = await tmdbFetch<RawShowResponse>(`/tv/${tmdbShowId}`);

  return {
    id: data.id,
    name: data.name,
    posterPath: data.poster_path,
    overview: data.overview || null,
    // Season 0 is TMDB's "Specials" bucket; skip it, and skip empty seasons
    // that would just cost us a request for nothing.
    seasonNumbers: data.seasons
      .filter((season) => season.season_number > 0 && season.episode_count > 0)
      .map((season) => season.season_number),
  };
}

interface RawSeasonResponse {
  episodes: Array<{
    id: number;
    season_number: number;
    episode_number: number;
    name: string | null;
    air_date: string | null;
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
 * Where a show can be streamed, keyed by country code. TMDB returns every
 * country it has data for in one response, so a country switcher costs no
 * extra requests.
 */
export async function getWatchProviders(
  tmdbShowId: string | number,
): Promise<CountryAvailability[]> {
  const data = await tmdbFetch<RawProvidersResponse>(
    `/tv/${tmdbShowId}/watch/providers`,
  );

  return Object.entries(data.results ?? {})
    .map(([code, entry]) => ({
      code,
      link: entry.link ?? null,
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
  const data = await tmdbFetch<RawRegionsResponse>(
    "/watch/providers/regions",
    { language: "en-US" },
    60 * 60 * 24,
  );

  return (data.results ?? [])
    .map((region) => ({ code: region.iso_3166_1, name: region.english_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
