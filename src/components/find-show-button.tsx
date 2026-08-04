"use client";

import { useSearch } from "@/components/search-provider";

/** Opens the same search overlay as the magnifying glass in the nav. */
export function FindShowButton({ label = "Find a show" }: { label?: string }) {
  const { open } = useSearch();

  return (
    <button
      type="button"
      onClick={open}
      className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
    >
      {label}
    </button>
  );
}
