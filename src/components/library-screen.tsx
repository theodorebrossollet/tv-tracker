import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { LIBRARY_PAGE_SIZE, LibraryList } from "@/components/library-list";
import { SearchIconButton } from "@/components/search-icon-button";
import { limitFrom } from "@/components/show-more-link";
import type { ShowBuckets } from "@/lib/queries";

export type LibrarySegment = "watchlist" | "archive";

interface LibraryScreenProps {
  segment: LibrarySegment;
  buckets: ShowBuckets;
  searchParams: Record<string, string | string[] | undefined>;
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
  buckets,
  searchParams,
}: LibraryScreenProps) {
  const { watchlist, paused, caughtUp, finished, stopped } = buckets;

  const limit = (param: string) =>
    limitFrom(searchParams, param, LIBRARY_PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between gap-2.5">
        <h1 className="text-[25px] font-semibold tracking-[-0.025em]">
          Library
        </h1>
        <SearchIconButton />
      </div>

      <div className="mt-3.5">
        <Segments segment={segment} />
      </div>

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
    </div>
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
 * The two segments, as links.
 *
 * Links rather than a client-side tablist: each one is a real route that
 * already renders the right half, so this needs no JavaScript and the back
 * button does the obvious thing. Search params are deliberately *not* carried
 * across — they page the lists of whichever segment you are leaving, and a
 * `?finished=30` arriving on the watchlist means nothing.
 */
function Segments({ segment }: { segment: LibrarySegment }) {
  const SEGMENTS = [
    { id: "watchlist", label: "Watchlist", href: "/watchlist" },
    { id: "archive", label: "Archive", href: "/archive" },
  ] as const;

  return (
    <div className="flex gap-[3px] rounded-[13px] border border-border bg-surface-sunken p-[3px]">
      {SEGMENTS.map((option) => {
        const active = option.id === segment;

        return (
          <Link
            key={option.id}
            href={option.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-10 flex-1 items-center justify-center rounded-[10px] text-[13px] font-medium transition-colors ${
              active
                ? "bg-surface-raised text-foreground shadow-[0_1px_2px_rgba(0,0,0,.12)]"
                : "text-muted"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
