import "server-only";

import { prisma } from "@/lib/prisma";
import { getAllEpisodes, getShowDetails } from "@/lib/tmdb";

/**
 * Pulls a show and all of its episodes from TMDB and writes them into the
 * local cache, replacing whatever we had before.
 *
 * Shared by `trackShow` (first fetch) and the refresh cron (later syncs), so
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

/** Reads the single settings row, creating it on first access. */
export async function getSettings() {
  return prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}
