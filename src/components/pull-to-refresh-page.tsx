"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { PullArrow, RefreshSpinner } from "@/components/pull-arrow";
import { usePullToRefresh } from "@/components/use-pull-to-refresh";
import { shouldRefresh } from "@/lib/pull-to-refresh";

/**
 * Pull-to-refresh for the list screens: Watching, and both halves of Library.
 *
 * What a pull does here is re-render the page from the database, not re-sync
 * anything from TMDB. That is the refresh these screens can actually be behind
 * on — an episode ticked off on another device, or the cron having synced a
 * new one overnight. A TMDB walk of every tracked show from one gesture would
 * be dozens of multi-season fetches, and the show page's strip already covers
 * the one show someone suspects is stale.
 *
 * Unlike that strip, this takes no room until a pull starts. The strip earns
 * its line by saying when the show was last synced; a list has no such date,
 * so a permanent row here would be a label with nothing to report.
 *
 * Settings has none on purpose: nothing on it changes except by the reader's
 * own hand.
 */
export function PullToRefreshPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function refresh() {
    // `router.refresh()` inside a transition keeps `pending` true until the
    // new payload has rendered, which is exactly how long the spinner should
    // stay up.
    startTransition(() => router.refresh());
  }

  const pull = usePullToRefresh({ onRefresh: refresh, disabled: pending });
  const willRefresh = shouldRefresh(pull);

  const active = pending || pull > 0;

  return (
    // Always mounted, and empty at rest: a live region that appears with its
    // text already inside tends not to be announced at all. At zero height the
    // two margins below cancel, so it takes no room.
    <div
      role="status"
      // Grows with the pull and pushes the page down with it, rather than
      // translating the document — the same reason the show page's strip
      // does, since moving the page fights the browser's own scrolling.
      // The negative margin lifts it into `main`'s top padding and the bottom
      // margin gives that padding back, so the page moves by exactly `pull`.
      style={{ height: pending ? "40px" : `${pull}px` }}
      //
      // The bottom padding is only there while active: with border-box sizing
      // it would otherwise hold the box 10px open at a height of zero.
      className={`-mt-6 mb-6 flex items-end justify-center gap-2 overflow-hidden font-mono text-[10px] uppercase tracking-[0.07em] sm:-mt-10 sm:mb-10 ${
        willRefresh || pending ? "text-accent-deep" : "text-faint"
      } ${active ? "pb-2.5" : ""} ${pull > 0 ? "" : "transition-[height]"}`}
    >
      {active ? (
        <>
          {pending ? <RefreshSpinner /> : <PullArrow pull={pull} />}
          <span>
            {pending
              ? "Refreshing…"
              : willRefresh
                ? "Release to refresh"
                : "Pull to refresh"}
          </span>
        </>
      ) : null}
    </div>
  );
}
