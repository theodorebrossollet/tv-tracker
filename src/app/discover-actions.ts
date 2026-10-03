"use server";

import { revalidatePath } from "next/cache";

import { toResult, type ActionResult } from "@/lib/action-result";
import { requireOnboardedSession } from "@/lib/auth";
import { isSuggestionKind, MAX_DISMISSED } from "@/lib/discover-limits";
import type { CardDetails } from "@/lib/discover-types";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/shows";
import { isTmdbMovieId, isTmdbShowId } from "@/lib/show-id";
import {
  getMovieDetails,
  getMovieExtras,
  getShowCast,
  getShowDetails,
  getShowTrailer,
  getWatchProviders,
} from "@/lib/tmdb";

// Discover's writes. The same rules as `app/actions.ts` apply: the session gate
// sits above each `try`, every argument is validated, and every Prisma call
// carries the caller's userId.

/** Longer than any real TMDB id; bounds what a direct POST can store. */
const MAX_ID_LENGTH = 12;

/**
 * "Never suggest this again." Swiping left calls this and nothing else: the
 * title's real status is untouched. A repeat is a no-op.
 */
export async function dismissSuggestion(
  kind: string,
  tmdbId: string,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  if (!isSuggestionKind(kind)) {
    return { ok: false, error: "Unknown suggestion type." };
  }
  const validId = kind === "movie" ? isTmdbMovieId(tmdbId) : isTmdbShowId(tmdbId);
  if (typeof tmdbId !== "string" || !validId || tmdbId.length > MAX_ID_LENGTH) {
    return { ok: false, error: "Invalid title id." };
  }

  try {
    const count = await prisma.dismissedSuggestion.count({
      where: { userId: user.id },
    });
    if (count >= MAX_DISMISSED) {
      return {
        ok: false,
        error: "Too many hidden suggestions. Show some again in Settings.",
      };
    }

    await prisma.dismissedSuggestion.upsert({
      where: { userId_kind_tmdbId: { userId: user.id, kind, tmdbId } },
      create: { userId: user.id, kind, tmdbId },
      update: {},
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Brings every hidden suggestion back, for the caller only. */
export async function resetDismissedSuggestions(): Promise<
  ActionResult & { count?: number }
> {
  const { user } = await requireOnboardedSession();

  let count: number;
  try {
    ({ count } = await prisma.dismissedSuggestion.deleteMany({
      where: { userId: user.id },
    }));
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/", "layout");
  return { ok: true, count };
}

/**
 * The lazily loaded detail on a card: overview, genres, runtime, cast, trailer
 * and where it streams. Read-only, but still gated: it spends TMDB requests on
 * the caller's behalf. A TMDB failure is a result, never a throw.
 */
export async function loadCardDetails(
  kind: string,
  id: string,
): Promise<ActionResult & { details?: CardDetails }> {
  const { user } = await requireOnboardedSession();

  if (!isSuggestionKind(kind)) {
    return { ok: false, error: "Unknown suggestion type." };
  }
  const validId = kind === "movie" ? isTmdbMovieId(id) : isTmdbShowId(id);
  if (typeof id !== "string" || !validId || id.length > MAX_ID_LENGTH) {
    return { ok: false, error: "Invalid title id." };
  }

  try {
    const { country } = await getSettings(user.id);

    if (kind === "movie") {
      const [extras, movie] = await Promise.all([
        getMovieExtras(id),
        getMovieDetails(id),
      ]);
      return {
        ok: true,
        details: {
          overview: movie.overview,
          genres: movie.genres,
          runtime: movie.runtime,
          cast: extras.cast.map(({ id, name, character }) => ({
            id,
            name,
            character,
          })),
          trailerKey: extras.trailer?.key ?? null,
          // TMDB's provider lookup here is per show; movies have none yet.
          providers: [],
        },
      };
    }

    const [show, cast, trailer, availability] = await Promise.all([
      getShowDetails(id),
      getShowCast(id),
      getShowTrailer(id),
      country ? getWatchProviders(id) : Promise.resolve([]),
    ]);
    const here = availability.find((entry) => entry.code === country);
    return {
      ok: true,
      details: {
        overview: show.overview,
        genres: show.genres,
        runtime: null,
        cast: cast.map(({ id, name, character }) => ({ id, name, character })),
        trailerKey: trailer?.key ?? null,
        providers: here?.flatrate.map((provider) => provider.name) ?? [],
      },
    };
  } catch {
    return { ok: false, error: "Couldn't load details." };
  }
}
