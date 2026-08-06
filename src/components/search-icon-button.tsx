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
    // 40px of circle inside 44px of hit area, the same way `MarkWatchedButton`
    // and `StatusMenu` pad their controls out — the handoff draws small targets
    // and says to make up the difference in code. This one was drawn and
    // shipped at 40px flat, which a real Pixel viewport catches and a desktop
    // pointer never would.
    <button
      type="button"
      onClick={open}
      aria-label="Search shows"
      aria-haspopup="dialog"
      className="-m-0.5 flex size-11 shrink-0 items-center justify-center"
    >
      <span className="flex size-10 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface hover:text-foreground">
        <SearchIcon className="size-[17px]" />
      </span>
    </button>
  );
}
