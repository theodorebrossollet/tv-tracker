"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { searchSuggestions, type SearchSuggestion } from "@/app/actions";
import { AddButton } from "@/components/add-button";
import { Poster } from "@/components/poster";
import { StatusBadge } from "@/components/status-badge";

/** How long to wait after the last keystroke before asking TMDB. */
const DEBOUNCE_MS = 250;

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

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
    inputRef.current?.focus();
  }, []);

  // Close on Escape from anywhere, not just while the input has focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Stop the page behind the overlay from scrolling.
  useEffect(() => {
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
      setHighlighted(0);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function openShow(id: string) {
    onClose();
    router.push(`/show/${id}`);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = results[highlighted];
      if (target) openShow(target.id);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/50 px-4 pt-[10vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Search shows"
      onClick={onClose}
    >
      <div
        className="flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        // Clicks inside the panel shouldn't reach the backdrop's close handler.
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <SearchIcon className="size-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search for a show…"
            aria-label="Show title"
            className="min-w-0 flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted"
          />
          {loading ? (
            <span className="shrink-0 text-xs text-muted">Searching…</span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-2 py-1 text-xs text-muted hover:text-foreground"
          >
            Esc
          </button>
        </div>

        <div className="overflow-y-auto">
          {error ? (
            <p className="px-4 py-6 text-sm text-red-500">{error}</p>
          ) : null}

          {!error && trimmedQuery && !loading && results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              No shows found for “{trimmedQuery}”.
            </p>
          ) : null}

          {!trimmedQuery ? (
            <p className="px-4 py-6 text-sm text-muted">
              Start typing to search TMDB. Press{" "}
              <kbd className="rounded border border-border px-1">↑</kbd>{" "}
              <kbd className="rounded border border-border px-1">↓</kbd> to move,{" "}
              <kbd className="rounded border border-border px-1">Enter</kbd> to
              open.
            </p>
          ) : null}

          <ul>
            {results.map((result, index) => (
              <li key={result.id}>
                <div
                  className={`flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 ${
                    index === highlighted ? "bg-surface" : ""
                  }`}
                  onMouseEnter={() => setHighlighted(index)}
                >
                  <button
                    type="button"
                    onClick={() => openShow(result.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Poster
                      path={result.posterPath}
                      name={result.name}
                      width={36}
                    />
                    <span className="min-w-0 flex-1">
                      {/* Badge rather than trailing text in the subtitle: the
                          point is to be readable at a glance while typing, and
                          the old form silently said nothing for two of the four
                          statuses. */}
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">
                          {result.name}
                        </span>
                        <StatusBadge status={result.status} />
                      </span>
                      <span className="block text-xs text-muted">
                        {result.firstAirYear ?? "Year unknown"}
                      </span>
                    </span>
                  </button>

                  <AddButton
                    showId={result.id}
                    status={result.status}
                    variant="icon"
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
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
