"use client";

import { SearchIcon } from "@/components/search-overlay";
import { useSearch } from "@/components/search-provider";

/**
 * The round search button in a screen header.
 *
 * Duplicates the Search tab on purpose: the tab is a thumb-level control for
 * "I want to search", this is an in-context one for "there's nothing here yet".
 * Both open the same overlay.
 */
export function SearchIconButton() {
  const { open } = useSearch();

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Search shows"
      aria-haspopup="dialog"
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface hover:text-foreground"
    >
      <SearchIcon className="size-[17px]" />
    </button>
  );
}
