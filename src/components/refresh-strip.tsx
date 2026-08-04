"use client";

import { useState, useTransition } from "react";

import { refreshShow } from "@/app/actions";

interface RefreshStripProps {
  showId: string;
  /** Pre-formatted server-side, so both sides agree during hydration. */
  refreshedLabel: string;
}

/**
 * The show page's episode-data status line, and the only way to ask for a
 * re-sync.
 *
 * Nothing else in the app lets the reader trigger one: the cron visits tracked
 * shows daily, and `ensureShowCached` re-syncs an untracked one on view once it
 * is a day stale. Both are invisible and neither is promptable.
 *
 * A button rather than the pull-to-refresh gesture the handoff draws. The
 * gesture is a separate, larger job — touch handling with an axis lock, and no
 * automated coverage possible, since jsdom has neither real touch nor real
 * scroll — and it would call this same action. Shipping the button first means
 * the feature works for pointers, keyboards and desktop, all of which the
 * gesture never covers. See docs/roadmap.md.
 */
export function RefreshStrip({ showId, refreshedLabel }: RefreshStripProps) {
  // Not a copy of a prop: this is the outcome of *this* click, which the server
  // has no opinion about. `refreshedLabel` still follows the server, and takes
  // over again on the next navigation.
  const [outcome, setOutcome] = useState<"idle" | "done" | "failed">("idle");
  const [pending, startTransition] = useTransition();

  function refresh() {
    setOutcome("idle");

    startTransition(async () => {
      const result = await refreshShow(showId);
      setOutcome(result.ok ? "done" : "failed");
    });
  }

  const label = pending
    ? "Checking TMDB…"
    : outcome === "done"
      ? "Updated just now"
      : outcome === "failed"
        ? "Couldn't reach TMDB"
        : refreshedLabel;

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={pending}
      // The strip is the full width of the screen and 10px tall, which is well
      // under a comfortable target — but it is a convenience on a page whose
      // real controls are all elsewhere, and the whole strip is tappable, so
      // the horizontal reach makes up for the height.
      className="-mx-4 flex w-[calc(100%+2rem)] items-center justify-center gap-2 border-b border-border-faint px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.07em] text-faint transition-colors hover:text-muted disabled:hover:text-faint"
    >
      {pending ? (
        <span
          aria-hidden="true"
          className="size-[11px] animate-spin rounded-full border-[1.5px] border-border border-t-accent motion-reduce:animate-none"
        />
      ) : null}
      <span role={outcome === "failed" ? "alert" : undefined}>{label}</span>
    </button>
  );
}
