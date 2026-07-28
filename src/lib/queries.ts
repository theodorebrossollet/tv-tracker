import "server-only";

import { prisma } from "@/lib/prisma";
import type { TrackStatus } from "@/lib/types";

export interface TrackedShowSummary {
  showId: string;
  name: string;
  posterPath: string | null;
  status: TrackStatus;
  /** Episodes that have already aired — the denominator for progress. */
  airedCount: number;
  watchedCount: number;
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

    return {
      showId: entry.showId,
      name: entry.show.name,
      posterPath: entry.show.posterPath,
      status: entry.status as TrackStatus,
      airedCount: aired.length,
      watchedCount: aired.filter((episode) => episode.watched !== null).length,
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
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  airDate: Date;
}

/**
 * Episodes airing in the future for shows the user is watching, soonest first.
 * Watchlist shows are excluded — you haven't started them, so an upcoming
 * episode isn't actionable yet.
 */
export async function getUpcomingEpisodes(
  limit = 50,
): Promise<UpcomingEpisode[]> {
  const episodes = await prisma.episode.findMany({
    where: {
      airDate: { gt: new Date() },
      show: { tracked: { status: "watching" } },
    },
    orderBy: { airDate: "asc" },
    take: limit,
    include: { show: true },
  });

  return episodes.map((episode) => ({
    episodeId: episode.id,
    showId: episode.showId,
    showName: episode.show.name,
    posterPath: episode.show.posterPath,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    name: episode.name,
    // Safe: the query filters to episodes with an air date.
    airDate: episode.airDate as Date,
  }));
}

/** Full detail for one show, with episodes grouped into seasons. */
export async function getShowDetail(showId: string) {
  const show = await prisma.show.findUnique({
    where: { id: showId },
    include: {
      tracked: true,
      episodes: {
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
        include: { watched: true },
      },
    },
  });

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

/** Which TMDB ids are already tracked, so search can show current state. */
export async function getTrackedStatusMap(): Promise<Map<string, TrackStatus>> {
  const tracked = await prisma.trackedShow.findMany({
    select: { showId: true, status: true },
  });

  return new Map(
    tracked.map((entry) => [entry.showId, entry.status as TrackStatus]),
  );
}
