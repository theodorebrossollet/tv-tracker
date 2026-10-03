"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { addMovieToWatchlist, addToWatchlist } from "@/app/actions";
import { dismissSuggestion, loadCardDetails } from "@/app/discover-actions";
import {
  DiscoverCard,
  type DetailsState,
  type SwipeDirection,
} from "@/components/discover-card";
import { Poster } from "@/components/poster";
import { Select } from "@/components/select";
import { MIN_SEEDS } from "@/lib/discover-limits";
import type { DeckCard, DeckFilters } from "@/lib/discover-types";
import { formatAverage, formatRating } from "@/lib/ratings";

export interface DiscoverDeckProps {
  cards: DeckCard[];
  seedCount: number;
  recommendationsUnavailable: boolean;
  filters: DeckFilters;
  lists: Array<{ id: string; name: string }>;
}

const KINDS = [
  { value: "any", label: "Any" },
  { value: "movie", label: "Movie" },
  { value: "show", label: "Show" },
] as const;

/** TMDB movie and show ids overlap, so a card is only unique with its kind. */
const keyOf = (card: DeckCard) => `${card.kind}:${card.id}`;

function tagFor(card: DeckCard, filters: DeckFilters): string {
  if (card.source === "own") {
    return filters.listId ? "On this list" : "On your watchlist";
  }
  // A show seed's rating is its average, so it may be fractional.
  const rating = Number.isInteger(card.becauseRating)
    ? formatRating(card.becauseRating)
    : formatAverage(card.becauseRating);
  return `Recommended · because you rated ${card.becauseTitle} ★${rating}`;
}

/** The URL for a set of filters; defaults are left out. */
function filtersHref(filters: DeckFilters): string {
  const params = new URLSearchParams();
  if (filters.kind !== "any") params.set("kind", filters.kind);
  if (filters.short) params.set("short", "1");
  if (filters.listId) params.set("list", filters.listId);
  const query = params.toString();
  return query ? `/discover?${query}` : "/discover";
}

/**
 * The swipe deck.
 *
 * The cards are the server's, re-rendered on every filter change (a URL, not
 * state) and after every add or dismiss revalidates. The only client state is
 * what the server can't know: which cards this visit has already passed over.
 * That is a set of keys rather than an index into `cards`, because a
 * revalidation drops the card just dismissed or added — an index would then
 * skip the one after it.
 *
 * The choice error is plain state so it is still on screen after the request
 * settles, and a failed choice does not move the deck.
 */
export function DiscoverDeck({
  cards,
  seedCount,
  recommendationsUnavailable,
  filters,
  lists,
}: DiscoverDeckProps) {
  const router = useRouter();
  const [seen, setSeen] = useState<string[]>([]);
  const [tonight, setTonight] = useState<DeckCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [details, setDetails] = useState<Record<string, DetailsState>>({});

  // `pending` only disables the buttons once React has re-rendered; a swipe
  // can land before that, so the guard that counts is a ref.
  const inFlight = useRef(false);
  const detailsRequested = useRef(new Set<string>());

  const remaining = cards.filter((card) => !seen.includes(keyOf(card)));
  const current = remaining[0];
  const next = remaining[1];

  function setFilters(change: Partial<DeckFilters>) {
    router.replace(filtersHref({ ...filters, ...change }), { scroll: false });
  }

  function markSeen(card: DeckCard) {
    const key = keyOf(card);
    setSeen((keys) => (keys.includes(key) ? keys : [...keys, key]));
  }

  function choose(direction: SwipeDirection) {
    if (!current || inFlight.current) return;
    const card = current;
    setError(null);

    // Own cards are already on the watchlist: right means "watch this
    // tonight", left a session-only skip. Neither writes anything.
    if (card.source === "own") {
      if (direction === "right") setTonight(card);
      else markSeen(card);
      return;
    }

    inFlight.current = true;
    startTransition(async () => {
      try {
        const result =
          direction === "left"
            ? await dismissSuggestion(card.kind, card.id)
            : card.kind === "show"
              ? await addToWatchlist(card.id)
              : await addMovieToWatchlist(card.id);

        if (!result.ok) {
          setError(result.error ?? "Something went wrong. Please try again.");
          return;
        }
        markSeen(card);
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  function openDetails(card: DeckCard) {
    const key = keyOf(card);
    if (detailsRequested.current.has(key)) return;
    detailsRequested.current.add(key);

    setDetails((all) => ({ ...all, [key]: { status: "loading" } }));
    loadCardDetails(card.kind, card.id)
      .then(
        (result): DetailsState =>
          result.ok && result.details
            ? { status: "ok", details: result.details }
            : { status: "error" },
        (): DetailsState => ({ status: "error" }),
      )
      .then((state) => setDetails((all) => ({ ...all, [key]: state })));
  }

  function pickAnother() {
    if (tonight) markSeen(tonight);
    setTonight(null);
  }

  function refresh() {
    // Starting over: skipped own cards come back. Added and dismissed ones
    // don't, because the server no longer deals them.
    setSeen([]);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-[25px] font-semibold tracking-[-0.025em]">
        Discover
      </h1>

      <div className="mt-3 flex flex-wrap items-center gap-x-1.5">
        {KINDS.map(({ value, label }) => (
          <Chip
            key={value}
            pressed={filters.kind === value}
            onClick={() => setFilters({ kind: value })}
          >
            {label}
          </Chip>
        ))}
        <Chip
          pressed={filters.short}
          onClick={() => setFilters({ short: !filters.short })}
        >
          Under 2h
        </Chip>
        {lists.length > 0 ? (
          <Select
            aria-label="List"
            value={filters.listId ?? ""}
            onChange={(event) =>
              setFilters({ listId: event.target.value || null })
            }
            className="min-h-11"
          >
            <option value="">All to-watch</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {seedCount < MIN_SEEDS ? (
        <p className="mt-3 text-[13px] text-muted">
          Rate a few more titles to get recommendations
        </p>
      ) : null}
      {recommendationsUnavailable ? (
        <p className="mt-3 text-[13px] text-muted">
          Recommendations are unavailable right now.
        </p>
      ) : null}

      <div className="mt-4">
        {tonight ? (
          <Tonight card={tonight} onPickAnother={pickAnother} />
        ) : current ? (
          <>
            <div className="relative pt-3">
              {next ? <Peek card={next} /> : null}
              <DiscoverCard
                key={keyOf(current)}
                card={current}
                tag={tagFor(current, filters)}
                details={details[keyOf(current)]}
                onOpenDetails={() => openDetails(current)}
                onSwipe={choose}
                disabled={pending}
              />
            </div>

            {error ? (
              <p role="alert" className="mt-3 text-center text-xs text-danger">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex items-center justify-center gap-6">
              <button
                type="button"
                onClick={() => choose("left")}
                disabled={pending}
                aria-label="Not this one"
                className="flex size-14 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50"
              >
                <CrossIcon />
              </button>
              <button
                type="button"
                onClick={() => choose("right")}
                disabled={pending}
                aria-label={
                  current.source === "own" ? "Pick this one" : "Add to watchlist"
                }
                className="flex size-14 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-50"
              >
                <CheckIcon />
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-border px-6 py-10 text-center">
            <p className="font-semibold">{"You've seen them all"}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-4 min-h-[46px] rounded-full border border-border px-[22px] text-[15px] font-medium transition-colors hover:bg-surface"
            >
              Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    // A small pill inside 44px of hit area, as the header icons pad theirs.
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="flex min-h-11 items-center"
    >
      <span
        className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
          pressed
            ? "border-accent bg-accent text-on-accent"
            : "border-border text-muted hover:bg-surface hover:text-foreground"
        }`}
      >
        {children}
      </span>
    </button>
  );
}

/** The top edge of the next card, showing behind the current one. */
function Peek({ card }: { card: DeckCard }) {
  return (
    <div
      data-testid="next-card"
      aria-hidden="true"
      className="absolute inset-x-4 top-0 h-24 overflow-hidden rounded-2xl border border-border bg-surface px-3 pt-0.5 text-[11px] text-muted"
    >
      {card.title}
    </div>
  );
}

function Tonight({
  card,
  onPickAnother,
}: {
  card: DeckCard;
  onPickAnother: () => void;
}) {
  return (
    <section className="flex flex-col items-center rounded-2xl border border-border px-6 py-8 text-center">
      <Poster path={card.posterPath} name={card.title} width={160} />
      <h2 className="mt-4 text-xl font-semibold tracking-[-0.015em]">
        Tonight: {card.title}
      </h2>
      <Link
        href={`/${card.kind}/${card.id}`}
        className="mt-5 flex min-h-[46px] items-center rounded-full bg-accent px-[22px] text-[15px] font-semibold text-on-accent"
      >
        Open
      </Link>
      <button
        type="button"
        onClick={onPickAnother}
        className="mt-2 min-h-11 px-3 text-[13px] text-muted hover:text-foreground"
      >
        Pick another
      </button>
    </section>
  );
}

function CrossIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      aria-hidden="true"
      className="size-6"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-6"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
