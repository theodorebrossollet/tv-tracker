"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { syncShowFromTmdb } from "@/lib/shows";
import { searchTvShows, TmdbError, type TmdbSearchResult } from "@/lib/tmdb";
import type { TrackStatus } from "@/lib/types";

// v1 has no accounts, so there is no session to check here — every action
// operates on the single implicit user's data. Phase 2 adds an auth check at
// the top of each of these. Note that server actions are reachable by direct
// POST, so this file is effectively public while the app is deployed without
// auth; keep the deployment private until Phase 2 lands.

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Turns an unexpected failure into a message safe to show the user. */
function toResult(error: unknown): ActionResult {
  if (error instanceof TmdbError) {
    return { ok: false, error: error.message };
  }

  console.error("Action failed:", error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Refreshes every route that can show a show's tracked state or progress. */
function revalidateShowViews(showId?: string) {
  revalidatePath("/");
  revalidatePath("/watchlist");
  if (showId) revalidatePath(`/show/${showId}`);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchSuggestion {
  id: string;
  name: string;
  posterPath: string | null;
  firstAirYear: string | null;
  status: TrackStatus | null;
}

/**
 * Backs the search overlay's as-you-type suggestions. Results aren't cached in
 * the database until a show is actually opened or added.
 */
export async function searchSuggestions(
  query: string,
): Promise<{ results?: SearchSuggestion[]; error?: string }> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [] };

  let results: TmdbSearchResult[];
  try {
    results = await searchTvShows(trimmed);
  } catch (error) {
    return { error: toResult(error).error };
  }

  // One query for the whole page of results, rather than one per row.
  const tracked = await prisma.trackedShow.findMany({
    where: { showId: { in: results.map((result) => String(result.id)) } },
    select: { showId: true, status: true },
  });
  const statusByShow = new Map(tracked.map((row) => [row.showId, row.status]));

  return {
    results: results.slice(0, 12).map((result) => {
      const id = String(result.id);

      return {
        id,
        name: result.name,
        posterPath: result.posterPath,
        firstAirYear: result.firstAirYear,
        status: (statusByShow.get(id) ?? null) as TrackStatus | null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tracking
//
// There is only one way a show enters your lists: the "+" button puts it on the
// watchlist. It graduates to "watching" on its own the moment you mark any
// episode watched — which is the point at which "watching" becomes true.
// ---------------------------------------------------------------------------

/** Adds a show to the watchlist, caching it from TMDB on the way in. */
export async function addToWatchlist(tmdbShowId: string): Promise<ActionResult> {
  if (!tmdbShowId.trim()) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const existing = await prisma.trackedShow.findUnique({
      where: { showId: tmdbShowId },
      select: { id: true },
    });

    // Already tracked — don't demote a show you're watching back to the
    // watchlist just because the button was pressed again.
    if (existing) return { ok: true };

    await syncShowFromTmdb(tmdbShowId);
    await prisma.trackedShow.create({
      data: { showId: tmdbShowId, status: "watchlist" },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews(tmdbShowId);
  return { ok: true };
}

/** Removes a show from your lists. The cached show/episode rows stay. */
export async function removeShow(showId: string): Promise<ActionResult> {
  try {
    await prisma.trackedShow.deleteMany({ where: { showId } });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews(showId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Watch progress
// ---------------------------------------------------------------------------

/**
 * Marks an episode watched and promotes its show to "watching".
 *
 * The promotion also covers shows that were never added at all: marking an
 * episode watched is a clearer statement of intent than pressing "+", so it
 * creates the tracked row rather than silently recording progress for a show
 * that appears on no list.
 */
export async function markEpisodeWatched(
  episodeId: string,
): Promise<ActionResult> {
  try {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { showId: true },
    });

    if (!episode) return { ok: false, error: "Unknown episode." };

    await prisma.watchedEpisode.upsert({
      where: { episodeId },
      create: { episodeId },
      update: {},
    });

    await prisma.trackedShow.upsert({
      where: { showId: episode.showId },
      create: { showId: episode.showId, status: "watching" },
      update: { status: "watching" },
    });

    revalidateShowViews(episode.showId);
  } catch (error) {
    return toResult(error);
  }

  return { ok: true };
}

/**
 * Drops a show back to the watchlist once it has no watched episodes left.
 *
 * This is the exact inverse of the promotion rule: "watching" means at least
 * one episode watched, so undoing the last one has to undo the move as well.
 * Without it, marking an episode by mistake left the show stuck under Watching
 * with zero progress and no way back short of removing and re-adding it.
 *
 * Shows already on the watchlist are untouched, and a show that isn't tracked
 * at all is left alone rather than being added.
 */
async function demoteIfNothingWatched(showId: string) {
  const remaining = await prisma.watchedEpisode.count({
    where: { episode: { showId } },
  });

  if (remaining > 0) return;

  await prisma.trackedShow.updateMany({
    where: { showId, status: "watching" },
    data: { status: "watchlist" },
  });
}

/**
 * Unmarks an episode, and returns the show to the watchlist if that was the
 * last watched episode.
 */
export async function unmarkEpisodeWatched(
  episodeId: string,
): Promise<ActionResult> {
  try {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { showId: true },
    });

    await prisma.watchedEpisode.deleteMany({ where: { episodeId } });

    if (episode) await demoteIfNothingWatched(episode.showId);

    revalidateShowViews(episode?.showId);
  } catch (error) {
    return toResult(error);
  }

  return { ok: true };
}

/** Marks every already-aired episode of a season watched, or clears them all. */
export async function setSeasonWatched(
  showId: string,
  seasonNumber: number,
  watched: boolean,
): Promise<ActionResult> {
  try {
    const episodes = await prisma.episode.findMany({
      where: {
        showId,
        seasonNumber,
        airDate: { not: null, lte: new Date() },
      },
      select: { id: true },
    });

    const episodeIds = episodes.map((episode) => episode.id);

    if (watched) {
      // SQLite doesn't support `skipDuplicates`, so filter out the episodes
      // that are already marked instead of relying on conflict handling.
      const alreadyWatched = await prisma.watchedEpisode.findMany({
        where: { episodeId: { in: episodeIds } },
        select: { episodeId: true },
      });

      const seen = new Set(alreadyWatched.map((row) => row.episodeId));

      await prisma.watchedEpisode.createMany({
        data: episodeIds
          .filter((episodeId) => !seen.has(episodeId))
          .map((episodeId) => ({ episodeId })),
      });

      // Same promotion rule as marking a single episode.
      if (episodeIds.length > 0) {
        await prisma.trackedShow.upsert({
          where: { showId },
          create: { showId, status: "watching" },
          update: { status: "watching" },
        });
      }
    } else {
      await prisma.watchedEpisode.deleteMany({
        where: { episodeId: { in: episodeIds } },
      });

      // Same rule as unmarking a single episode.
      await demoteIfNothingWatched(showId);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews(showId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateNotificationPrefs(
  enabled: boolean,
): Promise<ActionResult> {
  try {
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, notifyEnabled: enabled },
      update: { notifyEnabled: enabled },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/settings");
  return { ok: true };
}

/** Sets the default country for streaming availability. "" clears it. */
export async function updateCountry(country: string): Promise<ActionResult> {
  const value = country.trim().toUpperCase();

  if (value && !/^[A-Z]{2}$/.test(value)) {
    return { ok: false, error: "Country must be a two-letter code." };
  }

  try {
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, country: value || null },
      update: { country: value || null },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/settings");
  revalidatePath("/show", "layout");
  return { ok: true };
}

/** Re-fetches episode data for one show on demand, from the show page. */
export async function refreshShow(showId: string): Promise<ActionResult> {
  try {
    await syncShowFromTmdb(showId);
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews(showId);
  return { ok: true };
}

/**
 * Wipes the user's tracking data. The global Show/Episode cache is kept so
 * re-adding a show doesn't have to re-download everything from TMDB.
 */
export async function clearAllData(): Promise<ActionResult> {
  try {
    await prisma.watchedEpisode.deleteMany();
    await prisma.trackedShow.deleteMany();
    await prisma.settings.deleteMany();
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
