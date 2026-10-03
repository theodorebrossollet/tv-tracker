import Image from "next/image";
import Link from "next/link";

import { KindBadge } from "@/components/kind-badge";
import { RatingValue } from "@/components/rating-value";
import { CheckIcon } from "@/components/status-sheet";
import { posterUrl } from "@/lib/images";

export interface PosterGridItem {
  key: string;
  href: string;
  title: string;
  posterPath: string | null;
  /** Set on lists, which can mix movies and shows; left out where it is implied. */
  kind?: "movie" | "tv";
  /** A corner check: watched, finished, or ticked on a list tracked together. */
  seen?: boolean;
  /** The account's rating, or a show's average. */
  rating?: number | null;
  ratingIsAverage?: boolean;
  /** The quieter treatment for settled sections. */
  quiet?: boolean;
}

/**
 * Titles as a grid of posters, the alternative to one row per title.
 *
 * A server component. Each cell is just a link to the title page; the row-only
 * actions (a list's tick, "mark watched", the status menu, "remove from list")
 * live on that page instead. Overlays carry the few facts a row showed beside
 * its poster: kind, seen, rating. A title with no poster prints its name where
 * the poster would be, so a cell is never blank.
 */
export function PosterGrid({ items }: { items: PosterGridItem[] }) {
  return (
    <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {items.map((item) => {
        const url = posterUrl(item.posterPath, "w342");

        return (
          <li key={item.key} className={item.quiet ? "opacity-70" : undefined}>
            <div className="relative">
              <Link
                href={item.href}
                aria-label={item.title}
                className="relative block aspect-[2/3] overflow-hidden rounded-md border border-border bg-surface"
              >
                {url ? (
                  <Image
                    src={url}
                    alt=""
                    fill
                    sizes="(max-width: 448px) 33vw, 120px"
                    className="object-cover"
                  />
                ) : (
                  <span className="flex size-full items-center justify-center p-2 text-center text-[11px] leading-tight text-muted">
                    {item.title}
                  </span>
                )}
              </Link>

              {item.kind ? <KindBadge kind={item.kind} /> : null}

              {item.seen ? (
                <span
                  role="img"
                  aria-label="Seen"
                  className="pointer-events-none absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-accent text-on-accent"
                >
                  <CheckIcon className="size-3" />
                </span>
              ) : null}

              {item.rating !== null && item.rating !== undefined ? (
                <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-background/85 px-1.5 py-0.5 text-[11px] leading-none">
                  <RatingValue
                    value={item.rating}
                    average={item.ratingIsAverage}
                  />
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
