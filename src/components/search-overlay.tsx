"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { searchSuggestions, type SearchSuggestion } from "@/app/actions";
import { AddButton } from "@/components/add-button";
import { Poster } from "@/components/poster";
import { StatusBadge } from "@/components/status-badge";

/** How long to wait after the last keystroke before asking TMDB. */
const DEBOUNCE_MS = 250;

interface SearchOverlayProps {
  onClose: () => void;
  /** Session-lived, held by SearchProvider — see the note there. */
  recent: string[];
  onRemember: (query: string) => void;
}

/**
 * Search, as a full screen rather than a centred dialog.
 *
 * Still an overlay and not a route. Making it one would need its own gate, and
 * would throw away the scroll position of whatever is behind it — which for a
 * control reachable from the tab bar on every screen is the whole cost of using
 * it. The tab bar reads its open state from `SearchProvider` instead of a
 * pathname.
 *
 * It covers the tab bar rather than leaving it visible as the handoff draws.
 * A modal dialog makes everything behind it inert, so tabs left showing would
 * look tappable and do nothing; Cancel is the way out.
 *
 * Arrow-key navigation is gone with the centred dialog it belonged to. It cost
 * a highlighted-index state that every result row had to track, for a gesture
 * that does not exist on the device this is now designed for.
 */
export function SearchOverlay({
  onClose,
  recent,
  onRemember,
}: SearchOverlayProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");

  // Results are stored together with the query they belong to. Deriving
  // "is this stale?" during render (rather than clearing state in an effect)
  // means the previous show's results never flash while you type the next one.
  const [data, setData] = useState<{
    query: string;
    results: SearchSuggestion[];
    error: string | null;
  }>({ query: "", results: [], error: null });

  const trimmedQuery = query.trim();
  const isStale = data.query !== trimmedQuery;
  const loading = trimmedQuery !== "" && isStale;
  const results = isStale ? [] : data.results;
  const error = isStale ? null : data.error;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // `showModal` brings the focus trap, the inertness of the page behind, and
    // Escape — all of which this component used to do by hand, incompletely:
    // there was never a trap, so tabbing walked off into the page underneath.
    dialog.showModal();
    inputRef.current?.focus();

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    // `cancelled` guards against a slow early request landing after a faster
    // later one and overwriting newer results with stale ones.
    let cancelled = false;

    const timer = setTimeout(async () => {
      const response = await searchSuggestions(trimmed);
      if (cancelled) return;

      setData({
        query: trimmed,
        results: response.results ?? [],
        error: response.error ?? null,
      });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function openShow(id: string) {
    // Remembered on the way out rather than as you type, so the chips hold
    // searches that went somewhere instead of every prefix of them.
    onRemember(trimmedQuery);
    onClose();
    router.push(`/show/${id}`);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="Search shows"
      onCancel={(event) => {
        // Escape closes the dialog without telling the parent otherwise,
        // leaving the state that renders it still true.
        event.preventDefault();
        onClose();
      }}
      className="m-0 h-full max-h-full w-full max-w-full bg-background p-0 text-foreground"
    >
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col">
        <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-border-faint bg-background/95 p-4 backdrop-blur">
          <div className="flex h-11 min-w-0 flex-1 items-center gap-[9px] rounded-[13px] border border-border bg-surface px-3">
            <SearchIcon className="size-4 shrink-0 text-faint" />

            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search for a show…"
              aria-label="Show title"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
            />

            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-border text-muted"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  className="size-2.5"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </svg>
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 px-1 text-[15px] text-accent-deep"
          >
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {error ? (
            <p className="px-6 py-10 text-center text-sm text-danger">
              {error}
            </p>
          ) : null}

          {!trimmedQuery && recent.length > 0 ? (
            <div className="px-4 pt-5">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                Recent
              </h2>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {recent.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setQuery(entry)}
                    className="min-h-[38px] rounded-full border border-border bg-surface px-3.5 text-[13.5px] text-muted transition-colors hover:text-foreground"
                  >
                    {entry}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!trimmedQuery && recent.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted">
              Search TMDB for any show, then add it to your watchlist.
            </p>
          ) : null}

          {!error && trimmedQuery && !loading && results.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted">
              No shows found for “{trimmedQuery}”.
            </p>
          ) : null}

          {loading ? (
            <p className="px-6 py-10 text-center text-sm text-muted">
              Searching…
            </p>
          ) : null}

          <ul className="px-4">
            {results.map((result) => (
              <li
                key={result.id}
                className="flex items-center gap-3 border-b border-border-faint py-2.5"
              >
                <button
                  type="button"
                  onClick={() => openShow(result.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Poster
                    path={result.posterPath}
                    name={result.name}
                    width={40}
                  />

                  <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    {/* Badge rather than trailing text in the subtitle: the
                        point is to be readable at a glance while typing, and
                        the old form silently said nothing for two of the four
                        statuses. */}
                    <span className="flex items-center gap-[7px]">
                      <span className="min-w-0 truncate text-[15px] font-medium">
                        {result.name}
                      </span>
                      <StatusBadge status={result.status} />
                    </span>
                    <span className="text-xs text-faint">
                      {result.firstAirYear ?? "Year unknown"}
                    </span>
                  </span>
                </button>

                <AddButton
                  showId={result.id}
                  status={result.status}
                  variant="icon"
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </dialog>
  );
}

export function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
