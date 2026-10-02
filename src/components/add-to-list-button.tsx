"use client";

import { useOptimistic, useState, useTransition } from "react";

import { addToList, removeFromList } from "@/app/list-actions";
import { ListFormSheet } from "@/components/list-form-sheet";
import { Sheet } from "@/components/sheet";
import type { ListKind } from "@/lib/lists";
import type { TitleListMembership } from "@/lib/queries";

interface AddToListButtonProps {
  kind: ListKind;
  titleId: string;
  lists: TitleListMembership[];
}

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * "Add to list" on a movie or show page, and the sheet it opens: one toggle per
 * list, plus a "New list" row.
 *
 * Each row's checked state derives from the `lists` prop through
 * `useOptimistic`, so a server re-render (another tab, the list page) corrects
 * it and a failed toggle reverts on its own when the transition ends. The
 * messages live in `useState` for the opposite reason: an optimistic value is
 * dropped when the action settles, which would erase an error the moment it
 * appeared.
 */
export function AddToListButton({
  kind,
  titleId,
  lists,
}: AddToListButtonProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [, startTransition] = useTransition();
  const [shown, setOnList] = useOptimistic(
    lists,
    (state, change: { listId: string; onList: boolean }) =>
      state.map((entry) =>
        entry.listId === change.listId
          ? { ...entry, onList: change.onList }
          : entry,
      ),
  );

  function setRowBusy(listId: string, on: boolean) {
    setBusy((previous) => {
      const next = new Set(previous);
      if (on) next.add(listId);
      else next.delete(listId);
      return next;
    });
  }

  function toggle(entry: TitleListMembership) {
    setError(null);
    setNotice(null);

    // Defensive: the query only reports `onList` with an item id.
    if (entry.onList && entry.itemId === null) {
      setError("Couldn't remove it from that list. Please reload the page.");
      return;
    }

    setRowBusy(entry.listId, true);

    startTransition(async () => {
      setOnList({ listId: entry.listId, onList: !entry.onList });

      try {
        const result =
          entry.onList && entry.itemId !== null
            ? await removeFromList(entry.listId, entry.itemId)
            : await addToList(entry.listId, kind, titleId);

        if (!result.ok) setError(result.error ?? GENERIC_ERROR);
      } catch {
        setError(GENERIC_ERROR);
      } finally {
        setRowBusy(entry.listId, false);
      }
    });
  }

  function addToCreated(listId: string) {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      try {
        const result = await addToList(listId, kind, titleId);

        if (result.ok) setNotice("Created the list and added this to it.");
        else
          setError(
            `The list was created, but this wasn't added to it: ${
              result.error ?? GENERIC_ERROR
            }`,
          );
      } catch {
        setError(
          `The list was created, but this wasn't added to it: ${GENERIC_ERROR}`,
        );
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex min-h-9 shrink-0 items-center gap-[7px] rounded-full border border-border bg-transparent px-3 text-[12.5px] font-medium text-foreground"
      >
        Add to list
      </button>

      {open ? (
        <Sheet title="Add to list" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-0.5">
            {shown.length === 0 ? (
              <p className="px-2 pb-2 text-[12.5px] leading-relaxed text-muted">
                Lists let you group movies and shows your own way, like
                &ldquo;Weekend watches&rdquo;. Only you can see them.
              </p>
            ) : null}

            {shown.map((entry) => (
              <label
                key={entry.listId}
                className="flex min-h-14 cursor-pointer items-center gap-3 rounded-[13px] px-4 py-2 transition-colors hover:bg-surface has-[:disabled]:cursor-default has-[:disabled]:opacity-50"
              >
                <input
                  type="checkbox"
                  checked={entry.onList}
                  disabled={busy.has(entry.listId)}
                  onChange={() => {
                    // The real entry, not the optimistic copy's flipped flag:
                    // both agree outside a pending toggle, which is disabled.
                    const source = lists.find(
                      (row) => row.listId === entry.listId,
                    );
                    toggle(source ?? entry);
                  }}
                  className="size-5 shrink-0 accent-accent"
                />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                  {entry.name}
                </span>
              </label>
            ))}

            <hr className="my-1.5 border-border-faint" />

            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-haspopup="dialog"
              className="flex min-h-14 items-center gap-3 rounded-[13px] px-4 py-2 text-left text-[15px] font-medium text-accent-deep transition-colors hover:bg-surface"
            >
              New list
            </button>
          </div>

          {error ? (
            <p role="alert" className="mt-2 px-1.5 text-xs text-danger">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-2 px-1.5 text-xs text-muted">
              {notice}
            </p>
          ) : null}
        </Sheet>
      ) : null}

      {creating ? (
        <ListFormSheet
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={addToCreated}
        />
      ) : null}
    </>
  );
}
