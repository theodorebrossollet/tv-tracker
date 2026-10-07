import Link from "next/link";

import { KindBadge } from "@/components/kind-badge";
import { Poster } from "@/components/poster";
import { ShowMoreLink } from "@/components/show-more-link";
import { SOON_DAYS, UPCOMING_PAGE_SIZE } from "@/components/upcoming-list";
import { daysUntil, formatAirDateShort, relativeAirDate } from "@/lib/format";
import type { UpcomingMovie } from "@/lib/upcoming-movies";

/** Search param this list expands with; its own, so it pages independently. */
export const UPCOMING_MOVIES_PARAM = "upcomingMovies";

const RELEASE_LABEL = { cinema: "In cinemas", digital: "Digital" } as const;

interface UpcomingMoviesListProps {
  movies: UpcomingMovie[];
  searchParams: Record<string, string | string[] | undefined>;
  limit: number;
}

/**
 * Watchlist movies with a cinema or digital date still ahead, soonest first,
 * revealed a page at a time. A server component, like `UpcomingList`.
 */
export function UpcomingMoviesList({
  movies,
  searchParams,
  limit,
}: UpcomingMoviesListProps) {
  const shown = movies.slice(0, limit);
  const remaining = movies.length - shown.length;

  return (
    <>
      <ul className="mt-3">
        {shown.map((movie) => (
          <MovieRow key={movie.movieId} movie={movie} />
        ))}
      </ul>

      {remaining > 0 ? (
        <ShowMoreLink
          param={UPCOMING_MOVIES_PARAM}
          current={searchParams}
          step={UPCOMING_PAGE_SIZE}
          shown={shown.length}
          remaining={remaining}
          label="Load"
        />
      ) : null}
    </>
  );
}

function MovieRow({ movie }: { movie: UpcomingMovie }) {
  const iso = movie.next.date.toISOString();
  const soon = daysUntil(iso) < SOON_DAYS;

  return (
    <li className="border-b border-border-faint">
      <Link
        href={`/movie/${movie.movieId}`}
        className="flex items-center gap-[11px] py-[11px]"
      >
        <div className="relative shrink-0">
          <Poster path={movie.posterPath} name={movie.title} width={34} />
          <KindBadge kind="movie" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="min-w-0 truncate text-sm font-medium">
            {movie.title}
          </span>

          <span className="truncate font-mono text-[10.5px] text-faint">
            {RELEASE_LABEL[movie.next.kind]}
            {movie.later
              ? ` · ${RELEASE_LABEL[movie.later.kind]} ${formatAirDateShort(
                  movie.later.date.toISOString(),
                )}`
              : ""}
            {movie.region ? ` · ${movie.region}` : ""}
          </span>
        </div>

        <span
          className={`shrink-0 text-xs ${soon ? "text-accent-deep" : "text-faint"}`}
        >
          {relativeAirDate(iso)}
        </span>
      </Link>
    </li>
  );
}
