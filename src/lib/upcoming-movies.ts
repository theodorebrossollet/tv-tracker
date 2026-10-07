import "server-only";

import { describeError, logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  getMovieReleaseDates,
  type CountryReleases,
  type MovieRelease,
  type ReleaseKind,
} from "@/lib/tmdb";

/** How many movies are looked up per dashboard view. */
export const MAX_UPCOMING_MOVIES = 20;

/**
 * A movie whose stored release date is this far back or less can still be
 * waiting for its digital release, so it is worth a look.
 */
export const RECENT_RELEASE_DAYS = 120;

/**
 * How long the dashboard waits on TMDB for the movie dates before it gives up
 * on them for this render. The lookups keep running, so the cache is warm for
 * the next one.
 */
export const MOVIE_LOOKUP_TIMEOUT_MS = 2_500;

export interface UpcomingMovie {
  movieId: string;
  title: string;
  posterPath: string | null;
  /** The soonest date still ahead. */
  next: MovieRelease;
  /** The other kind of release, when it is also still ahead. */
  later: MovieRelease | null;
  /**
   * The country the dates are for when it is not the viewer's own (no entry
   * for their country, or none chosen); null when they are theirs.
   */
  region: string | null;
}

/**
 * The upcoming dates of one movie, for the viewer's country.
 *
 * The country's own entry wins whenever it has anything still ahead. Without
 * one, the earliest date of each kind anywhere is used and tagged with the
 * country it comes from, so "Digital 9 Jan · US" is never mistaken for a local
 * date. Per kind, only the earliest date ahead counts; at most two come back,
 * soonest first. Null when nothing is ahead.
 */
export function nextReleases(
  countries: CountryReleases[],
  home: string | null,
  now: Date,
): { next: MovieRelease; later: MovieRelease | null; region: string | null } | null {
  const ahead = (entry: CountryReleases) =>
    entry.releases.filter((release) => release.date.getTime() > now.getTime());

  const own = home ? countries.find((entry) => entry.code === home) : undefined;
  const ownAhead = own ? ahead(own) : [];

  let pool: Array<MovieRelease & { code: string }>;
  if (ownAhead.length > 0) {
    pool = ownAhead.map((release) => ({ ...release, code: own!.code }));
  } else {
    pool = countries.flatMap((entry) =>
      ahead(entry).map((release) => ({ ...release, code: entry.code })),
    );
  }
  if (pool.length === 0) return null;

  const earliest = new Map<ReleaseKind, MovieRelease & { code: string }>();
  for (const release of pool) {
    const seen = earliest.get(release.kind);
    if (
      !seen ||
      release.date.getTime() < seen.date.getTime() ||
      (release.date.getTime() === seen.date.getTime() &&
        release.code < seen.code)
    ) {
      earliest.set(release.kind, release);
    }
  }

  const [first, second] = [...earliest.values()].sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      // Cinema before digital on the same day, so the order is stable.
      (a.kind === "cinema" ? -1 : 1) - (b.kind === "cinema" ? -1 : 1),
  );

  const region = first.code === home ? null : first.code;
  return {
    next: { kind: first.kind, date: first.date },
    later: second ? { kind: second.kind, date: second.date } : null,
    region,
  };
}

interface Candidate {
  movieId: string;
  title: string;
  posterPath: string | null;
}

/**
 * The caller's watchlist movies worth checking for a date: not out yet, or out
 * recently enough to still be heading for streaming. Scoped to the caller; the
 * shared `Movie` row only supplies the title and the stored date.
 */
export async function getUpcomingMovieCandidates(
  userId: string,
  now: Date = new Date(),
): Promise<Candidate[]> {
  const since = new Date(now.getTime() - RECENT_RELEASE_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.trackedMovie.findMany({
    where: {
      userId,
      status: "watchlist",
      movie: {
        OR: [
          { releaseDate: { gte: since } },
          {
            releaseDate: null,
            status: { in: ["Planned", "In Production", "Post Production", "Rumored"] },
          },
        ],
      },
    },
    orderBy: [{ movie: { releaseDate: "asc" } }, { movieId: "asc" }],
    take: MAX_UPCOMING_MOVIES,
    select: {
      movie: { select: { id: true, title: true, posterPath: true } },
    },
  });

  return rows.map(({ movie }) => ({
    movieId: movie.id,
    title: movie.title,
    posterPath: movie.posterPath,
  }));
}

/**
 * Upcoming dates for the caller's watchlist movies, soonest first.
 *
 * Soft by design: it is a nicety on the home screen, so TMDB being down, slow
 * or partly failing returns whatever worked (or nothing) and logs, rather than
 * delaying or breaking the page.
 */
export async function getUpcomingMovies(
  userId: string,
  home: string | null,
  options: { now?: Date; timeoutMs?: number } = {},
): Promise<UpcomingMovie[]> {
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? MOVIE_LOOKUP_TIMEOUT_MS;

  let candidates: Candidate[];
  try {
    candidates = await getUpcomingMovieCandidates(userId, now);
  } catch (error) {
    logger.warn("upcoming.movies_unavailable", describeError(error));
    return [];
  }
  if (candidates.length === 0) return [];

  const lookups = Promise.allSettled(
    candidates.map((candidate) => getMovieReleaseDates(candidate.movieId)),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  const settled = await Promise.race([lookups, timeout]);
  clearTimeout(timer);

  if (!settled) {
    logger.warn("upcoming.movies_timeout", { timeoutMs });
    return [];
  }

  const movies: UpcomingMovie[] = [];
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn("upcoming.movie_dates_failed", describeError(result.reason));
      return;
    }

    const found = nextReleases(result.value, home, now);
    if (found) movies.push({ ...candidates[index], ...found });
  });

  return movies.sort(
    (a, b) =>
      a.next.date.getTime() - b.next.date.getTime() ||
      a.movieId.localeCompare(b.movieId),
  );
}
