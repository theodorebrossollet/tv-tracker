/**
 * The arithmetic behind the pull-to-refresh gesture, kept apart from the DOM
 * wiring that drives it.
 *
 * The split is the point. jsdom has neither real touch nor real scroll, so the
 * listener half genuinely cannot be covered — it needs a device. Everything
 * that *decides* something lives here instead, where it can be tested properly:
 * how far the strip follows the finger, whether a drag counts as a pull at all,
 * and when releasing should fire. What is left in the component is
 * `addEventListener` and a few `useState` calls.
 */

/** How far you must pull before releasing triggers a refresh. */
export const PULL_THRESHOLD = 70;

/** The furthest the strip will travel, however hard you pull. */
export const MAX_PULL = 110;

/**
 * How far to move the strip for a finger that has travelled `dy`.
 *
 * Damped rather than 1:1, and capped. Following the finger exactly makes a
 * short list feel like it has come loose from the screen, and the cap is what
 * stops a long drag from pushing the whole page off the bottom.
 */
export function resist(dy: number): number {
  if (dy <= 0) return 0;

  return Math.min(MAX_PULL, dy * 0.5);
}

/** Whether a pull this far should refresh when the finger lifts. */
export function shouldRefresh(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}

/**
 * Whether a drag is vertical enough to be a pull rather than a sideways swipe.
 *
 * The show page's season strip scrolls horizontally and sits near the top, so
 * without this a thumb flicking between seasons triggers a TMDB re-sync. The
 * 1.5 ratio means a drag has to be clearly downwards, not merely more down
 * than across — a diagonal should scroll, not refresh.
 */
export function isVerticalPull(dx: number, dy: number): boolean {
  return dy > 0 && dy > Math.abs(dx) * 1.5;
}

/**
 * Whether a drag has moved far enough to commit to being one thing or another.
 *
 * Below this, direction is mostly noise: a finger settling on the glass wobbles
 * a few pixels, and deciding from that would make the gesture fire on taps.
 */
export const DIRECTION_SLOP = 8;

export type PullDecision = "undecided" | "pulling" | "abandoned";

/**
 * Classifies a drag once it has travelled far enough to mean something.
 *
 * Returning "abandoned" rather than "not pulling" matters: once a drag has been
 * ruled out it must stay ruled out for the rest of the gesture, or a sideways
 * swipe that curves downwards halfway through turns into a refresh under the
 * reader's thumb.
 */
export function classifyDrag(dx: number, dy: number): PullDecision {
  if (Math.abs(dx) < DIRECTION_SLOP && Math.abs(dy) < DIRECTION_SLOP) {
    return "undecided";
  }

  return isVerticalPull(dx, dy) ? "pulling" : "abandoned";
}
