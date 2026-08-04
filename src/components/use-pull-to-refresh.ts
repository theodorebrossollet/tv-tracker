"use client";

import { useEffect, useRef, useState } from "react";

import {
  classifyDrag,
  resist,
  shouldRefresh,
  type PullDecision,
} from "@/lib/pull-to-refresh";

interface Options {
  onRefresh: () => void;
  /** Set while a refresh is already running, so a second pull does nothing. */
  disabled: boolean;
}

/**
 * The touch half of pull-to-refresh.
 *
 * Deliberately thin: everything it decides comes from `lib/pull-to-refresh.ts`,
 * which is tested. What is here is listener plumbing, and it has no automated
 * coverage — jsdom has no real touch and no real scroll, so this is the one
 * piece of the app that can only be checked on a device.
 *
 * Three things it has to get right, each a real hazard rather than a
 * hypothetical:
 *
 *   - Only start at the very top of the page. Mid-list, a downward drag is a
 *     scroll, and stealing it would make the app feel broken.
 *   - Commit to a direction once, and never revisit it. A sideways swipe along
 *     the season strip that curves downwards must not become a refresh.
 *   - `touchmove` must be non-passive, because the pull calls `preventDefault`
 *     to stop the page scrolling underneath it. That costs scroll performance,
 *     so the handler bails on the first line unless a pull is under way.
 */
export function usePullToRefresh({ onRefresh, disabled }: Options) {
  const [distance, setDistance] = useState(0);

  // Refs rather than state: these change many times per gesture and none of
  // them should cause a render on their own.
  const startX = useRef(0);
  const startY = useRef(0);
  const decision = useRef<PullDecision>("undecided");
  const tracking = useRef(false);

  // The listeners are attached once, so anything they read has to come from a
  // ref — a closure would capture the first render's values and keep them.
  //
  // `distanceRef` is written only by the handlers below, never during render:
  // they are the only thing that moves it, and it is the authority mid-gesture
  // while `distance` exists purely to redraw the strip.
  const distanceRef = useRef(0);
  const latest = useRef({ onRefresh, disabled });

  // In an effect rather than inline, because writing a ref during render is
  // exactly the impurity React's rules exist to catch — the render could be
  // thrown away and re-run, leaving the ref describing a render that never was.
  useEffect(() => {
    latest.current = { onRefresh, disabled };
  });

  useEffect(() => {
    function reset() {
      tracking.current = false;
      decision.current = "undecided";
      distanceRef.current = 0;
      setDistance(0);
    }

    function onTouchStart(event: TouchEvent) {
      // A second finger mid-pull is a pinch, not a pull.
      if (event.touches.length !== 1) {
        reset();
        return;
      }

      // `scrollY > 0` means there is page above to scroll back to, and that is
      // what a downward drag should do.
      if (window.scrollY > 0 || latest.current.disabled) return;

      const touch = event.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      decision.current = "undecided";
      tracking.current = true;
    }

    function onTouchMove(event: TouchEvent) {
      if (!tracking.current || decision.current === "abandoned") return;

      if (event.touches.length !== 1) {
        reset();
        return;
      }

      const touch = event.touches[0];
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;

      if (decision.current === "undecided") {
        decision.current = classifyDrag(dx, dy);
        if (decision.current !== "pulling") return;
      }

      // The page scrolled away under the finger — let it, and stand down.
      if (window.scrollY > 0) {
        reset();
        return;
      }

      // Allowed because the listener is non-passive. Without it the page
      // scrolls and rubber-bands at the same time as the strip moves.
      event.preventDefault();

      const pulled = resist(dy);
      distanceRef.current = pulled;
      setDistance(pulled);
    }

    function onTouchEnd() {
      if (!tracking.current) return;

      // Both read before `reset` clears them.
      const pulled = distanceRef.current;
      const wasPulling = decision.current === "pulling";

      reset();

      if (wasPulling && shouldRefresh(pulled)) latest.current.onRefresh();
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", reset);

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", reset);
    };
  }, []);

  return distance;
}
