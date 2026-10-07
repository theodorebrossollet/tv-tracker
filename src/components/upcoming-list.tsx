import Link from "next/link";

import { KindBadge } from "@/components/kind-badge";
import { Poster } from "@/components/poster";
import { ShowMoreLink } from "@/components/show-more-link";
import { StatusBadge } from "@/components/status-badge";
import { episodeCode } from "@/lib/episode-code";
import { daysUntil, formatAirDateShort, relativeAirDate } from "@/lib/format";
import type { UpcomingEpisode } from "@/lib/queries";
import type { UpcomingMovie } from "@/lib/upcoming-movies";

/** How many rows to show at first, and to add per click. */
export const UPCOMING_PAGE_SIZE = 15;

/** Search param this list expands with. */
export const UPCOMING_PARAM = "upcoming";

/**
 * Inside this many days the date is worth noticing rather than just reading,
 * so it takes the accent. Matches where `relativeAirDate` stops counting days
 * and starts printing a date — the two would look arbitrary if they disagreed.
 */
const SOON_DAYS = 7;

interface UpcomingListProps {
  episodes: UpcomingEpisode[];
  /** Watchlist movies with a date still ahead; merged in by date. */
  movies?: UpcomingMovie[];
  searchParams: Record<string, string | string[] | undefined>;
  limit: number;
}

const RELEASE_LABEL = { cinema: "In cinemas", digital: "Digital" } as const;

type Item =
  | { type: "episode"; at: number; episode: UpcomingEpisode }
  | { type: "movie"; at: number; movie: UpcomingMovie };

/**
 * The upcoming list, revealed a page at a time: episodes of shows you track and
 * releases of movies on your watchlist, in one date-sorted run.
 *
 * A server component: the query caps at 90 episodes, and previously all of them
 * serialised into the page whether or not anyone expanded the list. Now only
 * the rows being shown are rendered, and "Load more" is a URL rather than
 * client state.
 */
export function UpcomingList({
  episodes,
  movies = [],
  searchParams,
  limit,
}: UpcomingListProps) {
  const items: Item[] = [
    ...episodes.map(
      (episode): Item => ({
        type: "episode",
        at: episode.airDate.getTime(),
        episode,
      }),
    ),
    ...movies.map(
      (movie): Item => ({ type: "movie", at: movie.next.date.getTime(), movie }),
    ),
  ].sort((a, b) => a.at - b.at);

  const shown = items.slice(0, limit);
  const remaining = items.length - shown.length;

  return (
    <>
      <ul className="mt-3">
        {shown.map((item) =>
          item.type === "movie" ? (
            <MovieRow key={`m-${item.movie.movieId}`} movie={item.movie} />
          ) : (
            <EpisodeRow
              key={item.episode.episodeId}
              episode={item.episode}
            />
          ),
        )}
      </ul>

      {remaining > 0 ? (
        <ShowMoreLink
          param={UPCOMING_PARAM}
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

function EpisodeRow({ episode }: { episode: UpcomingEpisode }) {
  const iso = episode.airDate.toISOString();
  const soon = daysUntil(iso) < SOON_DAYS;

  return (
    <li className="border-b border-border-faint">
      <Link
        href={`/show/${episode.showId}`}
        className="flex items-center gap-[11px] py-[11px]"
      >
        <Poster path={episode.posterPath} name={episode.showName} width={34} />

        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex items-center gap-[7px]">
            <span className="min-w-0 truncate text-sm font-medium">
              {episode.showName}
            </span>
            {/* Only worth flagging the ones you haven't started — a
                "Watching" badge on most rows would be noise. */}
            {episode.status === "watchlist" ? (
              <StatusBadge status={episode.status} />
            ) : null}
          </span>

          <span className="truncate font-mono text-[10.5px] text-faint">
            {episodeCode(episode.seasonNumber, episode.episodeNumber)}
            {episode.name ? ` · ${episode.name}` : ""}
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
