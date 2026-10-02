"use server";

import { revalidatePath } from "next/cache";

import { toResult, type ActionResult } from "@/lib/action-result";
import { requireOnboardedSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRating } from "@/lib/ratings";
import { isTmdbMovieId } from "@/lib/show-id";

// Rating a watched movie or episode.
//
// Split from `app/actions.ts` for size, but **every rule in that file's header
// applies here unchanged**: each action starts with `requireOnboardedSession`
// and scopes every Prisma call by the `userId` it returns, because actions are
// POST-able directly and the gate is the only thing in front of them. That also
// means every argument is validated, whatever its TypeScript type says. The
// gate goes ABOVE each `try`, never inside — `redirect` works by throwing and
// `toResult` would swallow it.
//
// Rating never creates a record. Only an existing watched row can carry a
// rating, so "rate" can't be used to mark something watched; and a rating goes
// away with the watched mark (see `setMovieStatus`, `unmarkEpisodeWatched` and
// `setSeasonWatched` in `app/actions.ts`).
//
// A "use server" module may export only async functions, so the helpers below
// stay unexported.

/** Same reasoning as `revalidateShowViews` in `app/actions.ts`. */
function revalidateRatingViews() {
  revalidatePath("/", "layout");
}

const NOT_WATCHED = "Mark it watched first.";
const BAD_RATING = "That rating isn't available.";

/** `null` clears a rating; anything else must be a whole number 1 to 10. */
function isRatingOrNull(value: unknown): value is number | null {
  return value === null || isRating(value);
}

/**
 * Sets or clears (null) the caller's rating of a movie they have watched.
 * Refuses a movie that isn't tracked as watched; never creates a row.
 */
export async function rateMovie(
  movieId: string,
  rating: number | null,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // `regex.test` coerces a number to a string, so the type is checked first.
  if (typeof movieId !== "string" || !isTmdbMovieId(movieId)) {
    return { ok: false, error: "Missing movie id." };
  }
  if (!isRatingOrNull(rating)) return { ok: false, error: BAD_RATING };

  try {
    const existing = await prisma.trackedMovie.findUnique({
      where: { userId_movieId: { userId: user.id, movieId } },
      select: { status: true },
    });
    if (!existing || existing.status !== "watched") {
      return { ok: false, error: NOT_WATCHED };
    }

    // `updateMany` so a row removed in another tab is a refusal rather than a
    // thrown P2025; the status filter re-checks what was read above.
    const { count } = await prisma.trackedMovie.updateMany({
      where: { userId: user.id, movieId, status: "watched" },
      data: { rating },
    });
    if (count === 0) return { ok: false, error: NOT_WATCHED };
  } catch (error) {
    return toResult(error);
  }

  revalidateRatingViews();
  return { ok: true };
}

/**
 * Sets or clears (null) the caller's rating of an episode they have watched.
 * An unwatched episode, an unknown id and another account's watched episode
 * all get the same refusal, so nothing is leaked; never creates a row.
 */
export async function rateEpisode(
  episodeId: string,
  rating: number | null,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Episode ids are opaque TMDB ids that only key a database lookup, so type
  // and length are all there is to check.
  if (
    typeof episodeId !== "string" ||
    episodeId.length === 0 ||
    episodeId.length > 64
  ) {
    return { ok: false, error: "Missing episode id." };
  }
  if (!isRatingOrNull(rating)) return { ok: false, error: BAD_RATING };

  try {
    const { count } = await prisma.watchedEpisode.updateMany({
      where: { userId: user.id, episodeId },
      data: { rating },
    });
    if (count === 0) return { ok: false, error: NOT_WATCHED };
  } catch (error) {
    return toResult(error);
  }

  revalidateRatingViews();
  return { ok: true };
}
