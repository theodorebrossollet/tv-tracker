import "server-only";

import { after } from "next/server";

import { describeError, logger } from "@/lib/logger";
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
      firstAirDate: details.firstAirDate,
      lastAirDate: details.lastAirDate,
      status: details.status,
      network: details.network,
      genres: details.genres,
    },
    update: {
      name: details.name,
      posterPath: details.posterPath,
      overview: details.overview,
      firstAirDate: details.firstAirDate,
      lastAirDate: details.lastAirDate,
      status: details.status,
      network: details.network,
      genres: details.genres,
      lastSynced: new Date(),
    },
  });

  // Written as read-diff-write rather than an upsert per episode: the cron
  // syncs every tracked show, and a 300-episode show was 300 sequential Turso
  // round trips on every run. That is most of the ~1.1s/show that puts the 60s
  // timeout near 50 shows (docs/technical-design.md), so this is the headroom
  // fix, not the TMDB fetching.
  //
  // Still never delete-and-recreate: episode rows are referenced by
  // WatchedEpisode, so recreating them would wipe the user's watch history.
  const existing = await prisma.episode.findMany({
    where: { showId: tmdbShowId },
    select: {
      id: true,
      seasonNumber: true,
      episodeNumber: true,
      name: true,
      airDate: true,
      runtime: true,
      overview: true,
    },
  });

  const byId = new Map(existing.map((row) => [row.id, row]));

  // Keyed by id rather than a plain array: `createMany` has no
  // `skipDuplicates` on SQLite, so one repeated id in a TMDB payload would
  // abort the entire insert.
  const toCreate = new Map<
    string,
    EpisodeFields & { id: string; showId: string }
  >();
  const toUpdate: Array<{ id: string; fields: EpisodeFields }> = [];
  const fetchedIds = new Set<string>();

  for (const episode of episodes) {
    const id = String(episode.id);
    fetchedIds.add(id);
    const fields: EpisodeFields = {
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      name: episode.name,
      airDate: episode.airDate,
      runtime: episode.runtime,
      overview: episode.overview,
    };

    const current = byId.get(id);

    if (!current) {
      toCreate.set(id, { id, showId: tmdbShowId, ...fields });
    } else if (differs(current, fields)) {
      toUpdate.push({ id, fields });
    }
  }

  // Chunked because SQLite caps bind variables per statement, and TMDB's
  // daytime soaps run past 10,000 episodes — at 8 parameters a row, one
  // unchunked createMany for General Hospital is a hard error, found only on
  // the day someone tracks a soap.
  for (const batch of chunk([...toCreate.values()], WRITE_BATCH_SIZE)) {
    await prisma.episode.createMany({ data: batch });
  }

  // One transaction per batch. Episodes TMDB didn't change are skipped
  // outright, so re-syncing a settled show writes nothing at all — which is
  // the common case for a nightly run.
  for (const batch of chunk(toUpdate, WRITE_BATCH_SIZE)) {
    await prisma.$transaction(
      batch.map(({ id, fields }) =>
        prisma.episode.update({ where: { id }, data: fields }),
      ),
    );
  }

  // Episodes TMDB has dropped — it does this after schedule reshuffles — would
  // otherwise linger forever, inflating the aired count that "finished" is
  // derived from, so a show could never read as complete again.
  //
  // Watched ones are kept regardless: a row the user marked is a record of
  // something they did, and silently deleting it would rewrite their history
  // to fix a count. A stale episode is the smaller wrong.
  //
  // "Watched" here means *by anybody*, not by a particular user — `none: {}`
  // rather than a userId filter. This runs from the cron with no session, and
  // deleting the episode would cascade away every user's watch row for it, so
  // one person's history is enough to keep it.
  const removedIds = existing
    .filter((row) => !fetchedIds.has(row.id))
    .map((row) => row.id);

  if (removedIds.length > 0) {
    let deleted = 0;
    for (const batch of chunk(removedIds, WRITE_BATCH_SIZE)) {
      const { count } = await prisma.episode.deleteMany({
        where: { id: { in: batch }, watched: { none: {} } },
      });
      deleted += count;
    }

    if (deleted > 0) {
      logger.info("show.episodes_removed_upstream", {
        showId: tmdbShowId,
        deleted,
        keptBecauseWatched: removedIds.length - deleted,
      });
    }
  }

  return { name: details.name, episodeCount: episodes.length };
}

/**
 * Rows per statement. SQLite's default bind-variable cap is 32766; at 8
 * parameters per episode row, 500 leaves an order of magnitude of headroom
 * while keeping a 16,000-episode soap to ~32 statements.
 */
const WRITE_BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** The episode fields TMDB owns — everything a re-sync could change. */
interface EpisodeFields {
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  airDate: Date | null;
  runtime: number | null;
  overview: string | null;
}

function differs(current: EpisodeFields, next: EpisodeFields): boolean {
  return (
    current.seasonNumber !== next.seasonNumber ||
    current.episodeNumber !== next.episodeNumber ||
    current.name !== next.name ||
    current.runtime !== next.runtime ||
    current.overview !== next.overview ||
    // Dates are objects: compare the instant, and allow either side to be null.
    (current.airDate?.getTime() ?? null) !== (next.airDate?.getTime() ?? null)
  );
}

/** How long a cached-but-untracked show may go without a re-sync. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Background refreshes currently running, keyed by show id.
 *
 * `lastSynced` only moves once a sync *finishes*, so every view between
 * scheduling one and it landing sees the same stale row and would schedule its
 * own. Blocking used to bound that by itself — the visitor waited, so there was
 * no second view to collide with. Returning the stale copy immediately removes
 * that wait, and two concurrent syncs of one show don't merely duplicate the
 * TMDB fetches: they compute the same `createMany` batch from the same
 * pre-state and the second one fails on the primary key.
 *
 * Per-process, like the TMDB response cache in `lib/tmdb.ts` — another instance
 * has its own map. That still covers what this is for: one visitor on one
 * instance opening a show a few times in a row.
 */
const inFlightRefreshes = new Map<string, Promise<unknown>>();

function refreshInBackground(tmdbShowId: string): Promise<unknown> {
  const running = inFlightRefreshes.get(tmdbShowId);
  if (running) return running;

  const refresh = syncShowFromTmdb(tmdbShowId)
    .catch((error) => {
      // The stale copy has already gone out, so there is no request left to
      // fail. Record it and let the next view try again.
      logger.warn("show.refresh_failed_serving_stale", {
        showId: tmdbShowId,
        ...describeError(error),
      });
    })
    .finally(() => {
      inFlightRefreshes.delete(tmdbShowId);
    });

  inFlightRefreshes.set(tmdbShowId, refresh);
  return refresh;
}

/**
 * Makes sure a show is in the local cache and reasonably fresh, fetching from
 * TMDB when it's missing or stale. Used when opening a show page.
 *
 * Caching here rather than only on "add" means browsing a search result costs
 * one round of TMDB requests once, and is instant afterwards. Note this writes
 * on a page view; it's deliberately limited to the Show/Episode cache, which
 * carries no personal data and is never cleared by `clearAllData`.
 *
 * The staleness check matters because the refresh cron only visits *tracked*
 * shows. Without it, a show cached from a search result would keep its
 * first-seen episode data forever — wrong air dates, and missing any field
 * added to the schema after it was cached.
 *
 * A stale show is served from the cache and refreshed *after* the response,
 * because the refresh is a full re-sync — every season fetched from TMDB in
 * sequence, seconds of it for a long-running show — and the visitor is only
 * ever looking at data that is at most a day old. Blocking on it would put that
 * wait in front of the page ahead of the show page's own TMDB calls. The only
 * request that still waits is one for a show we hold nothing for, where there
 * is nothing to serve.
 *
 * Returns false when TMDB doesn't recognise the id.
 */
export async function ensureShowCached(tmdbShowId: string): Promise<boolean> {
  const existing = await prisma.show.findUnique({
    where: { id: tmdbShowId },
    select: { lastSynced: true, tracked: { select: { id: true } } },
  });

  if (existing) {
    // Tracked shows are the cron's job; don't duplicate that work on page view.
    // `tracked` is a list, so this has to ask about its length — an empty array
    // is truthy, and testing the array itself made every cached show look
    // tracked and the staleness check below unreachable.
    if (existing.tracked.length > 0) return true;

    const age = Date.now() - existing.lastSynced.getTime();
    if (age < STALE_AFTER_MS) return true;

    // `after` runs the callback once the response is sent. It must not touch
    // request-time APIs (`cookies`, `headers`) from a Server Component, which
    // is why the callback is only Prisma and TMDB. Every caller of this
    // function reaches it through the show page or its `generateMetadata`, so
    // there is always a request scope — `after` throws without one.
    after(() => refreshInBackground(tmdbShowId));
    return true;
  }

  try {
    await syncShowFromTmdb(tmdbShowId);
    return true;
  } catch (error) {
    // A 404 means the id isn't a real show — the caller renders not-found.
    if (error instanceof TmdbError && error.status === 404) return false;

    // Nothing cached to fall back on — this path is only reached when the show
    // is absent entirely, so a failure here has no stale copy to serve.
    throw error;
  }
}

/**
 * Reads a user's settings, falling back to the defaults when they have none.
 *
 * A read, not an upsert. This runs on every show-page render, and an upsert is
 * a write statement — it can't be served by a replica and goes to the Turso
 * primary every time, to create a row of defaults that reading them would have
 * given anyway. The two actions that actually change a setting
 * (`updateNotificationPrefs`, `updateCountry`) upsert on their own, so the row
 * still appears the moment anything about it is worth persisting.
 */
export async function getSettings(userId: string) {
  const settings = await prisma.settings.findUnique({ where: { userId } });

  return settings ?? { userId, notifyEnabled: false, country: null };
}
