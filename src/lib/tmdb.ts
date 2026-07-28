import "server-only";

// Thin wrapper around the TMDB API. Only the endpoints listed in
// docs/technical-design.md section 5 are covered.
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
): Promise<T> {
  const { url, headers } = buildRequest(path, params);

  let response: Response;
  try {
    // No Next.js data cache here: show data is cached in our own database
    // instead (see the Show/Episode models), which is the caching layer the
    // design doc calls for.
    response = await fetch(url, { headers, cache: "no-store" });
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
