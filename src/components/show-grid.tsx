"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Poster } from "@/components/poster";
import type { TrackedShowSummary } from "@/lib/queries";

const STORAGE_KEY = "tv-tracker:hide-finished";

// localStorage is an external store, so React reads it through
// useSyncExternalStore rather than copying it into state inside an effect.
// That keeps the server render (always "show everything") consistent with the
// first client render, avoiding a hydration mismatch.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // `storage` only fires in *other* tabs, so a manual listener set handles
  // this tab and the event handles the rest.
  window.addEventListener("storage", onChange);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getHideFinished() {
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

function setHideFinished(value: boolean) {
  window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  listeners.forEach((listener) => listener());
}

function episodeCode(seasonNumber: number, episodeNumber: number) {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(
    episodeNumber,
  ).padStart(2, "0")}`;
}

/**
 * The "Watching" list, with a toggle for hiding shows you've finished.
 *
 * The preference lives in localStorage rather than the database: it's a view
 * preference for this browser, not data worth syncing, and keeping it client
 * side avoids a round trip on every toggle.
 */
export function ShowGrid({ shows }: { shows: TrackedShowSummary[] }) {
  const hideFinished = useSyncExternalStore(
    subscribe,
    getHideFinished,
    // Server snapshot: no localStorage there, so render the unfiltered list.
    () => false,
  );

  const finishedCount = shows.filter((show) => show.fullyWatched).length;
  const visible = hideFinished
    ? shows.filter((show) => !show.fullyWatched)
    : shows;

  return (
    <>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {shows.length} show{shows.length === 1 ? "" : "s"}
          {finishedCount > 0 ? ` · ${finishedCount} finished` : ""}
        </p>

        {finishedCount > 0 ? (
          <button
            type="button"
            onClick={() => setHideFinished(!hideFinished)}
            aria-pressed={hideFinished}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              hideFinished
                ? "border-accent bg-accent text-white"
                : "border-border text-muted hover:bg-surface hover:text-foreground"
            }`}
          >
            {hideFinished ? "Showing unfinished only" : "Hide finished shows"}
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted">
          Every show you&rsquo;re watching is finished. Turn the filter off to
          see them.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {visible.map((show) => {
            const percent =
              show.airedCount === 0
                ? 0
                : Math.round((show.watchedCount / show.airedCount) * 100);

            return (
              <li key={show.showId}>
                <Link
                  href={`/show/${show.showId}`}
                  className="flex gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-surface"
                >
                  <Poster path={show.posterPath} name={show.name} width={64} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{show.name}</p>

                    <p className="mt-0.5 text-xs text-muted">
                      {show.watchedCount} / {show.airedCount} aired episodes
                      watched
                    </p>

                    <div
                      className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${show.name} progress`}
                    >
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${percent}%` }}
                      />
                    </div>

                    <p className="mt-2 truncate text-xs">
                      {show.nextUnwatched ? (
                        <>
                          <span className="text-muted">Next up: </span>
                          <span className="font-mono">
                            {episodeCode(
                              show.nextUnwatched.seasonNumber,
                              show.nextUnwatched.episodeNumber,
                            )}
                          </span>{" "}
                          {show.nextUnwatched.name ?? ""}
                        </>
                      ) : (
                        <span className="text-muted">
                          {show.airedCount > 0
                            ? "All caught up"
                            : "No episodes aired yet"}
                        </span>
                      )}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
