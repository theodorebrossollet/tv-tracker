"use client";

import { useSearch } from "@/components/search-provider";

/** Opens the same search overlay as the magnifying glass in the nav. */
export function FindShowButton({ label = "Find a show" }: { label?: string }) {
  const { open } = useSearch();

  return (
    <button
      type="button"
      onClick={open}
      className="min-h-[46px] rounded-full bg-accent px-[22px] text-[15px] font-semibold text-on-accent transition-opacity hover:opacity-90"
    >
      {label}
    </button>
  );
}
