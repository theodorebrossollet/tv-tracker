"use client";

import { useSearch } from "@/components/search-provider";

/** Opens search in "adding to this list" mode. */
export function AddTitlesButton({
  listId,
  listName,
}: {
  listId: string;
  listName: string;
}) {
  const { openForList } = useSearch();

  return (
    <button
      type="button"
      onClick={() => openForList({ id: listId, name: listName })}
      className="min-h-10 shrink-0 rounded-full bg-accent px-[18px] text-[14px] font-semibold text-on-accent transition-opacity hover:opacity-90"
    >
      Add titles
    </button>
  );
}
