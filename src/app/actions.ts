"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { syncShowFromTmdb } from "@/lib/shows";
import { isTrackStatus, type TrackStatus } from "@/lib/types";
import { searchTvShows, TmdbError, type TmdbSearchResult } from "@/lib/tmdb";

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

export interface SearchState {
  query: string;
  results?: TmdbSearchResult[];
  error?: string;
}

/** Called from the search form. Results are not cached until a show is tracked. */
export async function searchShows(
  _prev: SearchState,
  formData: FormData,
): Promise<SearchState> {
  const query = String(formData.get("query") ?? "").trim();

  if (!query) {
    return { query, results: [] };
  }

  try {
    return { query, results: await searchTvShows(query) };
  } catch (error) {
    const result = toResult(error);
    return { query, error: result.error };
  }
}

/**
 * Adds a show to "watching" or the watchlist, caching its episodes locally on
 * the way in. Re-tracking an already-tracked show just moves it between lists.
 */
export async function trackShow(
  tmdbShowId: string,
  status: TrackStatus,
): Promise<ActionResult> {
  if (!tmdbShowId.trim()) {
    return { ok: false, error: "Missing show id." };
  }

  if (!isTrackStatus(status)) {
    return { ok: false, error: "Unknown list." };
  }

  try {
    await syncShowFromTmdb(tmdbShowId);

    await prisma.trackedShow.upsert({
      where: { showId: tmdbShowId },
      create: { showId: tmdbShowId, status },
      update: { status },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/");
  revalidatePath("/watchlist");
  revalidatePath(`/show/${tmdbShowId}`);
  return { ok: true };
}

/** Removes a show from both lists. The cached show/episode rows stay. */
export async function untrackShow(showId: string): Promise<ActionResult> {
  try {
    await prisma.trackedShow.deleteMany({ where: { showId } });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/");
  revalidatePath("/watchlist");
  revalidatePath(`/show/${showId}`);
  return { ok: true };
}

export async function markEpisodeWatched(
  episodeId: string,
): Promise<ActionResult> {
  try {
    await prisma.watchedEpisode.upsert({
      where: { episodeId },
      create: { episodeId },
      update: {},
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/");
  revalidatePath("/show", "layout");
  return { ok: true };
}

export async function unmarkEpisodeWatched(
  episodeId: string,
): Promise<ActionResult> {
  try {
    await prisma.watchedEpisode.deleteMany({ where: { episodeId } });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/");
  revalidatePath("/show", "layout");
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

    if (watched) {
      // SQLite doesn't support `skipDuplicates`, so filter out the episodes
      // that are already marked instead of relying on conflict handling.
      const episodeIds = episodes.map((episode) => episode.id);

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
    } else {
      await prisma.watchedEpisode.deleteMany({
        where: { episodeId: { in: episodes.map((episode) => episode.id) } },
      });
    }
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/");
  revalidatePath(`/show/${showId}`);
  return { ok: true };
}

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

/** Re-fetches episode data for one show on demand, from the show page. */
export async function refreshShow(showId: string): Promise<ActionResult> {
  try {
    await syncShowFromTmdb(showId);
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/");
  revalidatePath(`/show/${showId}`);
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
