"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { searchShows, type SearchState } from "@/app/actions";
import { Poster } from "@/components/poster";
import { TrackButtons } from "@/components/track-buttons";
import type { TrackStatus } from "@/lib/types";

const INITIAL: SearchState = { query: "" };

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "Searching…" : "Search"}
    </button>
  );
}

interface SearchClientProps {
  /** Map entries rather than a Map: server components can't pass a Map across. */
  trackedEntries: Array<[string, TrackStatus]>;
}

export function SearchClient({ trackedEntries }: SearchClientProps) {
  const [state, formAction] = useActionState(searchShows, INITIAL);
  const tracked = new Map(trackedEntries);

  return (
    <div className="mt-5">
      <form action={formAction} className="flex gap-2">
        <input
          type="search"
          name="query"
          defaultValue={state.query}
          placeholder="e.g. Severance"
          aria-label="Show title"
          required
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus:border-accent"
        />
        <SubmitButton />
      </form>

      {state.error ? (
        <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-500">
          {state.error}
        </p>
      ) : null}

      {state.results?.length === 0 && state.query && !state.error ? (
        <p className="mt-6 text-sm text-muted">
          No shows found for “{state.query}”.
        </p>
      ) : null}

      {state.results && state.results.length > 0 ? (
        <ul className="mt-6 space-y-3">
          {state.results.map((result) => {
            const id = String(result.id);

            return (
              <li
                key={id}
                className="flex gap-3 rounded-lg border border-border p-3"
              >
                <Poster path={result.posterPath} name={result.name} width={64} />

                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {result.name}
                    {result.firstAirYear ? (
                      <span className="ml-1.5 text-sm font-normal text-muted">
                        ({result.firstAirYear})
                      </span>
                    ) : null}
                  </p>

                  {result.overview ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {result.overview}
                    </p>
                  ) : null}

                  <div className="mt-2.5">
                    <TrackButtons
                      showId={id}
                      status={tracked.get(id) ?? null}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
