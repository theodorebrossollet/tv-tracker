import "server-only";

import { cache } from "react";

import { Prisma } from "@/generated/prisma/client";
import { hasSeriesEnded } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { ensureShowCached } from "@/lib/shows";
import type { TrackStatus } from "@/lib/types";

// Every function here takes a userId, and every read through `Show.tracked` or
// `Episode.watched` filters by it. Those two relations are lists now — one
// entry per user — so an unfiltered read silently returns other people's rows
// rather than failing. See docs/technical-design-v2.md section 5.
//
// Two of the reads below are raw SQL, which makes that rule manual rather than
// merely easy to forget: there is no `where: { userId }` to leave out, only a
// join condition to get wrong. Both carry `userId` as a bound parameter and
// `tests/isolation.test.ts` covers them. Read the note above
// `loadShowProgress` for why they aren't Prisma queries.
//
// **Dates bind as `Date`, never as epoch milliseconds.** `DateTime` columns are
// stored as ISO-8601 *text*, so `airDate <= ${Date.now()}` compares text to an
// integer, matches nothing at all, and reports every show as having nothing
// aired — with no error. A bound `Date` is serialised to the same format the
// column holds; verified exact at ±1ms either side of a boundary, against
// Prisma's own typed `lte` as the reference.

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
    /**
     * Carried so the dashboard can mark this episode watched in place —
     * `markEpisodeWatched` is keyed by episode id, and without it the row
     * could only link to the show page.
     */
    id: string;
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

  // Just the tracked rows and the show columns a card renders. No episodes:
  // everything derived from them is computed by the database below.
  const tracked = await prisma.trackedShow.findMany({
    where: status ? { userId, status } : { userId },
    orderBy: { addedAt: "desc" },
    select: {
      showId: true,
      status: true,
      addedAt: true,
      show: { select: { name: true, posterPath: true, status: true } },
    },
  });

  if (tracked.length === 0) return [];

  const showIds = tracked.map((entry) => entry.showId);

  // Independent, and neither reads the other's rows.
  const [progress, nextUp] = await Promise.all([
    loadShowProgress(userId, showIds, now),
    loadNextUnwatched(userId, showIds, now),
  ]);

  const summaries = tracked.map((entry) => {
    // A show with no episode rows at all produces no group, so it has no entry
    // here — tracked-but-not-yet-synced is a real state, and it has to render
    // as zero rather than as undefined.
    const counts = progress.get(entry.showId);
    const airedCount = counts?.airedCount ?? 0;
    const watchedCount = counts?.watchedCount ?? 0;

    return {
      showId: entry.showId,
      name: entry.show.name,
      posterPath: entry.show.posterPath,
      status: entry.status as TrackStatus,
      airedCount,
      watchedCount,
      fullyWatched: airedCount > 0 && watchedCount === airedCount,
      showStatus: entry.show.status,
      lastWatchedAt: counts?.lastWatchedAt ?? null,
      addedAt: entry.addedAt,
      nextUnwatched: nextUp.get(entry.showId) ?? null,
    };
  });

  return sortByActionability(summaries);
}

interface ShowProgress {
  airedCount: number;
  watchedCount: number;
  lastWatchedAt: Date | null;
}

/**
 * Per-show progress, computed by the database.
 *
 * This used to be a Node loop over every episode of every tracked show, which
 * is what made the payload grow with shows × episodes on every dashboard,
 * watchlist and archive render. Measured on a local file: 75ms → 13ms at 40
 * shows × 120 episodes, 358ms → 44ms at 80 × 250. Production is Turso over the
 * network, where the old shape also has to ship every one of those rows.
 *
 * The round-trip count is the other half. Prisma chunks a nested relation read
 * at 999 bind variables per statement, so the old shape cost
 * `1 + ceil(episodes / 999)` queries — six for a 4,800-episode library, 44 for
 * a 40,000-episode one. This is three, whatever the library holds.
 *
 * (`docs/roadmap.md` used to claim the old read would eventually *throw*, on
 * SQLite's 32,766 bind-variable cap. It would not, and that chunking is why —
 * measured, after the claim was inherited and repeated. The cap is real; this
 * read never reached it.)
 *
 * Raw SQL because neither of the two values that need a join can be expressed
 * in Prisma's `groupBy`: it cannot group by a relation's column, which rules out
 * `MAX(watchedAt)` keyed by `showId`. Splitting the counts into typed `groupBy`
 * calls and leaving only this one raw would mean three round trips computing
 * one row per show each, to avoid writing the join once.
 *
 * Three things this has to preserve, each of which the old loop did and none of
 * which is obvious from the shape:
 *
 *   - "Aired" excludes episodes with no air date at all. TMDB leaves the date
 *     empty for announced-but-unscheduled episodes, and counting them would
 *     make progress permanently short of complete.
 *   - `watchedCount` counts only *aired* episodes that are watched. A watch mark
 *     on an unaired episode is reachable (`markEpisodeWatched` takes an id and
 *     actions are POST-able), and counting it would report 2/1 watched.
 *   - `lastWatchedAt` counts *every* watch mark, aired or not. It answers "when
 *     did you last touch this show", which is a different question from
 *     progress — the old loop read the marks before the aired check for exactly
 *     this reason.
 */
async function loadShowProgress(
  userId: string,
  showIds: string[],
  now: Date,
): Promise<Map<string, ShowProgress>> {
  const rows = await prisma.$queryRaw<
    Array<{
      showId: string;
      airedCount: number;
      watchedCount: number;
      // MAX() erases the column's type, so unlike a plain `airDate` select the
      // driver hands this back as a string rather than a Date.
      lastWatchedAt: string | null;
    }>
  >`
    SELECT
      e."showId" AS "showId",
      SUM(CASE WHEN e."airDate" IS NOT NULL AND e."airDate" <= ${now}
               THEN 1 ELSE 0 END) AS "airedCount",
      SUM(CASE WHEN e."airDate" IS NOT NULL AND e."airDate" <= ${now}
                AND w."id" IS NOT NULL
               THEN 1 ELSE 0 END) AS "watchedCount",
      MAX(w."watchedAt") AS "lastWatchedAt"
    FROM "Episode" e
    LEFT JOIN "WatchedEpisode" w
      ON w."episodeId" = e."id"
     AND w."userId" = ${userId}
    WHERE e."showId" IN (${Prisma.join(showIds)})
    GROUP BY e."showId"
  `;

  return new Map(
    rows.map((row) => [
      row.showId,
      {
        airedCount: Number(row.airedCount),
        watchedCount: Number(row.watchedCount),
        lastWatchedAt: row.lastWatchedAt ? new Date(row.lastWatchedAt) : null,
      },
    ]),
  );
}

/**
 * The next episode to watch for each show: the first aired, unwatched one in
 * season-then-episode order.
 *
 * `ROW_NUMBER()` rather than one query per show — the point of this change is
 * that cost stops scaling with the library. Ordering is explicit here because
 * it is the whole answer: "next up" is a position in a sequence, and insertion
 * order is not that sequence.
 */
async function loadNextUnwatched(
  userId: string,
  showIds: string[],
  now: Date,
): Promise<Map<string, TrackedShowSummary["nextUnwatched"]>> {
  const rows = await prisma.$queryRaw<
    Array<{
      showId: string;
      id: string;
      seasonNumber: number;
      episodeNumber: number;
      name: string | null;
    }>
  >`
    SELECT "showId", "id", "seasonNumber", "episodeNumber", "name"
    FROM (
      SELECT
        e."showId" AS "showId",
        e."id" AS "id",
        e."seasonNumber" AS "seasonNumber",
        e."episodeNumber" AS "episodeNumber",
        e."name" AS "name",
        ROW_NUMBER() OVER (
          PARTITION BY e."showId"
          ORDER BY e."seasonNumber" ASC, e."episodeNumber" ASC
        ) AS rn
      FROM "Episode" e
      LEFT JOIN "WatchedEpisode" w
        ON w."episodeId" = e."id"
       AND w."userId" = ${userId}
      WHERE e."showId" IN (${Prisma.join(showIds)})
        AND e."airDate" IS NOT NULL
        AND e."airDate" <= ${now}
        AND w."id" IS NULL
    )
    WHERE rn = 1
  `;

  return new Map(
    rows.map((row) => [
      row.showId,
      {
        id: row.id,
        seasonNumber: Number(row.seasonNumber),
        episodeNumber: Number(row.episodeNumber),
        name: row.name,
      },
    ]),
  );
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
  /**
   * Every aired episode watched, but the series is still running — so this one
   * comes back to Watching on its own when the next episode airs. Derived, not
   * a stored status.
   */
  caughtUp: TrackedShowSummary[];
  /**
   * Every aired episode watched and TMDB says the series is over. Also derived
   * — a show does leave this bucket if TMDB revives it and a new episode airs.
   */
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
 *   stopped → caught up / finished → paused → watchlist → watching
 *
 * "Stopped" wins over "finished" because abandoning a show is a decision you
 * made, while finishing it is merely a fact about episode counts — and if you
 * stopped watching something you'd happened to complete, the decision is the
 * more useful label.
 *
 * Fully watched splits in two on TMDB's lifecycle, because the two mean
 * opposite things to the reader: a finished series is over and a caught-up one
 * is coming back. They shared a section for a while and it made the Archive
 * read as final when half of it wasn't.
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
    caughtUp: [],
    finished: [],
    stopped: [],
  };

  for (const show of all) {
    if (show.status === "stopped") buckets.stopped.push(show);
    else if (show.fullyWatched) {
      if (hasSeriesEnded(show.showStatus)) buckets.finished.push(show);
      else buckets.caughtUp.push(show);
    } else if (show.status === "paused") buckets.paused.push(show);
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
    // Field by field, for the same reason `getTrackedShows` above does it: an
    // `include` here dragged every column of each episode's show — `overview`
    // is 500-1500 bytes on its own, plus genres, network and dates — over the
    // wire for up to `limit` rows, to read three values off them.
    select: {
      id: true,
      showId: true,
      seasonNumber: true,
      episodeNumber: true,
      name: true,
      airDate: true,
      show: {
        select: {
          name: true,
          posterPath: true,
          // Filtered again here. The `where` above decides which episodes come
          // back; this decides which tracked rows are attached to them.
          tracked: { where: { userId }, select: { status: true } },
        },
      },
    },
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
 * Whether an episode is available to watch.
 *
 * The one definition. "Aired" excludes episodes with no air date at all — TMDB
 * leaves the date empty for announced-but-unscheduled episodes, and counting
 * those as available would leave progress permanently short of complete.
 *
 * The list queries express the same rule in SQL, because they have to; that is
 * the one place this exists twice, and `tests/queries.test.ts` asserts the two
 * agree rather than trusting them to. Nothing above this layer should be
 * writing the comparison a third time.
 */
function isAired(airDate: Date | null, now: Date): boolean {
  return airDate !== null && airDate <= now;
}

/** Every aired episode watched. Derived, never stored — see AGENTS.md. */
function isFinished(airedCount: number, watchedCount: number): boolean {
  return airedCount > 0 && watchedCount === airedCount;
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
 *
 * Returns the progress counts as well as the episodes. The show page used to
 * derive them itself, which meant "aired" and "finished" had two independent
 * implementations — one here for the lists, one there for the detail view — and
 * `StatusMenu` was handed `finished` from whichever happened to be nearer. They
 * agreed, but nothing made them: drift would have shown a "Finished" pill on a
 * show the Library filed under Watching, with no error anywhere.
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

  // One clock reading for the whole derivation, so two episodes either side of
  // "now" can't be judged against different instants.
  const now = new Date();

  // `watched` is resolved to a boolean here rather than handed to the page as
  // a relation. It is a *list* now — one row per user — so `!== null` is true
  // for every episode, including unwatched ones, and TypeScript is happy to
  // compare an array to null. That shipped: every episode on the show page
  // rendered as watched, for everyone. Collapsing it at the query boundary
  // means callers cannot make that mistake again.
  //
  // `aired` is resolved here for the same reason: it is a rule, and a rule the
  // caller re-implements is a rule that can disagree.
  const episodes = show.episodes.map(({ watched, ...episode }) => ({
    ...episode,
    watched: watched.length > 0,
    aired: isAired(episode.airDate, now),
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

  let airedCount = 0;
  let watchedCount = 0;

  const seasonSummaries = [...seasons.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seasonNumber, episodes]) => {
      const aired = episodes.filter((episode) => episode.aired);
      const watched = aired.filter((episode) => episode.watched);

      airedCount += aired.length;
      watchedCount += watched.length;

      return {
        seasonNumber,
        episodes,
        airedCount: aired.length,
        watchedCount: watched.length,
        /** Every aired episode of *this* season watched. */
        allWatched: isFinished(aired.length, watched.length),
      };
    });

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
    airedCount,
    watchedCount,
    finished: isFinished(airedCount, watchedCount),
    seasons: seasonSummaries,
  };
});

function loadShow(userId: string, showId: string) {
  return prisma.show.findUnique({
    where: { id: showId },
    include: {
      tracked: { where: { userId } },
      episodes: {
        orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
        // Only the id: the caller collapses these rows to `watched.length > 0`
        // immediately, so `watchedAt` and the foreign keys were being fetched
        // for every episode of the show to produce a boolean.
        include: { watched: { where: { userId }, select: { id: true } } },
      },
    },
  });
}

