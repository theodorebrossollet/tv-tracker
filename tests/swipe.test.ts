import { describe, expect, it } from "vitest";
import {
  LOCK_SLOP,
  SWIPE_THRESHOLD,
  lockAxis,
  swipeOutcome,
  tilt,
} from "@/lib/swipe";

describe("constants", () => {
  it("uses the agreed values", () => {
    expect(SWIPE_THRESHOLD).toBe(96);
    expect(LOCK_SLOP).toBe(10);
  });
});

describe("lockAxis", () => {
  it("is undecided at rest and under the slop", () => {
    expect(lockAxis(0, 0)).toBe("undecided");
    expect(lockAxis(9, 0)).toBe("undecided");
    expect(lockAxis(0, 9)).toBe("undecided");
  });

  it("needs to exceed the slop, not merely reach it", () => {
    expect(lockAxis(10, 0)).toBe("undecided");
    expect(lockAxis(0, 10)).toBe("undecided");
    expect(lockAxis(11, 0)).toBe("horizontal");
  });

  it("locks horizontal when clearly sideways", () => {
    expect(lockAxis(11, 2)).toBe("horizontal");
  });

  it("locks vertical when the drag is only a bit more sideways than down", () => {
    expect(lockAxis(11, 9)).toBe("vertical");
    expect(lockAxis(2, 40)).toBe("vertical");
  });

  it("needs strictly more than 1.5x to count as horizontal", () => {
    expect(lockAxis(30, 20)).toBe("vertical");
    expect(lockAxis(31, 20)).toBe("horizontal");
  });

  it("is symmetric in sign", () => {
    expect(lockAxis(-9, 0)).toBe("undecided");
    expect(lockAxis(-11, -2)).toBe("horizontal");
    expect(lockAxis(-11, 9)).toBe("vertical");
    expect(lockAxis(11, -9)).toBe("vertical");
    expect(lockAxis(-2, -40)).toBe("vertical");
  });

  it("never locks horizontal on non-finite input", () => {
    expect(lockAxis(NaN, 0)).not.toBe("horizontal");
    expect(lockAxis(Infinity, 0)).not.toBe("horizontal");
    expect(lockAxis(50, NaN)).not.toBe("horizontal");
    expect(lockAxis(NaN, NaN)).toBe("undecided");
  });
});

describe("swipeOutcome", () => {
  it("fires at exactly the threshold in either direction", () => {
    expect(swipeOutcome(96)).toBe("right");
    expect(swipeOutcome(-96)).toBe("left");
  });

  it("does nothing just under the threshold", () => {
    expect(swipeOutcome(95)).toBe("none");
    expect(swipeOutcome(-95)).toBe("none");
    expect(swipeOutcome(0)).toBe("none");
  });

  it("fires past the threshold", () => {
    expect(swipeOutcome(400)).toBe("right");
    expect(swipeOutcome(-400)).toBe("left");
  });

  it("never fires on non-finite input", () => {
    expect(swipeOutcome(NaN)).toBe("none");
    expect(swipeOutcome(Infinity)).toBe("none");
    expect(swipeOutcome(-Infinity)).toBe("none");
  });
});

describe("tilt", () => {
  it("is 0 at 0 (and never -0)", () => {
    expect(Object.is(tilt(0), 0)).toBe(true);
  });

  it("is signed with the drag", () => {
    expect(tilt(50)).toBeGreaterThan(0);
    expect(tilt(-50)).toBeLessThan(0);
    expect(tilt(-50)).toBe(-tilt(50));
  });

  it("is damped, not 1:1", () => {
    expect(tilt(50)).toBeLessThan(50);
  });

  it("is capped at 12 degrees either way", () => {
    expect(tilt(10000)).toBe(12);
    expect(tilt(-10000)).toBe(-12);
    expect(Math.abs(tilt(SWIPE_THRESHOLD))).toBeLessThanOrEqual(12);
  });

  it("is 0 for non-finite input", () => {
    expect(tilt(NaN)).toBe(0);
    expect(tilt(Infinity)).toBe(0);
    expect(tilt(-Infinity)).toBe(0);
  });
});
