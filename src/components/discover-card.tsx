"use client";

import { useRef, useState } from "react";

import { Poster } from "@/components/poster";
import { Trailer } from "@/components/trailer";
import type { CardDetails, DeckCard } from "@/lib/discover-types";
import { formatRuntime } from "@/lib/format";
import { lockAxis, swipeOutcome, tilt, type SwipeAxis } from "@/lib/swipe";

export type SwipeDirection = "left" | "right";

/** Where a card's lazily loaded detail is; absent means never asked for. */
export type DetailsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; details: CardDetails };

/**
 * The touch half of the card swipe.
 *
 * Every decision comes from `lib/swipe.ts`; what is here is plumbing. Unlike
 * `usePullToRefresh` it uses React's own handlers on the card rather than
 * document listeners, and it never calls `preventDefault`: the card carries
 * `touch-action: pan-y`, so the browser owns vertical panning and hands
 * horizontal movement to us without being told to. That is what lets a
 * vertical lock simply do nothing and the page scroll as usual — and it is
 * also why the passive listeners React attaches are enough.
 *
 * The axis is locked once per gesture and never revisited, so a scroll that
 * drifts sideways can't turn into a swipe halfway through.
 *
 * A committed swipe holds the card off to the side (`flung`) until `onSwipe`
 * settles: on success the deck moves on and this card unmounts; only a
 * failure brings it back to centre. Resetting first made a successful swipe
 * look as if it had bounced.
 */
function useSwipe({
  onSwipe,
  disabled,
}: {
  onSwipe: (direction: SwipeDirection) => Promise<boolean>;
  disabled: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [flung, setFlung] = useState<SwipeDirection | null>(null);
  const [dragging, setDragging] = useState(false);

  // Refs: these change on every move event and must not wait for a render.
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<SwipeAxis>("undecided");
  const latest = useRef(0);

  function reset() {
    start.current = null;
    axis.current = "undecided";
    latest.current = 0;
    setOffset(0);
    setDragging(false);
  }

  function onTouchStart(event: React.TouchEvent) {
    // A second finger is a pinch; a pending choice ignores new swipes.
    if (disabled || event.touches.length !== 1) {
      reset();
      return;
    }
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY };
    axis.current = "undecided";
    latest.current = 0;
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

    latest.current = dx;
    setOffset(dx);
    setDragging(true);
  }

  function onTouchEnd() {
    if (!start.current) return;

    // Read before `reset` clears them.
    const wasHorizontal = axis.current === "horizontal";
    const dx = latest.current;
    reset();

    if (!wasHorizontal || disabled) return;
    const outcome = swipeOutcome(dx);
    if (outcome === "none") return;
    setFlung(outcome);
    void onSwipe(outcome).then((advanced) => {
      if (!advanced) setFlung(null);
    });
  }

  return {
    offset,
    flung,
    dragging,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset,
    },
  };
}

interface DiscoverCardProps {
  card: DeckCard;
  /** "On your watchlist", "Recommended · because you rated …". */
  tag: string;
  details: DetailsState | undefined;
  onOpenDetails: () => void;
  /** Resolves true when the deck moved on, false when the card stays. */
  onSwipe: (direction: SwipeDirection) => Promise<boolean>;
  /** A choice is pending: swipes are ignored until it settles. */
  disabled: boolean;
}

export function DiscoverCard({
  card,
  tag,
  details,
  onOpenDetails,
  onSwipe,
  disabled,
}: DiscoverCardProps) {
  const { offset, flung, dragging, handlers } = useSwipe({
    onSwipe,
    disabled,
  });
  const [expanded, setExpanded] = useState(false);

  function toggle() {
    if (!expanded) onOpenDetails();
    setExpanded(!expanded);
  }

  const meta = [card.kind === "movie" ? "Movie" : "Show", card.year]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      data-testid="current-card"
      {...handlers}
      style={
        flung
          ? {
              transform:
                flung === "right"
                  ? "translateX(120%) rotate(12deg)"
                  : "translateX(-120%) rotate(-12deg)",
              opacity: 0,
            }
          : offset !== 0
            ? {
                transform: `translateX(${offset}px) rotate(${tilt(offset)}deg)`,
              }
            : undefined
      }
      className={`relative z-10 touch-pan-y rounded-2xl border border-border bg-background p-3 shadow-sm ${
        dragging ? "" : "transition-[transform,opacity] duration-200"
      }`}
    >
      <Poster
        path={card.posterPath}
        name={card.title}
        width={300}
        className="mx-auto h-auto w-full max-w-[300px]"
      />

      <div className="mt-3 px-1">
        <h2 className="text-xl font-semibold tracking-[-0.015em]">
          {card.title}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted">{meta}</p>
        <p className="mt-2 text-[13px] text-muted">{tag}</p>

        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="-mx-1 mt-1 flex min-h-11 items-center px-1 text-[13px] font-medium text-muted hover:text-foreground"
        >
          Details
        </button>

        {expanded ? <DetailsPanel state={details} title={card.title} /> : null}
      </div>
    </article>
  );
}

function DetailsPanel({
  state,
  title,
}: {
  state: DetailsState | undefined;
  title: string;
}) {
  if (!state || state.status === "loading") {
    return <p className="pb-2 text-[13px] text-muted">Loading…</p>;
  }
  if (state.status === "error") {
    // Quiet on purpose: the card still works without its extras.
    return (
      <p className="pb-2 text-[13px] text-muted">{"Couldn't load details"}</p>
    );
  }

  const { overview, genres, runtime, cast, trailerKey, providers } =
    state.details;
  const facts = [genres, runtime ? formatRuntime(runtime) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-2 pb-2 text-[13px] leading-relaxed">
      {overview ? <p>{overview}</p> : null}
      {facts ? <p className="text-muted">{facts}</p> : null}
      {cast.length > 0 ? (
        <p className="text-muted">
          With{" "}
          {cast
            .slice(0, 6)
            .map((person) => person.name)
            .join(", ")}
        </p>
      ) : null}
      {providers.length > 0 ? (
        <p className="text-muted">Streaming on {providers.join(", ")}</p>
      ) : null}
      {trailerKey ? (
        <Trailer
          options={[
            { id: "main", label: "Trailer", videoKey: trailerKey, name: title },
          ]}
          showName={title}
        />
      ) : null}
    </div>
  );
}
