import Link from "next/link";
import type { ReactNode } from "react";

import { LIBRARY_PAGE_SIZE } from "@/components/library-list";
import { MovieStatusMenu } from "@/components/movie-status-menu";
import { Poster } from "@/components/poster";
import { RatingValue } from "@/components/rating-value";
import { ShowMoreLink } from "@/components/show-more-link";
import { WatchedDate } from "@/components/watched-date";
import type { MovieSummary } from "@/lib/queries";

interface MovieListProps {
  movies: MovieSummary[];
  tone?: "card" | "sunken";
  /** `released` is "year · runtime"; `watched` is "Watched <date>". */
  detail: "released" | "watched";
  /** Search-param name this list expands with — unique per list on a page. */
  param: string;
  searchParams: Record<string, string | string[] | undefined>;
  limit: number;
}

/** "1995 · 170 min", skipping whichever part is absent. */
function releasedDetail(movie: MovieSummary): string {
  const parts: string[] = [];

  const year = movie.releaseDate?.getUTCFullYear();
  if (year !== undefined && Number.isFinite(year)) parts.push(String(year));

  // Zero is never stored, but "0 min" would read as a bug if it ever were.
  if (
    movie.runtime !== null &&
    Number.isFinite(movie.runtime) &&
    movie.runtime > 0
  ) {
    parts.push(`${movie.runtime} min`);
  }

  return parts.join(" · ");
}

function detailOf(
  movie: MovieSummary,
  detail: MovieListProps["detail"],
): ReactNode {
  if (detail === "watched" && movie.watchedAt) {
    return (
      <>
        Watched <WatchedDate iso={movie.watchedAt.toISOString()} />
      </>
    );
  }
  return releasedDetail(movie);
}

/**
 * One section of the movies Library. A server component like `LibraryList`:
 * only the rows being shown are rendered, and "show more" is a URL.
 */
export function MovieList({
  movies,
  tone = "card",
  detail,
  param,
  searchParams,
  limit,
}: MovieListProps) {
  const shown = movies.slice(0, limit);
  const remaining = movies.length - shown.length;

  return (
    <>
      <ul className="flex flex-col gap-2">
        {shown.map((movie) => {
          const text = detailOf(movie, detail);

          return (
            <li
              key={movie.movieId}
              className={`relative flex items-center gap-3 rounded-[15px] border p-[11px] transition-colors ${
                tone === "sunken"
                  ? "border-border bg-surface-sunken"
                  : "border-border bg-surface"
              }`}
            >
              <Poster path={movie.posterPath} name={movie.title} width={44} />

              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <Link
                  href={`/movie/${movie.movieId}`}
                  className={`truncate text-[15px] font-medium tracking-[-0.01em] after:absolute after:inset-0 after:content-[''] ${
                    tone === "sunken" ? "text-muted" : ""
                  }`}
                >
                  {movie.title}
                </Link>

                {text || movie.rating !== null ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {text ? <span>{text}</span> : null}
                    {text && movie.rating !== null ? (
                      <span aria-hidden="true">·</span>
                    ) : null}
                    {movie.rating !== null ? (
                      <RatingValue value={movie.rating} />
                    ) : null}
                  </span>
                ) : null}
              </div>

              <div className="relative">
                <MovieStatusMenu
                  movieId={movie.movieId}
                  title={movie.title}
                  status={movie.status}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {remaining > 0 ? (
        <ShowMoreLink
          param={param}
          current={searchParams}
          step={LIBRARY_PAGE_SIZE}
          shown={shown.length}
          remaining={remaining}
          label="Show"
        />
      ) : null}
    </>
  );
}
