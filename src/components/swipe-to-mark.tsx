"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";

import { markEpisodeWatched } from "@/app/actions";
import { lockAxis, type SwipeAxis } from "@/lib/swipe";
import { ROW_COMMIT, rowCommits, rowOffset } from "@/lib/swipe-row";

interface SwipeToMarkProps {
  /** The episode a swipe marks; null when there is none (caught up). */
  episodeId: string | null;
  /** The card's own classes: border, surface, padding, layout. */
  className: string;
  children: React.ReactNode;
}

/**
 * A Watching card that marks its next episode watched when swiped right.
 *
 * A shortcut beside the ✓ button, not a replacement: the button is the one a
 * keyboard, a screen reader or a pointer can reach. Everything that decides
 * something is in `lib/swipe-row.ts`; this is plumbing, built the way the
 * Discover card's is — React's touch handlers and `touch-action: pan-y`, so the
 * browser keeps vertical scrolling and a drag that locks vertical just scrolls.
 * The touch half has no automated coverage and needs a device.
 *
 * Like the button, it marks and waits: the card springs back and dims while
 * the action runs, and the server's next render brings the following episode.
 * Nothing removes or advances the card under the thumb.
 */
export function SwipeToMark({
  episodeId,
  className,
  children,
}: SwipeToMarkProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Derived from the transition rather than copied into state: the server
  // re-renders the card when the action lands, and that is what clears it.
  const [marked, setMarked] = useOptimistic(false);
  const [pending, startTransition] = useTransition();

  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<SwipeAxis>("undecided");
  const latest = useRef(0);
  // The card's title is a link stretched over the whole card, so a swipe would
  // otherwise end in a tap on it and open the show.
  const suppressClick = useRef(false);

  const disabled = episodeId === null || pending;

  function reset() {
    start.current = null;
    axis.current = "undecided";
    latest.current = 0;
    setOffset(0);
    setDragging(false);
  }

  function onTouchStart(event: React.TouchEvent) {
    if (disabled || event.touches.length !== 1) {
      reset();
      return;
    }
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY };
    axis.current = "undecided";
    latest.current = 0;
    suppressClick.current = false;
  }

  function onTouchMove(event: React.TouchEvent) {
    if (!start.current || axis.current === "vertical") return;
    if (event.touches.length !== 1) {
      reset();
      return;
    }

    const touch = event.touches[0];
    const dx = touch.clientX - start.current.x;
    const dy = touch.clientY - start.current.y;

    if (axis.current === "undecided") {
      axis.current = lockAxis(dx, dy);
      if (axis.current !== "horizontal") return;
    }

    suppressClick.current = true;
    latest.current = dx;
    setOffset(rowOffset(dx));
    setDragging(true);
  }

  function onTouchEnd() {
    if (!start.current) return;

    const wasHorizontal = axis.current === "horizontal";
    const dx = latest.current;
    reset();

    if (!wasHorizontal || !episodeId || !rowCommits(dx)) return;

    startTransition(async () => {
      setMarked(true);
      await markEpisodeWatched(episodeId);
    });
  }

  function onClickCapture(event: React.MouseEvent) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  // The action behind the card, drawn only while there is a gap to see it
  // through: at rest the card's rounded corners would otherwise show a rim of
  // accent where the two edges antialias.
  const armed = offset >= ROW_COMMIT;

  return (
    // Clipped sideways so a card pulled past the screen edge can't widen the
    // page and let it scroll horizontally.
    <li className="relative overflow-x-clip">
      {offset > 0 ? (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center gap-2 rounded-[15px] pl-5 text-[13px] font-semibold transition-colors ${
            armed ? "bg-accent text-on-accent" : "bg-accent-tint text-accent-deep"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
          >
            <path d="m5 13 4 4L19 7" />
          </svg>
          Watched
        </div>
      ) : null}

      <div
        data-testid="swipe-card"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={reset}
        onClickCapture={onClickCapture}
        style={offset !== 0 ? { transform: `translateX(${offset}px)` } : undefined}
        className={`relative touch-pan-y ${className} ${
          dragging ? "" : "transition-[transform,opacity] duration-200"
        } ${marked ? "opacity-60" : ""}`}
      >
        {children}
      </div>
    </li>
  );
}
