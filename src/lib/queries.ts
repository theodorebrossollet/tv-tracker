import "server-only";

import { prisma } from "@/lib/prisma";
import { ensureShowCached } from "@/lib/shows";
import type { TrackStatus } from "@/lib/types";

export interface TrackedShowSummary {
  showId: string;
  name: string;
  posterPath: string | null;
  status: TrackStatus;
  /** Episodes that have already aired — the denominator for progress. */
  airedCount: number;
  watchedCount: number;
  /** Every aired episode watched. Drives the "hide finished shows" toggle. */
  fullyWatched: boolean;
  nextUnwatched: {
    seasonNumber: number;
    episodeNumber: number;
    name: string | null;
  } | null;
}

/**
 * Lists tracked shows with enough detail to render a card: poster, watch
 * progress, and the next episode to watch.
 */
export async function getTrackedShows(
  status: TrackStatus,
): Promise<TrackedShowSummary[]> {
  const now = new Date();

  const tracked = await prisma.trackedShow.findMany({
    where: { status },
    orderBy: { addedAt: "desc" },
    include: {
      show: {
        include: {
          episodes: {
            orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
            include: { watched: true },
          },
        },
      },
    },
  });

  return tracked.map((entry) => {
    // "Aired" excludes episodes with no air date at all — TMDB leaves the date
    // empty for episodes that are announced but unscheduled, and counting those
    // as available would make progress look permanently incomplete.
    const aired = entry.show.episodes.filter(
      (episode) => episode.airDate !== null && episode.airDate <= now,
    );
    const nextUnwatched = aired.find((episode) => episode.watched === null);
    const watchedCount = aired.filter(
      (episode) => episode.watched !== null,
    ).length;

    return {
      showId: entry.showId,
      name: entry.show.name,
      posterPath: entry.show.posterPath,
      status: entry.status as TrackStatus,
      airedCount: aired.length,
      watchedCount,
      fullyWatched: aired.length > 0 && watchedCount === aired.length,
      nextUnwatched: nextUnwatched
        ? {
            seasonNumber: nextUnwatched.seasonNumber,
            episodeNumber: nextUnwatched.episodeNumber,
            name: nextUnwatched.name,
          }
        : null,
    };
  });
}

export interface UpcomingEpisode {
  episodeId: string;
  showId: string;
  showName: string;
  posterPath: string | null;
  status: TrackStatus;
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  airDate: Date;
}

/**
 * Episodes airing in the future for any tracked show, soonest first — both the
 * ones being watched and the ones still on the watchlist, so a show you haven't
 * started yet still tells you when its next episode lands.
 */
export async function getUpcomingEpisodes(
  limit = 50,
): Promise<UpcomingEpisode[]> {
  const episodes = await prisma.episode.findMany({
    where: {
      airDate: { gt: new Date() },
      show: { tracked: { isNot: null } },
    },
    orderBy: { airDate: "asc" },
    take: limit,
    include: { show: { include: { tracked: true } } },
  });

  return episodes.map((episode) => ({
    episodeId: episode.id,
    showId: episode.showId,
    showName: episode.show.name,
    posterPath: episode.show.posterPath,
    // Safe: the query only returns episodes whose show is tracked.
    status: episode.show.tracked!.status as TrackStatus,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    name: episode.name,
    // Safe: the query filters to episodes with an air date.
    airDate: episode.airDate as Date,
  }));
}

/**
 * Full detail for one show, with episodes grouped into seasons.
 *
 * Falls back to fetching from TMDB when the show isn't in the local cache yet,
 * so search results can link straight through to a show page before it has been
 * added to any list. Returns null only when TMDB doesn't know the id either.
 */
export async function getShowDetail(showId: string) {
  // Runs first so it can also refresh a cached-but-stale show, not just fetch
  // a missing one.
  const cached = await ensureShowCached(showId);
  if (!cached) return null;

  const show = await loadShow(showId);
  if (!show) return null;

  const seasons = new Map<number, typeof show.episodes>();
  for (const episode of show.episodes) {
    const bucket = seasons.get(episode.seasonNumber);
    if (bucket) {
      bucket.push(episode);
    } else {
      seasons.set(episode.seasonNumber, [episode]);
    }
  }

  return {
    id: show.id,
    name: show.name,
    posterPath: show.posterPath,
    overview: show.overview,
    lastSynced: show.lastSynced,
    status: (show.tracked?.status ?? null) as TrackStatus | null,
    seasons: [...seasons.entries()]
      .sort(([a], [b]) => a - b)
      .map(([seasonNumber, episodes]) => ({ seasonNumber, episodes })),
  };
}

function loadShow(showId: string) {
  return prisma.show.findUnique({
    where: { id: showId },
    include: {
      tracked: true,
      episodes: {
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
        include: { watched: true },
      },
    },
  });
}

