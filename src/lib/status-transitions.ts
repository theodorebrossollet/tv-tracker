import type { TrackStatus } from "@/lib/types";

// Which status changes the app can actually make, kept apart from the sheet
// that renders them so the rules can be tested without React.
//
// The redesign's handoff draws the status sheet as a free choice among all five
// values, but the actions behind it implement a much narrower graph and always
// have — `setAside` refuses anything that isn't already started, `resumeShow`
// refuses anything that isn't set aside, and `addToWatchlist` returns early for
// a show that is already tracked rather than demoting it. Offering the full
// matrix would mean roughly a third of the rows silently doing nothing or
// returning an error string into a sheet with nowhere to show it.
//
// So the sheet offers what exists. The rule the missing rows imply — that a
// show becomes "watching" by watching something, not by being told to — is
// stated in the sheet's caption instead of being discovered as a dead row.

/** A status the user can move a show *to*, plus removal. */
export type StatusTarget = TrackStatus | "remove";

/**
 * The statuses reachable from `status`, in the order they should be listed.
 *
 * Excludes the current value: the sheet renders that separately as the checked
 * row, so a target appearing here is always a real change.
 *
 * Deliberately empty for "watchlist" — a show that has never been started can
 * only be removed. It can't be paused or stopped (`setAside` requires a started
 * show, and pausing something you never began is what the watchlist already
 * is), and it can't be moved to "watching" without marking an episode, because
 * `demoteIfNothingWatched` would put it straight back.
 */
export function statusTargets(status: TrackStatus | null): TrackStatus[] {
  switch (status) {
    case null:
      return ["watchlist"];
    case "watchlist":
      return [];
    case "watching":
      return ["paused", "stopped"];
    case "paused":
      return ["watching", "stopped"];
    case "stopped":
      return ["watching", "paused"];
  }
}

/**
 * Whether to explain how a show reaches "watching".
 *
 * Only worth saying where "Watching" is absent from the list *and* the show
 * isn't already there — those are exactly the cases where someone opens the
 * sheet looking for it. Saying it on a show that is already watching would be
 * answering a question nobody asked.
 */
export function explainsPromotion(status: TrackStatus | null): boolean {
  return status === null || status === "watchlist";
}
