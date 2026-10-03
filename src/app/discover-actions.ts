"use server";

import { revalidatePath } from "next/cache";

import { toResult, type ActionResult } from "@/lib/action-result";
import { requireOnboardedSession } from "@/lib/auth";
import { isSuggestionKind, MAX_DISMISSED } from "@/lib/discover-limits";
import { prisma } from "@/lib/prisma";
import { isTmdbMovieId, isTmdbShowId } from "@/lib/show-id";

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
