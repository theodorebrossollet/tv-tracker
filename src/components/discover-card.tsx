"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";

import { Trailer } from "@/components/trailer";
import type { CardDetails, DeckCard } from "@/lib/discover-types";
import { formatRuntime } from "@/lib/format";
import { posterUrl } from "@/lib/images";
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
  // A drag that began on the poster or title must not also count as a tap on
  // the link they sit in. Set once a gesture turns horizontal, cleared when the
  // next one starts.
  const suppressClick = useRef(false);

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
    suppressClick.current = false;
  }

  function onClickCapture(event: React.MouseEvent) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
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
      onClickCapture,
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
      // A column that fills the height the deck gives it: the poster takes
      // whatever is left after the text, so the whole card (and the buttons
      // under it) fit one screen with no scrolling. Opened details replace the
      // poster and scroll inside the card instead.
      className={`relative z-10 flex min-h-0 flex-1 touch-pan-y flex-col rounded-3xl bg-surface p-2.5 shadow-[0_18px_40px_rgba(0,0,0,.5)] ${
        dragging ? "" : "transition-[transform,opacity] duration-200"
      }`}
    >
      {/* The poster and title open the title's page. The Details button below
          is not part of the link, so each does its own thing. */}
      <Link
        href={`/${card.kind}/${card.id}`}
        aria-label={`Open ${card.title}`}
        className={`flex min-h-0 flex-col ${expanded ? "shrink-0" : "flex-1"}`}
      >
        {expanded ? null : <CardPoster path={card.posterPath} title={card.title} />}

        <div className={`shrink-0 px-1 ${expanded ? "" : "mt-3"}`}>
          <h2 className="text-2xl leading-tight font-bold tracking-[-0.03em]">
            {card.title}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">{meta}</p>
        </div>
      </Link>

      <div className="shrink-0 px-1">
        <p className="mt-2 text-[13px] text-muted">{tag}</p>

        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="-mx-1 mt-1 flex min-h-11 items-center px-1 text-[13px] font-medium text-muted hover:text-foreground"
        >
          Details
        </button>
      </div>

      {expanded ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          <DetailsPanel state={details} title={card.title} />
        </div>
      ) : null}
    </article>
  );
}

/**
 * The poster, as large as the room allows, on a blurred copy of itself.
 *
 * The room is rarely 2:3, and cropping a poster to fill it cuts its title
 * art, so the poster keeps its shape — a 2:3 box as tall as the room, never
 * wider than the card — and the blurred copy fills the rest of the panel, the
 * way the TV app frames artwork that doesn't match its slot. A title with no
 * poster gets the same panel, empty, so the card doesn't jump.
 */
function CardPoster({ path, title }: { path: string | null; title: string }) {
  const url = posterUrl(path, "w342");

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-surface-raised">
      {url ? (
        <Image
          src={url}
          alt=""
          aria-hidden="true"
          fill
          sizes="160px"
          className="scale-125 object-cover opacity-60 blur-2xl"
        />
      ) : null}
      <div className="relative mx-auto aspect-[2/3] h-full max-w-full overflow-hidden rounded-xl shadow-[0_12px_30px_rgba(0,0,0,.55)]">
        {url ? (
          <Image
            src={url}
            alt={`Poster for ${title}`}
            fill
            sizes="(max-width: 448px) 70vw, 300px"
            className="object-cover"
            priority
          />
        ) : (
          <span className="flex size-full items-center justify-center text-[11px] text-muted">
            No poster
          </span>
        )}
      </div>
    </div>
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
