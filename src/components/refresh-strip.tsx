"use client";

import { useState, useTransition } from "react";

import { refreshShow } from "@/app/actions";
import { usePullToRefresh } from "@/components/use-pull-to-refresh";
import { PULL_THRESHOLD, shouldRefresh } from "@/lib/pull-to-refresh";

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
 * Both a button and the pull gesture the handoff draws, driving the same
 * action. The button is not a fallback: it is the only version that works for
 * a pointer, a keyboard, or a desktop browser, none of which the gesture ever
 * reaches. The gesture is the phone affordance layered on top.
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

  const pull = usePullToRefresh({ onRefresh: refresh, disabled: pending });
  const pulling = pull > 0;
  const willRefresh = shouldRefresh(pull);

  const label = pending
    ? "Checking TMDB…"
    : pulling
      ? willRefresh
        ? "Release to refresh"
        : "Pull to refresh"
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
      // The strip grows with the pull rather than the page moving under it:
      // translating the whole document fights the browser's own scrolling and
      // leaves the fixed tab bar behind.
      style={pulling ? { height: `${40 + pull}px` } : undefined}
      className={`-mx-4 flex w-[calc(100%+2rem)] items-center justify-center gap-2 border-b border-border-faint px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.07em] transition-colors hover:text-muted disabled:hover:text-faint ${
        willRefresh ? "text-accent-deep" : "text-faint"
      } ${pulling ? "" : "transition-[height]"}`}
    >
      {pending ? (
        <span
          aria-hidden="true"
          className="size-[11px] animate-spin rounded-full border-[1.5px] border-border border-t-accent motion-reduce:animate-none"
        />
      ) : null}

      {pulling && !pending ? (
        <span
          aria-hidden="true"
          className="transition-transform"
          style={{
            transform: `rotate(${Math.min(180, (pull / PULL_THRESHOLD) * 180)}deg)`,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[11px]"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </span>
      ) : null}
      <span role={outcome === "failed" ? "alert" : undefined}>{label}</span>
    </button>
  );
}
