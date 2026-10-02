import Image from "next/image";

import { profileUrl } from "@/lib/images";
import type { TmdbCastMember } from "@/lib/tmdb";

const PHOTO = 64;

/**
 * Top-billed cast as a row of round photos that scrolls sideways.
 *
 * A server component: the photos go through `next/image` like posters, so the
 * visitor's browser only ever asks this app for them. Someone TMDB has no
 * photo for gets their initials instead of a gap.
 */
export function CastRow({ cast }: { cast: TmdbCastMember[] }) {
  if (cast.length === 0) return null;

  return (
    <section aria-label="Cast" className="mt-6">
      <h2 className="mb-2.5 text-xs font-medium leading-4 text-muted">Cast</h2>

      <ul className="-mx-4 flex gap-3.5 overflow-x-auto px-4 pb-1">
        {cast.map((person) => {
          const url = profileUrl(person.profilePath);

          return (
            <li key={person.id} className="w-[72px] shrink-0 text-center">
              {url ? (
                <Image
                  src={url}
                  alt=""
                  width={PHOTO}
                  height={PHOTO}
                  className="mx-auto size-16 rounded-full border border-border object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="mx-auto flex size-16 items-center justify-center rounded-full border border-border bg-surface text-sm text-muted"
                >
                  {initials(person.name)}
                </div>
              )}
              <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-[15px]">
                {person.name}
              </p>
              {person.character ? (
                <p className="line-clamp-2 text-[11px] leading-[14px] text-muted">
                  {person.character}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
