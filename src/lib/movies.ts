import "server-only";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getMovieDetails, TmdbError } from "@/lib/tmdb";

/**
 * Pulls a movie from TMDB and writes it into the local cache, replacing
 * whatever we had before.
 *
 * `getMovieDetails` does not validate its id, so callers must check
 * `isTmdbMovieId` first — an unchecked id would be interpolated into the TMDB
 * path.
 */
export async function syncMovieFromTmdb(
  tmdbMovieId: string,
  addedById?: string,
): Promise<{ title: string }> {
  const details = await getMovieDetails(tmdbMovieId);

  const fields = {
    title: details.title,
    posterPath: details.posterPath,
    overview: details.overview,
    releaseDate: details.releaseDate,
    runtime: details.runtime,
    status: details.status,
    genres: details.genres,
  };

  await prisma.movie.upsert({
    where: { id: tmdbMovieId },
    create: {
      id: tmdbMovieId,
      // Recorded once, on creation, and never touched by a later sync.
      addedById: addedById ?? null,
      createdAt: new Date(),
      ...fields,
    },
    update: { ...fields, lastSynced: new Date() },
  });

  return { title: details.title };
}

/**
 * How many movies one account may add to the cache per hour.
 *
 * Its own allowance, separate from `NEW_SHOWS_PER_HOUR`: a movie is a single
 * TMDB request and one row, far cheaper than a show's full sync, so it can be
 * much higher. Only `Movie` rows count. Movies already cached by anyone cost
 * nothing and never count.
 */
export const NEW_MOVIES_PER_HOUR = 60;

/** Thrown when an account has used up its allowance of new movies. */
export class NewMovieLimitError extends TmdbError {
  constructor() {
    super("You've added a lot of new movies. Please try again in a bit.", 429);
    this.name = "NewMovieLimitError";
  }
}

async function assertCanCacheNewMovie(userId: string): Promise<void> {
  const recent = await prisma.movie.count({
    where: {
      addedById: userId,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });

  if (recent >= NEW_MOVIES_PER_HOUR) {
    logger.warn("movie.new_movie_limit", { userId });
    throw new NewMovieLimitError();
  }
}

/**
 * Caches a movie that nothing holds yet, within the caller's hourly allowance.
 * For callers that already know the movie is absent.
 */
export async function cacheNewMovie(
  tmdbMovieId: string,
  userId: string,
): Promise<{ title: string }> {
  await assertCanCacheNewMovie(userId);
  return syncMovieFromTmdb(tmdbMovieId, userId);
}
