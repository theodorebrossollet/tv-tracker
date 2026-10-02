"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  isUniqueConstraintError,
  toResult,
  type ActionResult,
} from "@/lib/action-result";
import { requireOnboardedSession } from "@/lib/auth";
import {
  isListKind,
  MAX_ITEMS_PER_LIST,
  MAX_LISTS,
  validateListName,
  type ListKind,
} from "@/lib/lists";
import { ensureMovieCached } from "@/lib/movies";
import { prisma } from "@/lib/prisma";
import { isTmdbMovieId, isTmdbShowId } from "@/lib/show-id";
import { ensureShowCached } from "@/lib/shows";

// Personal lists: creating, renaming and deleting them, and (further down)
// what goes on them.
//
// Split from `app/actions.ts` for size, but **every rule in that file's header
// applies here unchanged**: each action starts with `requireOnboardedSession`
// and scopes every Prisma call by the `userId` it returns, because actions are
// POST-able directly and the gate is the only thing in front of them. That also
// means every argument is validated, whatever its TypeScript type says. The
// gate goes ABOVE each `try`, never inside — `redirect` works by throwing and
// `toResult` would swallow it.
//
// A list is private: there is no read path for another account's list, so a
// list id that isn't yours is reported exactly like one that doesn't exist.
//
// A "use server" module may export only async functions, so the helpers below
// stay unexported.

/** Same reasoning as `revalidateShowViews` in `app/actions.ts`. */
function revalidateListViews() {
  revalidatePath("/", "layout");
}

const NOT_FOUND = "List not found.";

/** A list id is an opaque cuid: all that can be checked is that it's a string. */
function isListId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** Makes a new empty list and returns its id. */
export async function createList(
  name: string,
  trackSeparately: boolean,
): Promise<ActionResult & { id?: string }> {
  const { user } = await requireOnboardedSession();

  const checked = validateListName(name);
  if (!checked.ok) return { ok: false, error: checked.error };

  if (typeof trackSeparately !== "boolean") {
    return { ok: false, error: "That change isn't available." };
  }

  let id: string;
  try {
    // Count-then-create can overshoot MAX_LISTS under a race; accepted for the
    // same reason as the show/movie hourly allowances (a soft cap, not a
    // security boundary).
    const owned = await prisma.list.count({ where: { userId: user.id } });
    if (owned >= MAX_LISTS) {
      return {
        ok: false,
        error: `You've reached the limit of ${MAX_LISTS} lists.`,
      };
    }

    const created = await prisma.list.create({
      data: { userId: user.id, name: checked.name, trackSeparately },
      select: { id: true },
    });
    id = created.id;
  } catch (error) {
    return toResult(error);
  }

  revalidateListViews();
  return { ok: true, id };
}

/**
 * Renames a list and/or switches how it tracks watched.
 *
 * Flipping `trackSeparately` only changes which source is read; it never
 * touches an item's `watchedAt`, so switching off and back on loses nothing.
 */
export async function updateList(
  listId: string,
  changes: { name: string; trackSeparately: boolean },
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  if (!isListId(listId)) return { ok: false, error: NOT_FOUND };
  if (typeof changes !== "object" || changes === null) {
    return { ok: false, error: "That change isn't available." };
  }

  const checked = validateListName(changes.name);
  if (!checked.ok) return { ok: false, error: checked.error };

  if (typeof changes.trackSeparately !== "boolean") {
    return { ok: false, error: "That change isn't available." };
  }

  try {
    // `userId` in the filter is what keeps this from editing someone else's
    // list; a zero count covers both "not yours" and "doesn't exist".
    const { count } = await prisma.list.updateMany({
      where: { id: listId, userId: user.id },
      data: { name: checked.name, trackSeparately: changes.trackSeparately },
    });
    if (count === 0) return { ok: false, error: NOT_FOUND };
  } catch (error) {
    return toResult(error);
  }

  revalidateListViews();
  return { ok: true };
}

/**
 * Deletes a list and, by cascade, its items. The movies and shows themselves
 * and the account's Library tracking are untouched. Success redirects to
 * `/lists`; only failures return.
 */
export async function deleteList(listId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  if (!isListId(listId)) return { ok: false, error: NOT_FOUND };

  try {
    const { count } = await prisma.list.deleteMany({
      where: { id: listId, userId: user.id },
    });
    if (count === 0) return { ok: false, error: NOT_FOUND };
  } catch (error) {
    return toResult(error);
  }

  revalidateListViews();
  // The action's response re-renders the CURRENT route, which is now the page
  // of a list that no longer exists — a visible not-found before a client-side
  // push could land. Redirecting from the action replaces that render. It
  // throws, so it sits after the try, and a success never returns.
  redirect("/lists");
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * Puts a movie or show on a list, caching it first if nothing holds it yet.
 *
 * Never creates or changes Library tracking: a list is a separate thing from
 * the watchlist. The id reaches a TMDB request path, so it is validated for the
 * given kind before anything else runs.
 */
export async function addToList(
  listId: string,
  kind: ListKind,
  titleId: string,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  if (!isListId(listId)) return { ok: false, error: NOT_FOUND };
  if (!isListKind(kind)) return { ok: false, error: "That change isn't available." };
  // The regexes coerce, so a number would pass them; insist on a string first.
  if (
    typeof titleId !== "string" ||
    (kind === "movie" ? !isTmdbMovieId(titleId) : !isTmdbShowId(titleId))
  ) {
    return { ok: false, error: "Missing title id." };
  }

  try {
    const list = await prisma.list.findFirst({
      where: { id: listId, userId: user.id },
      select: { id: true },
    });
    if (!list) return { ok: false, error: NOT_FOUND };

    const size = await prisma.listItem.count({ where: { listId: list.id } });
    if (size >= MAX_ITEMS_PER_LIST) {
      return {
        ok: false,
        error: `A list can hold up to ${MAX_ITEMS_PER_LIST} titles.`,
      };
    }

    const known =
      kind === "movie"
        ? await ensureMovieCached(titleId, user.id)
        : await ensureShowCached(titleId, user.id);
    if (!known) return { ok: false, error: "Couldn't find that title." };

    // Only a collision on THIS insert means the title is already on the list.
    // A P2002 from the caching above (two requests syncing the same new show)
    // is a real failure: nothing was added, so it goes through `toResult`.
    try {
      await prisma.listItem.create({
        data: {
          listId: list.id,
          ...(kind === "movie" ? { movieId: titleId } : { showId: titleId }),
        },
      });
    } catch (error) {
      // A double-click can lose the race to the unique constraint; the title
      // is on the list either way. (The size check above is likewise racy and
      // accepted: it is a soft cap.)
      if (!isUniqueConstraintError(error)) throw error;
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateListViews();
  return { ok: true };
}

/** Takes one item off a list. The title itself and the Library are untouched. */
export async function removeFromList(
  listId: string,
  itemId: string,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  if (!isListId(listId) || !isListId(itemId)) {
    return { ok: false, error: NOT_FOUND };
  }

  try {
    // The owner is checked through the list, so another account's ids match
    // nothing.
    const { count } = await prisma.listItem.deleteMany({
      where: { id: itemId, listId, list: { userId: user.id } },
    });
    if (count === 0) return { ok: false, error: NOT_FOUND };
  } catch (error) {
    return toResult(error);
  }

  revalidateListViews();
  return { ok: true };
}

/** Ticks or unticks an item on a list that tracks watched separately. */
export async function setListItemWatched(
  listId: string,
  itemId: string,
  watched: boolean,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  if (!isListId(listId) || !isListId(itemId)) {
    return { ok: false, error: NOT_FOUND };
  }
  if (typeof watched !== "boolean") {
    return { ok: false, error: "That change isn't available." };
  }

  try {
    const list = await prisma.list.findFirst({
      where: { id: listId, userId: user.id },
      select: { trackSeparately: true },
    });
    if (!list) return { ok: false, error: NOT_FOUND };
    if (!list.trackSeparately) {
      return { ok: false, error: "That list doesn't track watched separately." };
    }

    const { count } = await prisma.listItem.updateMany({
      where: { id: itemId, listId },
      data: { watchedAt: watched ? new Date() : null },
    });
    if (count === 0) return { ok: false, error: NOT_FOUND };
  } catch (error) {
    return toResult(error);
  }

  revalidateListViews();
  return { ok: true };
}
