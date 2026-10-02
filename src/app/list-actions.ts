"use server";

import { revalidatePath } from "next/cache";

import { toResult, type ActionResult } from "@/lib/action-result";
import { requireOnboardedSession } from "@/lib/auth";
import { MAX_LISTS, validateListName } from "@/lib/lists";
import { prisma } from "@/lib/prisma";

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
 * and the account's Library tracking are untouched.
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
  return { ok: true };
}
