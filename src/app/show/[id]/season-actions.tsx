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
      className="min-h-[38px] shrink-0 rounded-[10px] border border-border px-3 text-[13px] text-muted transition-colors hover:text-foreground disabled:opacity-50"
    >
      {pending ? "Saving…" : allWatched ? "Unmark all" : "Mark all"}
    </button>
  );
}
