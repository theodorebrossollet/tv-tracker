/**
 * The arithmetic behind the Discover card swipe, kept apart from the DOM
 * wiring that drives it.
 *
 * Same split as `pull-to-refresh.ts`: jsdom has neither real touch nor real
 * scroll, so the pointer-listener half genuinely cannot be covered — it needs
 * a device. Everything that *decides* something lives here instead: whether a
 * drag is a swipe or a scroll, whether releasing commits a choice, and how far
 * the card leans. Nothing here touches the DOM, and nothing is imported.
 */

/** How far (px) the card must travel sideways before releasing commits. */
export const SWIPE_THRESHOLD = 96;

/** How far (px) a drag must move on either axis before its direction counts. */
export const LOCK_SLOP = 10;

/** The most the card will lean, in degrees, however far it is dragged. */
const MAX_TILT = 12;

export type SwipeAxis = "undecided" | "horizontal" | "vertical";

/**
 * Decides whether a drag is a swipe or a scroll, from its travel so far.
 *
 * Undecided until either axis has moved past the slop, since a finger settling
 * on the glass wobbles a few pixels. After that it is horizontal only when
 * clearly sideways (more than 1.5x the vertical travel); anything else is
 * vertical so a diagonal scrolls the page rather than throwing the card.
 * Non-finite input stays undecided rather than guessing.
 */
export function lockAxis(dx: number, dy: number): SwipeAxis {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "undecided";

  const ax = Math.abs(dx);
  const ay = Math.abs(dy);

  if (ax <= LOCK_SLOP && ay <= LOCK_SLOP) return "undecided";

  return ax > ay * 1.5 ? "horizontal" : "vertical";
}

/**
 * What releasing the card at horizontal offset `dx` should do.
 *
 * Right is a like, left a pass. Anything short of the threshold springs back,
 * and a non-finite offset must never commit a choice.
 */
export function swipeOutcome(dx: number): "right" | "left" | "none" {
  if (!Number.isFinite(dx)) return "none";
  if (dx >= SWIPE_THRESHOLD) return "right";
  if (dx <= -SWIPE_THRESHOLD) return "left";

  return "none";
}

/**
 * How many degrees to lean the card for a drag of `dx`.
 *
 * Damped to a tenth of a degree per pixel and capped, so a long drag tips the
 * card a little rather than spinning it. Non-finite input is flat (0), never
 * NaN, which would blank the card's transform.
 */
export function tilt(dx: number): number {
  if (!Number.isFinite(dx) || dx === 0) return 0;

  return Math.max(-MAX_TILT, Math.min(MAX_TILT, dx / 10));
}
