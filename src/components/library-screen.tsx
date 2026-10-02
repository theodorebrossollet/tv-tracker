import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { LIBRARY_PAGE_SIZE, LibraryList } from "@/components/library-list";
import { MovieList } from "@/components/movie-list";
import { PullToRefreshPage } from "@/components/pull-to-refresh-page";
import { SearchIconButton } from "@/components/search-icon-button";
import { limitFrom } from "@/components/show-more-link";
import type { LibraryType } from "@/lib/library-type";
import type { MovieBuckets, ShowBuckets } from "@/lib/queries";

export type LibrarySegment = "watchlist" | "archive";

interface LibraryScreenProps {
  segment: LibrarySegment;
  searchParams: Record<string, string | string[] | undefined>;
  /** Only the half being rendered is fetched, so the pages pass one or the other. */
  data:
    | { type: "shows"; buckets: ShowBuckets }
    | { type: "movies"; buckets: MovieBuckets };
}

/**
 * Watchlist and Archive, merged into one screen with a segmented control.
 *
 * They were the same row with a different subtitle, and neither is visited
 * often — merging them frees a slot in the four-tab bar.
 *
 * The segments are the two existing routes rather than client state, so
 * switching them is a navigation and the server renders only the segment being
 * asked for. That also means `/watchlist` and `/archive` keep working exactly
 * as they did, and each keeps its own metadata title; there is no third route
 * to add, gate, or redirect through.
 */
export function LibraryScreen({
  segment,
  searchParams,
  data,
}: LibraryScreenProps) {
  return (
    <div>
      <PullToRefreshPage />
      <div className="flex items-center justify-between gap-2.5">
        <h1 className="text-[25px] font-semibold tracking-[-0.025em]">
          Library
        </h1>
        <div className="flex items-center gap-2">
          <TypeSwitch segment={segment} type={data.type} />
          <SearchIconButton />
        </div>
      </div>

      <div className="mt-3.5">
        <Segments segment={segment} type={data.type} />
      </div>

      {data.type === "movies" ? (
        <MoviesView
          segment={segment}
          buckets={data.buckets}
          searchParams={searchParams}
        />
      ) : (
        <ShowsView
          segment={segment}
          buckets={data.buckets}
          searchParams={searchParams}
        />
      )}
    </div>
  );
}

interface ViewProps<B> {
  segment: LibrarySegment;
  buckets: B;
  searchParams: Record<string, string | string[] | undefined>;
}

function ShowsView({ segment, buckets, searchParams }: ViewProps<ShowBuckets>) {
  const { watchlist, paused, caughtUp, finished, stopped } = buckets;

  const limit = (param: string) =>
    limitFrom(searchParams, param, LIBRARY_PAGE_SIZE);

  return (
    <>
      {segment === "watchlist" ? (
        <>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
            Shows you haven&rsquo;t started. Mark any episode watched and the
            show moves to Watching on its own.
          </p>

          <div className="mt-[18px]">
            {watchlist.length === 0 ? (
              <EmptyState
                title="Watchlist is empty"
                description="Add shows here when you want to remember to start them later."
                icon="bookmark"
                action={<FindShowButton />}
              />
            ) : (
              <LibraryList
                shows={watchlist}
                param="watchlist"
                searchParams={searchParams}
                limit={limit("watchlist")}
              />
            )}
          </div>

          {paused.length > 0 ? (
            <Section
              title="Paused"
              description="Started, then set aside. Progress is kept, and these stay out of Watching and Upcoming."
            >
              <LibraryList
                shows={paused}
                tone="sunken"
                detail="progress"
                param="paused"
                searchParams={searchParams}
                limit={limit("paused")}
              />
            </Section>
          ) : null}
        </>
      ) : (
        <>
          {caughtUp.length === 0 &&
          finished.length === 0 &&
          stopped.length === 0 ? (
            <div className="mt-[18px]">
              <EmptyState
                title="Nothing archived yet"
                description="Shows land here when you finish them, or when you stop watching one for good."
                icon="archive"
              />
            </div>
          ) : null}

          {/*
           * Caught up leads the segment: these are the only shows here that are
           * coming back, so they're the ones worth a glance. Finished and
           * Stopped are both settled.
           */}
          {caughtUp.length > 0 ? (
            <Section
              title="Caught up"
              description="Every aired episode watched, but the series is still running. Each of these returns to Watching on its own when the next episode airs."
              first
            >
              <LibraryList
                shows={caughtUp}
                detail="progress"
                param="caughtUp"
                searchParams={searchParams}
                limit={limit("caughtUp")}
              />
            </Section>
          ) : null}

          {finished.length > 0 ? (
            <Section
              title="Finished"
              description="Watched to the end, and the series is over. If one is revived and a new episode airs it moves back to Watching."
              first={caughtUp.length === 0}
            >
              <LibraryList
                shows={finished}
                detail="progress"
                tick
                param="finished"
                searchParams={searchParams}
                limit={limit("finished")}
              />
            </Section>
          ) : null}

          {stopped.length > 0 ? (
            <Section
              title="Stopped"
              description="Started, then given up on. Marking any episode watched brings a show back."
              first={caughtUp.length === 0 && finished.length === 0}
            >
              <LibraryList
                shows={stopped}
                tone="sunken"
                detail="progress"
                param="stopped"
                searchParams={searchParams}
                limit={limit("stopped")}
              />
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}

function MoviesView({
  segment,
  buckets,
  searchParams,
}: ViewProps<MovieBuckets>) {
  const { watchlist, watched, notInterested } = buckets;

  const limit = (param: string) =>
    limitFrom(searchParams, param, LIBRARY_PAGE_SIZE);

  if (segment === "watchlist") {
    return (
      <>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Movies you want to watch.
        </p>

        <div className="mt-[18px]">
          {watchlist.length === 0 ? (
            <EmptyState
              title="Watchlist is empty"
              description="Add movies here when you want to remember to watch them later."
              icon="bookmark"
              action={<FindShowButton label="Find a movie" />}
            />
          ) : (
            <MovieList
              movies={watchlist}
              detail="released"
              param="movieWatchlist"
              searchParams={searchParams}
              limit={limit("movieWatchlist")}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {watched.length === 0 && notInterested.length === 0 ? (
        <div className="mt-[18px]">
          <EmptyState
            title="Nothing archived yet"
            description="Movies land here when you mark them watched, or when you decide they aren't for you."
            icon="archive"
          />
        </div>
      ) : null}

      {watched.length > 0 ? (
        <Section
          title="Watched"
          description="Movies you've seen, most recent first."
          first
        >
          <MovieList
            movies={watched}
            detail="watched"
            param="movieWatched"
            searchParams={searchParams}
            limit={limit("movieWatched")}
          />
        </Section>
      ) : null}

      {notInterested.length > 0 ? (
        <Section
          title="Not interested"
          description="Set aside for good. Move one back to the watchlist any time."
          first={watched.length === 0}
        >
          <MovieList
            movies={notInterested}
            tone="sunken"
            detail="released"
            param="movieNotInterested"
            searchParams={searchParams}
            limit={limit("movieNotInterested")}
          />
        </Section>
      ) : null}
    </>
  );
}

function Section({
  title,
  description,
  first = false,
  children,
}: {
  title: string;
  description: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={first ? "mt-[18px]" : "mt-[26px]"}>
      <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{title}</h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
        {description}
      </p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Shows / Movies, as links, compact and in the header beside search.
 *
 * It used to sit above the segments as a second full-width control that looked
 * exactly like them, which read as one confusing stack. This is a filter on the
 * whole screen, not a section of it, so it takes the corner and the one
 * full-width control left is the Watchlist/Archive choice.
 *
 * Shows is the bare route and Movies adds `?type=movies`, so the default URL
 * is unchanged and a visitor who never touches the switch never sees a param.
 * Staying on the same segment is the point: Archive → Movies is the movie
 * archive, not a jump back to the watchlist.
 */
function TypeSwitch({
  segment,
  type,
}: {
  segment: LibrarySegment;
  type: LibraryType;
}) {
  const OPTIONS = [
    { id: "shows", label: "Shows", href: `/${segment}` },
    { id: "movies", label: "Movies", href: `/${segment}?type=movies` },
  ] as const;

  return (
    <nav
      aria-label="Shows or movies"
      className="flex gap-0.5 rounded-[11px] border border-border bg-surface-sunken p-0.5"
    >
      {OPTIONS.map((option) => (
        <PillLink
          key={option.id}
          href={option.href}
          active={option.id === type}
          size="compact"
        >
          {option.label}
        </PillLink>
      ))}
    </nav>
  );
}

/**
 * The two segments, as links.
 *
 * Links rather than a client-side tablist: each one is a real route that
 * already renders the right half, so this needs no JavaScript and the back
 * button does the obvious thing. Search params are deliberately *not* carried
 * across — they page the lists of whichever segment you are leaving, and a
 * `?finished=30` arriving on the watchlist means nothing. The one exception is
 * the Shows/Movies choice, which isn't paging state: dropping it would bounce a
 * movie browser back to shows every time they changed segment. So the movies
 * links carry `type=movies` and nothing else.
 */
function Segments({
  segment,
  type,
}: {
  segment: LibrarySegment;
  type: LibraryType;
}) {
  const suffix = type === "movies" ? "?type=movies" : "";
  const SEGMENTS = [
    { id: "watchlist", label: "Watchlist", href: `/watchlist${suffix}` },
    { id: "archive", label: "Archive", href: `/archive${suffix}` },
  ] as const;

  return (
    <div className="flex gap-[3px] rounded-[13px] border border-border bg-surface-sunken p-[3px]">
      {SEGMENTS.map((option) => (
        <PillLink
          key={option.id}
          href={option.href}
          active={option.id === segment}
        >
          {option.label}
        </PillLink>
      ))}
    </div>
  );
}

function PillLink({
  href,
  active,
  size = "full",
  children,
}: {
  href: string;
  active: boolean;
  /** `compact` hugs its label, for the header; `full` shares the row. */
  size?: "full" | "compact";
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-center text-[13px] font-medium transition-colors ${
        size === "compact"
          ? "min-h-9 rounded-[9px] px-3"
          : "min-h-10 flex-1 rounded-[10px]"
      } ${
        active
          ? "bg-surface-raised text-foreground shadow-[0_1px_2px_rgba(0,0,0,.12)]"
          : "text-muted"
      }`}
    >
      {children}
    </Link>
  );
}
