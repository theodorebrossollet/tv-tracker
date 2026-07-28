"use client";

import { useTransition } from "react";

import { setSeasonWatched } from "@/app/actions";

interface SeasonActionsProps {
  showId: string;
  seasonNumber: number;
  allWatched: boolean;
}

/** Bulk mark/unmark for a whole season — only touches episodes that have aired. */
export function SeasonActions({
  showId,
  seasonNumber,
  allWatched,
}: SeasonActionsProps) {
  const [pending, startTransition] = useTransition();

  function toggleSeason() {
    startTransition(async () => {
      await setSeasonWatched(showId, seasonNumber, !allWatched);
    });
  }

  return (
    <button
      type="button"
      onClick={toggleSeason}
      disabled={pending}
      className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-surface disabled:opacity-50"
    >
      {pending ? "Saving…" : allWatched ? "Unmark all" : "Mark all watched"}
    </button>
  );
}
