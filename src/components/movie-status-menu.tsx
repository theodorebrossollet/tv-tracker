"use client";

import { useOptimistic, useState, useTransition } from "react";

import { removeMovie, setMovieStatus } from "@/app/actions";
import { resetMovieHistory } from "@/app/rewatch-actions";
import { Sheet } from "@/components/sheet";
import { CheckIcon } from "@/components/status-sheet";
import { movieStatusTargets, type MovieStatusTarget } from "@/lib/movie-status";
import type { MovieStatus } from "@/lib/types";

interface MovieStatusMenuProps {
  movieId: string;
  title: string;
  status: MovieStatus | null;
  /** `menu` is the "..." in a list row; `pill` is the movie page's control. */
  variant?: "menu" | "pill";
  /**
   * Adds a red "Reset history" row that permanently deletes the movie's watch
   * history and rating. The movie page passes it when there is something to
   * delete; list rows never do. `watched` is whether the movie is currently
   * watched (it then also returns to the watchlist); `pastWatches` is the
   * archived count, null when it couldn't be read.
   */
  resetHistory?: { pastWatches: number | null; watched: boolean } | null;
}

const ROWS: Record<
  MovieStatusTarget | "none",
  { label: string; hint: string }
> = {
  watchlist: { label: "Watchlist", hint: "Saved for later" },
  watched: { label: "Watched", hint: "Seen it" },
  not_interested: { label: "Not interested", hint: "Moved to your archive" },
  remove: { label: "Remove", hint: "Not in your library" },
  none: { label: "Not tracked", hint: "Not in your library" },
};

const PILL_TONE = {
  accent: "border-accent-border bg-accent-tint text-accent-deep",
  neutral: "border-border bg-surface text-foreground",
  quiet: "border-border bg-transparent text-faint",
} as const;

function toneOf(status: MovieStatus | null) {
  if (status === null) return "quiet";
  return status === "not_interested" ? "neutral" : "accent";
}

/**
 * The per-row "..." (or the page's pill) and the sheet it opens.
 *
 * The current status derives from the prop through `useOptimistic`, not a
 * `useState` copy: the server can change it (another tab, the movie page) and a
 * copy would keep showing the old one.
 */
export function MovieStatusMenu({
  movieId,
  title,
  status,
  variant = "menu",
  resetHistory = null,
}: MovieStatusMenuProps) {
  const [open, setOpen] = useState(false);
  // Plain state, like `error`: the server can't change it.
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useOptimistic(status);
  const [pending, startTransition] = useTransition();

  const targets = movieStatusTargets(current);
  const row = ROWS[current ?? "none"];

  function apply(target: MovieStatusTarget) {
    setError(null);

    startTransition(async () => {
      setCurrent(target === "remove" ? null : target);

      const result =
        target === "remove"
          ? await removeMovie(movieId)
          : await setMovieStatus(movieId, target);

      // Kept open on failure so the message has somewhere to appear; the
      // optimistic value is dropped when the transition ends.
      if (result.ok) setOpen(false);
      else setError(result.error ?? "Something went wrong. Please try again.");
    });
  }

  function close() {
    setOpen(false);
    setConfirming(false);
    setError(null);
  }

  function confirmReset() {
    setError(null);

    startTransition(async () => {
      const result = await resetMovieHistory(movieId);

      // Kept open on failure; the message is plain state so it is still there
      // once the transition settles.
      if (result.ok) close();
      else setError(result.error ?? "Something went wrong. Please try again.");
    });
  }

  // A prop that vanishes mid-confirmation falls back to the menu.
  const showingReset = confirming && resetHistory !== null;

  return (
    <>
      {variant === "pill" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Change status for ${title}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`inline-flex min-h-9 shrink-0 items-center gap-[7px] rounded-full border px-3 text-[12.5px] font-medium ${PILL_TONE[toneOf(current)]}`}
        >
          {row.label}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3 opacity-75"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Change status for ${title}`}
          aria-haspopup="dialog"
          aria-expanded={open}
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
      )}

      {open && showingReset && resetHistory ? (
        <Sheet title="Reset history?" onClose={close}>
          <p className="px-1.5 text-[13px] leading-relaxed text-muted">
            This permanently deletes your watch history and ratings for this
            movie.
            {resetHistory.watched ? " It goes back to your watchlist." : ""}
          </p>

          {error ? (
            <p role="alert" className="mt-2 px-1.5 text-xs text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-3.5 flex gap-2 px-1.5 pb-1">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={pending}
              className="min-h-[46px] flex-1 rounded-full border border-border px-[22px] text-[15px] font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReset}
              disabled={pending}
              className="min-h-[46px] flex-1 rounded-full bg-danger px-[22px] text-[15px] font-semibold text-on-accent disabled:opacity-50"
            >
              Reset history
            </button>
          </div>
        </Sheet>
      ) : null}

      {open && !showingReset ? (
        <Sheet title={`Track ${title} as`} onClose={close}>
          <div className="flex flex-col gap-0.5">
            <div className="flex min-h-14 items-center gap-3 rounded-[13px] bg-accent-tint px-2 py-2">
              <span className="min-w-0 flex-1 px-2 text-left">
                <span className="block text-[15px] font-medium">
                  {row.label}
                </span>
                <span className="mt-0.5 block text-[11.5px] text-muted">
                  {row.hint}
                </span>
              </span>
              <CheckIcon className="size-4 shrink-0 text-accent" />
            </div>

            {targets.map((target) => (
              <Option
                key={target}
                {...ROWS[target]}
                disabled={pending}
                onSelect={() => apply(target)}
              />
            ))}

            {current !== null ? (
              <>
                <hr className="my-1.5 border-border-faint" />
                <Option
                  {...ROWS.remove}
                  disabled={pending}
                  onSelect={() => apply("remove")}
                />
              </>
            ) : null}

            {resetHistory ? (
              <>
                <hr className="my-1.5 border-border-faint" />
                <Option
                  label="Reset history"
                  hint="Delete your watches and ratings"
                  danger
                  disabled={pending}
                  onSelect={() => {
                    setError(null);
                    setConfirming(true);
                  }}
                />
              </>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="mt-2 px-1.5 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}

function Option({
  label,
  hint,
  danger = false,
  disabled,
  onSelect,
}: {
  label: string;
  hint: string;
  /** Destructive: the label takes the danger colour. */
  danger?: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex min-h-14 items-center gap-3 rounded-[13px] px-4 py-2 text-left transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${danger ? "text-danger" : ""}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="mt-0.5 block text-[11.5px] text-muted">{hint}</span>
      </span>
    </button>
  );
}
