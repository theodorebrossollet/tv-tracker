import "server-only";

import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { ensureShowCached } from "@/lib/shows";
import type { TrackStatus } from "@/lib/types";

// Every function here takes a userId, and every read through `Show.tracked` or
// `Episode.watched` filters by it. Those two relations are lists now — one
// entry per user — so an unfiltered read silently returns other people's rows
// rather than failing. See docs/technical-design-v2.md section 5.

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
  /** TMDB lifecycle, so "caught up" can be told apart from "series over". */
  showStatus: string | null;
  /** Most recent watch on this show, for ordering. Null if never watched. */
  lastWatchedAt: Date | null;
  /** Fallback ordering key for shows with no watch history yet. */
  addedAt: Date;
  nextUnwatched: {
    seasonNumber: number;
    episodeNumber: number;
    name: string | null;
  } | null;
}

/**
 * Lists tracked shows with enough detail to render a card: poster, watch
 * progress, and the next episode to watch.
 *
 * Pass no status to get every tracked show — used by `getShowBuckets`, which
 * needs them all in order to apply precedence.
 */
export async function getTrackedShows(
  userId: string,
  status?: TrackStatus,
): Promise<TrackedShowSummary[]> {
  const now = new Date();

  // Selected field by field rather than `include`d: this runs on the home,
  // watchlist and archive pages via getShowBuckets, and it reads every episode
  // of every tracked show. Pulling whole rows meant shipping each episode's
  // `overview` and `runtime` over Turso's network protocol to compute counts
  // and find one episode name — the payload grew with shows × episodes for
  // data nothing below ever reads.
  const tracked = await prisma.trackedShow.findMany({
    where: status ? { userId, status } : { userId },
    orderBy: { addedAt: "desc" },
    select: {
      showId: true,
      status: true,
      addedAt: true,
      show: {
        select: {
          name: true,
          posterPath: true,
          status: true,
          episodes: {
            orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
            select: {
              seasonNumber: true,
              episodeNumber: true,
              name: true,
              airDate: true,
              // Scoped to the caller. Without this `where` the list carries
              // every user's watch marks for the episode, and each count below
              // would silently include them.
              watched: { where: { userId }, select: { watchedAt: true } },
            },
          },
        },
      },
    },
  });

  const summaries = tracked.map((entry) => {
    // "Aired" excludes episodes with no air date at all — TMDB leaves the date
    // empty for episodes that are announced but unscheduled, and counting those
    // as available would make progress look permanently incomplete.
    const aired = entry.show.episodes.filter(
      (episode) => episode.airDate !== null && episode.airDate <= now,
    );
    // `watched` is a list filtered to this user, so it holds at most one row —
    // but it is still a list, and `=== null` would be true for every episode.
    const nextUnwatched = aired.find((episode) => episode.watched.length === 0);
    const watchedCount = aired.filter(
      (episode) => episode.watched.length > 0,
    ).length;

    const watchedTimes = entry.show.episodes.flatMap((episode) =>
      episode.watched.map((mark) => mark.watchedAt),
    );

    return {
      showId: entry.showId,
      name: entry.show.name,
      posterPath: entry.show.posterPath,
      status: entry.status as TrackStatus,
      airedCount: aired.length,
      watchedCount,
      fullyWatched: aired.length > 0 && watchedCount === aired.length,
      showStatus: entry.show.status,
      lastWatchedAt: watchedTimes.length
        ? new Date(Math.max(...watchedTimes.map((at) => at.getTime())))
        : null,
      addedAt: entry.addedAt,
      nextUnwatched: nextUnwatched
        ? {
            seasonNumber: nextUnwatched.seasonNumber,
            episodeNumber: nextUnwatched.episodeNumber,
            name: nextUnwatched.name,
          }
        : null,
    };
  });

  return sortByActionability(summaries);
}

/**
 * Orders a list so the shows you could watch right now come first.
 *
 * Three bands: something unwatched and aired, then caught up but still
 * running, then finished. Add-order alone buried a show with three unwatched
 * episodes underneath one you finished months ago.
 *
 * Within a band, most recent activity first — a show watched last night is more
 * likely the one you want than one last touched in March. Shows never watched
 * fall back to when they were added.
 */
function sortByActionability<
  T extends {
    airedCount: number;
    watchedCount: number;
    fullyWatched: boolean;
    lastWatchedAt: Date | null;
    addedAt: Date;
  },
>(shows: T[]): T[] {
  const band = (show: T) => {
    if (show.fullyWatched) return 2;
    if (show.watchedCount < show.airedCount) return 0;
    // Caught up: nothing aired left, but the show isn't finished either
    // (nothing has aired yet, or the next episode is still upcoming).
    return 1;
  };

  return [...shows].sort((a, b) => {
    const byBand = band(a) - band(b);
    if (byBand !== 0) return byBand;

    const activity = (show: T) =>
      (show.lastWatchedAt ?? show.addedAt).getTime();

    return activity(b) - activity(a);
  });
}

export interface ShowBuckets {
  /** In progress: being watched, with something left to watch. */
  watching: TrackedShowSummary[];
  /** Never started. */
  watchlist: TrackedShowSummary[];
  /** Set aside, meaning to return. */
  paused: TrackedShowSummary[];
  /** Every aired episode watched. Derived, not a stored status. */
  finished: TrackedShowSummary[];
  /** Abandoned for good. */
  stopped: TrackedShowSummary[];
}

/**
 * Sorts every tracked show into exactly one bucket.
 *
 * Precedence matters because the categories overlap: a show can be both
 * fully watched and paused, or stopped *and* fully watched. Without a single
 * ordering it would appear twice, in two places that disagree about what it is.
 *
 *   stopped → finished → paused → watchlist → watching
 *
 * "Stopped" wins over "finished" because abandoning a show is a decision you
 * made, while finishing it is merely a fact about episode counts — and if you
 * stopped watching something you'd happened to complete, the decision is the
 * more useful label.
 *
 * One query for all of them: the pages each need a different slice, but the
 * per-show episode data is the expensive part and fetching it repeatedly to
 * answer four questions would be wasteful at any real number of shows.
 */
export async function getShowBuckets(userId: string): Promise<ShowBuckets> {
  const all = await getTrackedShows(userId);

  const buckets: ShowBuckets = {
    watching: [],
    watchlist: [],
    paused: [],
    finished: [],
    stopped: [],
  };

  for (const show of all) {
    if (show.status === "stopped") buckets.stopped.push(show);
    else if (show.fullyWatched) buckets.finished.push(show);
    else if (show.status === "paused") buckets.paused.push(show);
    else if (show.status === "watchlist") buckets.watchlist.push(show);
    else buckets.watching.push(show);
  }

  return buckets;
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
  userId: string,
  limit = 50,
): Promise<UpcomingEpisode[]> {
  const episodes = await prisma.episode.findMany({
    where: {
      airDate: { gt: new Date() },
      // `userId` inside `some` is load-bearing, and its absence is the sharpest
      // trap in this migration: `some: { status: {...} }` alone compiles, type
      // checks, and returns episodes for shows that *anyone* tracks — so the
      // home page would list episodes of a show only someone else follows.
      //
      // Set-aside shows are excluded: if you've paused or stopped a show, its
      // next episode isn't something you're waiting for.
      show: {
        tracked: {
          some: { userId, status: { in: ["watching", "watchlist"] } },
        },
      },
    },
    orderBy: { airDate: "asc" },
    take: limit,
    // Filtered again here. The `where` above decides which episodes come back;
    // this decides which tracked rows are attached to them.
    include: { show: { include: { tracked: { where: { userId } } } } },
  });

  return episodes.map((episode) => ({
    episodeId: episode.id,
    showId: episode.showId,
    showName: episode.show.name,
    posterPath: episode.show.posterPath,
    // Safe: the query only returns episodes whose show this user tracks, and
    // the include is filtered to that user's single row.
    status: episode.show.tracked[0].status as TrackStatus,
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
 *
 * Memoized per request with React's `cache`, because the show page calls this
 * from both `generateMetadata` and the component — two full show + episode
 * loads per view, and, for a stale or uncached show, two concurrent
 * `syncShowFromTmdb` runs racing each other through hundreds of upserts.
 * Next only deduplicates `fetch` on its own; everything else needs this.
 */
export const getShowDetail = cache(async function getShowDetail(
  userId: string,
  showId: string,
) {
  // Runs first so it can also refresh a cached-but-stale show, not just fetch
  // a missing one.
  const cached = await ensureShowCached(showId);
  if (!cached) return null;

  const show = await loadShow(userId, showId);
  if (!show) return null;

  // `watched` is resolved to a boolean here rather than handed to the page as
  // a relation. It is a *list* now — one row per user — so `!== null` is true
  // for every episode, including unwatched ones, and TypeScript is happy to
  // compare an array to null. That shipped: every episode on the show page
  // rendered as watched, for everyone. Collapsing it at the query boundary
  // means callers cannot make that mistake again.
  const episodes = show.episodes.map(({ watched, ...episode }) => ({
    ...episode,
    watched: watched.length > 0,
  }));

  const seasons = new Map<number, typeof episodes>();
  for (const episode of episodes) {
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
    status: (show.tracked[0]?.status ?? null) as TrackStatus | null,
    firstAirDate: show.firstAirDate,
    lastAirDate: show.lastAirDate,
    showStatus: show.status,
    network: show.network,
    genres: show.genres,
    seasons: [...seasons.entries()]
      .sort(([a], [b]) => a - b)
      .map(([seasonNumber, episodes]) => ({ seasonNumber, episodes })),
  };
});

function loadShow(userId: string, showId: string) {
  return prisma.show.findUnique({
    where: { id: showId },
    include: {
      tracked: { where: { userId } },
      episodes: {
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
        include: { watched: { where: { userId } } },
      },
    },
  });
}

