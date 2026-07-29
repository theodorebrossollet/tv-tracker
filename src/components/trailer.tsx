"use client";

import { useState } from "react";

interface TrailerProps {
  /** YouTube video id. */
  videoKey: string;
  name: string;
  showName: string;
}

/**
 * Plays the trailer inline, but contacts YouTube only once you press play.
 *
 * A plain `<iframe>` would load YouTube — and its cookies — on every show page
 * view, which conflicts with the "no third-party trackers, no cookie banner"
 * line in docs/scope.md. So this renders a local placeholder first and swaps in
 * the real player on click, using youtube-nocookie.com. Nothing leaves the page
 * for anyone who doesn't hit play.
 */
export function Trailer({ videoKey, name, showName }: TrailerProps) {
  const [playing, setPlaying] = useState(false);

  return (
    <section className="mt-8">
      <h2 className="font-semibold">Trailer</h2>

      <div className="mt-3 aspect-video w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-surface">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${videoKey}?autoplay=1&rel=0`}
            title={`${showName} — ${name}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="size-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group flex size-full flex-col items-center justify-center gap-3 transition-colors hover:bg-border"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-accent text-white transition-transform group-hover:scale-105">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                className="ml-0.5 size-6"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>

            <span className="px-4 text-center text-sm font-medium">{name}</span>
            <span className="px-4 text-center text-xs text-muted">
              Plays from YouTube. Nothing is loaded from them until you press
              play.
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
