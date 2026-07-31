import "server-only";

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
  const removedIds = existing
    .filter((row) => !fetchedIds.has(row.id))
    .map((row) => row.id);

  if (removedIds.length > 0) {
    let deleted = 0;
    for (const batch of chunk(removedIds, WRITE_BATCH_SIZE)) {
      const { count } = await prisma.episode.deleteMany({
        where: { id: { in: batch }, watched: { is: null } },
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
 * Returns false when TMDB doesn't recognise the id.
 */
export async function ensureShowCached(tmdbShowId: string): Promise<boolean> {
  const existing = await prisma.show.findUnique({
    where: { id: tmdbShowId },
    select: { lastSynced: true, tracked: { select: { id: true } } },
  });

  if (existing) {
    // Tracked shows are the cron's job; don't duplicate that work on page view.
    if (existing.tracked) return true;

    const age = Date.now() - existing.lastSynced.getTime();
    if (age < STALE_AFTER_MS) return true;
  }

  try {
    await syncShowFromTmdb(tmdbShowId);
    return true;
  } catch (error) {
    // A 404 means the id isn't a real show — the caller renders not-found.
    if (error instanceof TmdbError && error.status === 404) return false;

    // A show we already have cached shouldn't 500 just because a refresh
    // failed — serve the stale copy instead.
    if (existing) {
      logger.warn("show.refresh_failed_serving_stale", {
        showId: tmdbShowId,
        ...describeError(error),
      });
      return true;
    }

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
