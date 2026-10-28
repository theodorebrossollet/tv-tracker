"use client";

import { useState, useTransition } from "react";

import { refreshShow } from "@/app/actions";
import { PullArrow, RefreshSpinner } from "@/components/pull-arrow";
import { usePullToRefresh } from "@/components/use-pull-to-refresh";
import { shouldRefresh } from "@/lib/pull-to-refresh";

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

  // While pulling, the line says when the show was last synced until the pull
  // is far enough to act on: at rest the strip takes no room, so this is now
  // the one place that date is seen, and a pull is exactly when it's wanted.
  const label = pending
    ? "Checking TMDB…"
    : pulling
      ? willRefresh
        ? "Release to refresh"
        : refreshedLabel
      : outcome === "done"
        ? "Updated just now"
        : outcome === "failed"
          ? "Couldn't reach TMDB"
          : refreshedLabel;

  // Open when there is something to say: mid-pull, mid-sync, or reporting how
  // a sync went. At rest it used to be a permanent 40px line at the top of
  // every show page, the first thing under the status bar, saying a date
  // nobody had asked for.
  const open = pulling || pending || outcome !== "idle";

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={pending}
      // Open, the strip is the full width of the screen and 40px tall, a
      // little under a comfortable target — but it is a convenience on a page
      // whose real controls are all elsewhere, and the whole strip is
      // tappable, so the horizontal reach makes up for the height.
      // The strip grows with the pull rather than the page moving under it:
      // translating the whole document fights the browser's own scrolling and
      // leaves the fixed tab bar behind.
      style={pulling ? { height: `${40 + pull}px` } : undefined}
      // Closed, it is a zero-height button that still takes a tap from the
      // keyboard: focusing it opens it, so a pointer or keyboard user (whom the
      // gesture never reaches) can still find the one way to ask for a sync.
      // The negative top margin lifts it into `main`'s padding, as
      // `PullToRefreshPage` does, so opening it doesn't leave a gap above.
      className={`-mx-4 -mt-6 mb-6 flex w-[calc(100%+2rem)] items-center justify-center gap-2 overflow-hidden px-4 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors hover:text-muted disabled:hover:text-faint sm:-mt-10 sm:mb-10 ${
        open
          ? "h-10 border-b border-border-faint"
          : "h-0 focus-visible:h-10 focus-visible:border-b focus-visible:border-border-faint"
      } ${willRefresh ? "text-accent-deep" : "text-faint"} ${
        pulling ? "" : "transition-[height]"
      }`}
    >
      {pending ? <RefreshSpinner /> : null}

      {pulling && !pending ? <PullArrow pull={pull} /> : null}
      <span role={outcome === "failed" ? "alert" : undefined}>{label}</span>
    </button>
  );
}
