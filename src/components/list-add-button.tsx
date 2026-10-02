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
  /** For the accessible name: what is being added, and to which list. */
  title: string;
  listName: string;
  /** The row's content (poster, title, year); the whole of it is the tap target. */
  children: React.ReactNode;
}

/**
 * The search overlay's "adding to a list" row. The whole row is the one
 * control: tapping anywhere on it adds the title; the trailing "+" / tick is
 * only a state glyph. A title on the list is inert. It only ever adds;
 * removing happens on the list page.
 */
export function ListAddButton({
  listId,
  kind,
  titleId,
  onList,
  title,
  listName,
  children,
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

  const label = on
    ? `${title} is on ${listName}`
    : `Add ${title} to ${listName}`;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <button
        type="button"
        onClick={add}
        disabled={pending || on}
        aria-label={label}
        className="flex w-full min-w-0 items-center gap-3 text-left disabled:cursor-default"
      >
        {children}

        <span
          aria-hidden="true"
          className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-lg leading-none transition-colors ${
            on
              ? "border-accent bg-accent text-on-accent"
              : pending
                ? "border-border opacity-50"
                : "border-border"
          }`}
        >
          {on ? "✓" : pending ? "…" : "+"}
        </span>
      </button>

      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
