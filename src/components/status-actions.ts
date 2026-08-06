import {
  addToWatchlist,
  pauseShow,
  removeShow,
  resumeShow,
  stopShow,
} from "@/app/actions";
import type { ActionResult } from "@/lib/action-result";
import type { StatusTarget } from "@/lib/status-transitions";

/**
 * The action that moves a show to each status.
 *
 * A map rather than a chain of conditionals inside the sheet, so the pairing
 * is a value a test can drive. `tests/status-transitions.test.ts` walks every
 * status the sheet offers and checks the action behind it actually lands there
 * — and that the ones it withholds really are refused. Those guards live in
 * `actions.ts` and the sheet only mirrors them; without the test the two drift
 * silently, and the symptom is a row that does nothing when tapped.
 *
 * Kept apart from `status-transitions.ts` because that module is pure and this
 * one reaches the server actions, which drag Prisma in behind them.
 */
export const STATUS_ACTIONS: Record<
  StatusTarget,
  (showId: string) => Promise<ActionResult>
> = {
  watchlist: addToWatchlist,
  // Not a separate "un-pause": resuming is the same move from either
  // set-aside state, and `resumeShow` accepts both.
  watching: resumeShow,
  paused: pauseShow,
  stopped: stopShow,
  remove: removeShow,
};
