"use client";

import { useOptimistic, useState, useTransition } from "react";

import { addToList } from "@/app/list-actions";
import type { ListKind } from "@/lib/lists";

interface ListAddButtonProps {
  listId: string;
  kind: ListKind;
  titleId: string;
  /** Whether the title was already on the list when the row was rendered. */
  onList: boolean;
}

/**
 * The per-row control in the search overlay's "adding to a list" mode: "+"
 * adds the title, a tick says it is on the list and is inert. It only ever
 * adds; removing happens on the list page.
 */
export function ListAddButton({
  listId,
  kind,
  titleId,
  onList,
}: ListAddButtonProps) {
  // Derived from the prop, not copied into useState: the server's answer is
  // the truth and must be able to correct the display.
  const [optimisticOnList, setOptimisticOnList] = useOptimistic(onList);
  // The search results are fetched once per query, so the prop never changes
  // after a successful add — and an optimistic value is dropped when the
  // transition ends. Remember the success here so the tick stays.
  const [added, setAdded] = useState(false);
  // Plain state, not optimistic: optimistic values are dropped when the
  // transition ends, which would erase the message the moment it appeared.
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const on = optimisticOnList || added;

  function add(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (on || pending) return;

    setError(null);

    startTransition(async () => {
      setOptimisticOnList(true);

      const result = await addToList(listId, kind, titleId);

      if (result.ok) {
        setAdded(true);
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  const label = on ? "On the list" : "Add to list";

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={add}
        disabled={pending || on}
        title={label}
        aria-label={label}
        className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-lg leading-none transition-colors disabled:opacity-50 ${
          on
            ? "border-accent bg-accent text-on-accent"
            : "border-border hover:bg-surface"
        }`}
      >
        {on ? "✓" : "+"}
      </button>

      {error ? <p className="max-w-40 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
