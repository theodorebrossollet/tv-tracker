import Link from "next/link";
import { notFound } from "next/navigation";

import { AddToListButton } from "@/components/add-to-list-button";
import { MarkMovieWatchedButton } from "@/components/mark-movie-watched-button";
import { MovieAddButton } from "@/components/movie-add-button";
import { MovieStatusMenu } from "@/components/movie-status-menu";
import { Poster } from "@/components/poster";
import { requireOnboardedSession } from "@/lib/auth";
import { formatRuntime } from "@/lib/format";
import { getListsForTitle, getMovieDetail } from "@/lib/queries";
import { isTmdbMovieId } from "@/lib/show-id";

export const dynamic = "force-dynamic";

interface MoviePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: MoviePageProps) {
  const { id } = await params;
  // Also gated: metadata runs before the component and would otherwise read a
  // movie's tracked state without a session. `getMovieDetail` is memoized per
  // request, so this costs nothing the component doesn't already pay.
  const { user } = await requireOnboardedSession();
  const movie = isTmdbMovieId(id) ? await getMovieDetail(user.id, id) : null;

  return { title: movie ? `${movie.title} · TV Tracker` : "Movie · TV Tracker" };
}

export default async function MoviePage({ params }: MoviePageProps) {
  const { id } = await params;
  const { user } = await requireOnboardedSession();

  // Untrusted: the id flows into a TMDB request path and the Movie cache key.
  if (!isTmdbMovieId(id)) notFound();

  const movie = await getMovieDetail(user.id, id);
  // Falls back to TMDB for movies nobody has cached, so null means TMDB
  // doesn't know the id either.
  if (!movie) notFound();

  // A read, never a write: viewing a page must not change anything.
  const lists = await getListsForTitle(user.id, "movie", id);

  const year =
    movie.releaseDate && !Number.isNaN(movie.releaseDate.getTime())
      ? String(movie.releaseDate.getUTCFullYear())
      : null;
  const meta = [
    year,
    movie.runtime ? formatRuntime(movie.runtime) : null,
    movie.genres,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="pb-6 pt-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/"
          aria-label="Back"
          className="-ml-2 flex size-10 items-center justify-center rounded-full"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[19px]"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>

        <div className="flex items-center gap-2">
          <AddToListButton kind="movie" titleId={movie.id} lists={lists} />

          {movie.status ? (
            <MovieStatusMenu
              movieId={movie.id}
              title={movie.title}
              status={movie.status}
              variant="pill"
            />
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-end gap-3.5">
        <Poster path={movie.posterPath} name={movie.title} width={92} />

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold leading-[27px] tracking-[-0.025em]">
            {movie.title}
          </h1>
          {meta ? (
            <p className="mt-[5px] text-xs leading-4 text-muted">{meta}</p>
          ) : null}
        </div>
      </div>

      {movie.status !== "watched" && movie.status !== "not_interested" ? (
        <div className="mt-5 flex flex-wrap items-start gap-2">
          {movie.status === null ? (
            <MovieAddButton movieId={movie.id} status={null} variant="full" />
          ) : null}
          <MarkMovieWatchedButton movieId={movie.id} />
        </div>
      ) : null}

      {movie.overview ? (
        <p className="mt-5 text-sm leading-[21px] text-muted">
          {movie.overview}
        </p>
      ) : null}
    </div>
  );
}
