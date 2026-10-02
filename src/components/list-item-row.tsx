"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import { removeFromList, setListItemWatched } from "@/app/list-actions";
import { KindBadge } from "@/components/kind-badge";
import { MarkMovieWatchedButton } from "@/components/mark-movie-watched-button";
import { Poster } from "@/components/poster";
import { RatingValue } from "@/components/rating-value";
import { Sheet } from "@/components/sheet";
import { StatusBadge } from "@/components/status-badge";
import { CheckIcon } from "@/components/status-sheet";
import type { ListItemView } from "@/lib/queries";

interface ListItemRowProps {
  listId: string;
  trackSeparately: boolean;
  item: ListItemView;
}

/**
 * One title on a list.
 *
 * Personal list: the row shows the account's real status, and a movie not yet
 * watched can be marked watched in the Library. A show has no control here —
 * its progress lives on its page.
 *
 * Together list: every row carries the list's own tick, independent of the
 * real status (which is only noted, as "You've seen this").
 */
export function ListItemRow({
  listId,
  trackSeparately,
  item,
}: ListItemRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Derived from the prop: the server can change the tick (another tab), and
  // a `useState` copy would keep showing the old one.
  const [ticked, setTicked] = useOptimistic(item.tickedAt !== null);

  const quiet = item.watched;
  const href = `${item.kind === "movie" ? "/movie" : "/show"}/${item.titleId}`;
  const seen =
    item.kind === "movie" ? item.status === "watched" : item.finished;

  function toggleTick() {
    setError(null);

    startTransition(async () => {
      setTicked(!ticked);
      const result = await setListItemWatched(listId, item.itemId, !ticked);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  function remove() {
    setError(null);
    setMenuOpen(false);

    startTransition(async () => {
      const result = await removeFromList(listId, item.itemId);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <li
      className={`relative rounded-[15px] border border-border p-[11px] transition-colors ${
        quiet ? "bg-surface-sunken" : "bg-surface"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Poster path={item.posterPath} name={item.title} width={44} />
          <KindBadge kind={item.kind === "movie" ? "movie" : "tv"} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <Link
            href={href}
            className={`truncate text-[15px] font-medium tracking-[-0.01em] after:absolute after:inset-0 after:content-[''] ${
              quiet ? "text-muted" : ""
            }`}
          >
            {item.title}
          </Link>

          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {item.year ? <span>{item.year}</span> : null}
            {!trackSeparately ? (
              item.kind === "show" && item.finished ? (
                // A finished show sits under "Watched"; its status is still
                // "watching", which would read as a contradiction.
                <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted">
                  Finished
                </span>
              ) : (
                <StatusBadge status={item.status} />
              )
            ) : null}
            {trackSeparately && seen ? (
              <span>You&apos;ve seen this</span>
            ) : null}
            {item.rating !== null ? (
              <RatingValue
                value={item.rating}
                average={item.kind === "show"}
              />
            ) : null}
          </span>
        </div>

        {trackSeparately ? (
          <button
            type="button"
            onClick={toggleTick}
            disabled={pending}
            aria-pressed={ticked}
            aria-label="Watched together"
            className="relative flex size-11 shrink-0 items-center justify-center disabled:opacity-60"
          >
            <span
              className={`flex size-7 items-center justify-center rounded-full border ${
                ticked
                  ? "border-accent bg-accent text-on-accent"
                  : "border-border text-transparent"
              }`}
            >
              <CheckIcon className="size-3.5" />
            </span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label={`Options for ${item.title}`}
          aria-haspopup="dialog"
          className="relative -m-1.5 flex size-11 shrink-0 items-center justify-center"
        >
          <span className="flex size-8 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface hover:text-foreground">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="size-[15px]"
            >
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </span>
        </button>
      </div>

      {!trackSeparately && item.kind === "movie" && !item.watched ? (
        <div className="relative mt-2.5">
          <MarkMovieWatchedButton movieId={item.titleId} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="relative mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}

      {menuOpen ? (
        <Sheet title={item.title} onClose={() => setMenuOpen(false)}>
          <button
            type="button"
            onClick={remove}
            className="flex min-h-14 w-full items-center rounded-[13px] px-4 py-2 text-left text-[15px] font-medium text-danger transition-colors hover:bg-surface"
          >
            Remove from list
          </button>
        </Sheet>
      ) : null}
    </li>
  );
}
