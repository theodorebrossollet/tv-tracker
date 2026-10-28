/**
 * The arithmetic behind swiping a Watching card to mark its next episode
 * watched, kept apart from the touch wiring for the same reason as `swipe.ts`:
 * jsdom has no real touch, so what decides something lives here, where it can
 * be tested. Direction locking is shared with the Discover card (`lockAxis`).
 *
 * Rightward only, like "mark as read" in Mail: the leading edge is the action,
 * and a leftward drag does nothing.
 */

/** How far (px) the card must travel right before releasing marks it. */
export const ROW_COMMIT = 88;

/**
 * Past this the card follows the finger at a third of the speed, so a long
 * drag says "that's enough" instead of throwing the card off the screen.
 */
const ROW_FREE_TRAVEL = 132;

/**
 * Where the card sits for a drag of `dx`. Never left of its resting place, and
 * never NaN, which would blank the transform.
 */
export function rowOffset(dx: number): number {
  if (!Number.isFinite(dx) || dx <= 0) return 0;
  if (dx <= ROW_FREE_TRAVEL) return dx;

  return ROW_FREE_TRAVEL + (dx - ROW_FREE_TRAVEL) / 3;
}

/** Whether releasing at `dx` marks the episode. */
export function rowCommits(dx: number): boolean {
  return Number.isFinite(dx) && dx >= ROW_COMMIT;
}
