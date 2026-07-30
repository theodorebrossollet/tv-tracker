"use client";

import Image from "next/image";
import { useState } from "react";

export interface TrailerOption {
  /** Stable id: "show" or "season-3". */
  id: string;
  label: string;
  /** Compact form for the pills, e.g. "S3" instead of "Season 3". */
  shortLabel?: string;
  videoKey: string;
  name: string;
}

interface TrailerProps {
  options: TrailerOption[];
  showName: string;
}

/**
 * Plays a trailer inline, showing YouTube's own thumbnail as the poster frame
 * and loading the player itself only on click.
 *
 * The thumbnail keeps the no-third-party-contact property, which is not
 * obvious: `next/image` fetches and re-encodes remote images **on the server**,
 * so the browser only ever requests `/_next/image` from this app. YouTube sees
 * the server's address, never the visitor's, and sets no cookies in their
 * browser. Replacing this with a plain `<img src="https://i.ytimg.com/…">`
 * would quietly break that.
 *
 * Pressing play is the first time the visitor's browser talks to YouTube, and
 * that request goes to youtube-nocookie.com.
 */
export function Trailer({ options, showName }: TrailerProps) {
  const [selectedId, setSelectedId] = useState(options[0]?.id ?? "");
  const [playing, setPlaying] = useState(false);

  const selected =
    options.find((option) => option.id === selectedId) ?? options[0];

  // maxresdefault only exists for videos uploaded at 720p or better; every
  // valid video has hqdefault, so fall back to it rather than showing a gap.
  const [failedThumbnails, setFailedThumbnails] = useState<string[]>([]);

  if (!selected) return null;

  const useFallback = failedThumbnails.includes(selected.videoKey);
  const thumbnail = `https://i.ytimg.com/vi/${selected.videoKey}/${
    useFallback ? "hqdefault" : "maxresdefault"
  }.jpg`;

  function select(id: string) {
    setSelectedId(id);
    // Switching trailers should show the new poster frame, not keep playing
    // the previous video.
    setPlaying(false);
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Trailer</h2>

        {/* Pills rather than a dropdown: every option is visible, and picking
            one is a single click instead of two. */}
        {options.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => select(option.id)}
                aria-pressed={option.id === selected.id}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  option.id === selected.id
                    ? "border-accent bg-accent text-white"
                    : "border-border text-muted hover:bg-surface hover:text-foreground"
                }`}
              >
                {option.shortLabel ?? option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3 aspect-video w-full max-w-md overflow-hidden rounded-lg border border-border bg-surface">
        {playing ? (
          <iframe
            key={selected.videoKey}
            src={`https://www.youtube-nocookie.com/embed/${selected.videoKey}?autoplay=1&rel=0`}
            title={`${showName} — ${selected.name}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="size-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play trailer: ${selected.name}`}
            className="group relative flex size-full items-center justify-center"
          >
            <Image
              key={thumbnail}
              src={thumbnail}
              alt=""
              fill
              sizes="(max-width: 448px) 100vw, 448px"
              className="object-cover"
              onError={() =>
                setFailedThumbnails((keys) =>
                  keys.includes(selected.videoKey)
                    ? keys
                    : [...keys, selected.videoKey],
                )
              }
            />

            {/* Scrim keeps the play button and caption legible over any frame. */}
            <span className="absolute inset-0 bg-black/35 transition-colors group-hover:bg-black/45" />

            <span className="relative flex size-16 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-transform group-hover:scale-105">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                className="ml-1 size-7"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>

            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8 text-left text-sm font-medium text-white">
              {selected.name}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
