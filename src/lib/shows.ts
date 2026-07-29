import "server-only";

import { prisma } from "@/lib/prisma";
import { getAllEpisodes, getShowDetails, TmdbError } from "@/lib/tmdb";

/**
 * Pulls a show and all of its episodes from TMDB and writes them into the
 * local cache, replacing whatever we had before.
 *
 * Shared by `addToWatchlist` (first fetch) and the refresh cron (later syncs), so
 * air-date corrections and newly announced episodes both land the same way.
 */
export async function syncShowFromTmdb(tmdbShowId: string) {
  const details = await getShowDetails(tmdbShowId);
  const episodes = await getAllEpisodes(tmdbShowId, details.seasonNumbers);

  await prisma.show.upsert({
    where: { id: tmdbShowId },
    create: {
      id: tmdbShowId,
      name: details.name,
      posterPath: details.posterPath,
      overview: details.overview,
    },
    update: {
      name: details.name,
      posterPath: details.posterPath,
      overview: details.overview,
      lastSynced: new Date(),
    },
  });

  // Upsert rather than delete-and-recreate: episode rows are referenced by
  // WatchedEpisode, so recreating them would wipe the user's watch history.
  for (const episode of episodes) {
    const id = String(episode.id);

    await prisma.episode.upsert({
      where: { id },
      create: {
        id,
        showId: tmdbShowId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        airDate: episode.airDate,
      },
      update: {
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        airDate: episode.airDate,
      },
    });
  }

  return { name: details.name, episodeCount: episodes.length };
}

/**
 * Makes sure a show exists in the local cache, fetching it from TMDB the first
 * time. Used when opening a show page for something that isn't tracked yet.
 *
 * Caching here rather than only on "add" means browsing a search result costs
 * one round of TMDB requests once, and is instant afterwards. Note this writes
 * on a page view; it's deliberately limited to the Show/Episode cache, which
 * carries no personal data and is never cleared by `clearAllData`.
 *
 * Returns false when TMDB doesn't recognise the id.
 */
export async function ensureShowCached(tmdbShowId: string): Promise<boolean> {
  const existing = await prisma.show.findUnique({
    where: { id: tmdbShowId },
    select: { id: true },
  });

  if (existing) return true;

  try {
    await syncShowFromTmdb(tmdbShowId);
    return true;
  } catch (error) {
    // A 404 means the id isn't a real show — the caller renders not-found.
    if (error instanceof TmdbError && error.status === 404) return false;
    throw error;
  }
}

/** Reads the single settings row, creating it on first access. */
export async function getSettings() {
  return prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}
