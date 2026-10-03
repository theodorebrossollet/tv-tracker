import { WatchedDate } from "@/components/watched-date";
import { RatingValue } from "@/components/rating-value";
import type { PastWatch } from "@/lib/queries";

/**
 * Archived watches of a rewatched movie, newest first, read-only. Nothing for
 * `null` (history unavailable) or no watches. No `"use client"`: the movie page
 * renders it on the server from `getMovieDetail`'s `pastWatches`.
 */
export function PastWatches({ watches }: { watches: PastWatch[] | null }) {
  if (!watches || watches.length === 0) return null;

  return (
    <section className="mt-5 space-y-2">
      <h2 className="px-2 font-semibold">Past watches</h2>
      <ul className="flex flex-col gap-1">
        {watches.map((watch) => (
          <li
            key={watch.watchedAt.toISOString()}
            className="px-2 text-xs text-muted"
          >
            <WatchedDate iso={watch.watchedAt.toISOString()} />
            {watch.rating !== null ? (
              <>
                {" · "}
                <RatingValue value={watch.rating} />
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
