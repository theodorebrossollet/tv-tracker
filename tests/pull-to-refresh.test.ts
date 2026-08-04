import { describe, expect, it } from "vitest";

import {
  classifyDrag,
  DIRECTION_SLOP,
  isVerticalPull,
  MAX_PULL,
  PULL_THRESHOLD,
  resist,
  shouldRefresh,
} from "@/lib/pull-to-refresh";

// The listener half of the gesture cannot be covered here — jsdom has no real
// touch and no real scroll. This is why the deciding is kept out of it: what
// counts as a pull, how far the strip follows, and when releasing fires are all
// answerable without a device, and they are where the bugs would be.

describe("how far the strip follows the finger", () => {
  it("damps the movement rather than matching it", () => {
    // 1:1 makes a short page feel like it has come loose from the screen.
    expect(resist(100)).toBeLessThan(100);
    expect(resist(100)).toBeGreaterThan(0);
  });

  it("caps however hard you pull", () => {
    expect(resist(10_000)).toBe(MAX_PULL);
  });

  it("ignores an upward drag", () => {
    // Dragging up at the top of the page is an overscroll, not a pull.
    expect(resist(-50)).toBe(0);
    expect(resist(0)).toBe(0);
  });

  it("can actually reach the threshold", () => {
    // A cap below the trigger point would make the gesture impossible while
    // every individual piece still looked reasonable.
    expect(MAX_PULL).toBeGreaterThan(PULL_THRESHOLD);
    expect(resist(PULL_THRESHOLD * 2)).toBeGreaterThanOrEqual(PULL_THRESHOLD);
  });
});

describe("when releasing refreshes", () => {
  it("fires at the threshold and beyond", () => {
    expect(shouldRefresh(PULL_THRESHOLD)).toBe(true);
    expect(shouldRefresh(PULL_THRESHOLD + 20)).toBe(true);
  });

  it("does nothing for a short pull", () => {
    expect(shouldRefresh(PULL_THRESHOLD - 1)).toBe(false);
    expect(shouldRefresh(0)).toBe(false);
  });
});

describe("telling a pull from a swipe", () => {
  it("accepts a clearly downward drag", () => {
    expect(isVerticalPull(0, 60)).toBe(true);
    expect(isVerticalPull(5, 60)).toBe(true);
  });

  it("rejects a sideways one", () => {
    // The show page's season strip scrolls horizontally and sits near the top.
    // Without this, flicking between seasons triggers a TMDB re-sync.
    expect(isVerticalPull(60, 0)).toBe(false);
    expect(isVerticalPull(-60, 10)).toBe(false);
  });

  it("rejects a diagonal, which should scroll", () => {
    // Equal parts down and across is not a pull. Requiring "more down than
    // across" would catch it; requiring clearly more does not.
    expect(isVerticalPull(40, 40)).toBe(false);
    expect(isVerticalPull(40, 50)).toBe(false);
  });

  it("rejects an upward drag however straight", () => {
    expect(isVerticalPull(0, -60)).toBe(false);
  });
});

describe("committing to a direction", () => {
  it("waits until the finger has meant it", () => {
    // A finger settling on the glass wobbles a few pixels. Deciding from that
    // would make the gesture fire on taps.
    expect(classifyDrag(0, 0)).toBe("undecided");
    expect(classifyDrag(2, 3)).toBe("undecided");
    expect(classifyDrag(DIRECTION_SLOP - 1, DIRECTION_SLOP - 1)).toBe(
      "undecided",
    );
  });

  it("commits to pulling once it is clearly downward", () => {
    expect(classifyDrag(0, DIRECTION_SLOP + 5)).toBe("pulling");
  });

  it("abandons a drag that started sideways", () => {
    // "abandoned" rather than "undecided" is the load-bearing part: a swipe
    // that curves downwards halfway through must not turn into a refresh under
    // the reader's thumb, so the ruling has to be final.
    expect(classifyDrag(DIRECTION_SLOP + 5, 0)).toBe("abandoned");
    expect(classifyDrag(40, 20)).toBe("abandoned");
  });

  it("abandons an upward drag rather than leaving it open", () => {
    expect(classifyDrag(0, -(DIRECTION_SLOP + 5))).toBe("abandoned");
  });
});
