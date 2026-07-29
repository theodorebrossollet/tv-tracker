"use client";

import Image from "next/image";
import { useState } from "react";

interface TrailerProps {
  /** YouTube video id. */
  videoKey: string;
  name: string;
  showName: string;
}

/**
 * Plays the trailer inline, showing YouTube's own thumbnail as the poster frame
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
export function Trailer({ videoKey, name, showName }: TrailerProps) {
  const [playing, setPlaying] = useState(false);
  // maxresdefault only exists for videos uploaded at 720p or better; every
  // valid video has hqdefault, so fall back to it rather than showing a gap.
  const [thumbnail, setThumbnail] = useState(
    `https://i.ytimg.com/vi/${videoKey}/maxresdefault.jpg`,
  );

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
            aria-label={`Play trailer: ${name}`}
            className="group relative flex size-full items-center justify-center"
          >
            <Image
              src={thumbnail}
              alt=""
              fill
              sizes="(max-width: 672px) 100vw, 672px"
              className="object-cover"
              onError={() =>
                setThumbnail(
                  `https://i.ytimg.com/vi/${videoKey}/hqdefault.jpg`,
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
              {name}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
