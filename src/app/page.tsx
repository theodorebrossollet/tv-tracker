import { DiscoverIconButton } from "@/components/discover-icon-button";
import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { PullToRefreshPage } from "@/components/pull-to-refresh-page";
import { SearchIconButton } from "@/components/search-icon-button";
import { ShowGrid } from "@/components/show-grid";
import { limitFrom } from "@/components/show-more-link";
import {
  UPCOMING_PAGE_SIZE,
  UPCOMING_PARAM,
  UpcomingList,
} from "@/components/upcoming-list";
import { requireOnboardedSession } from "@/lib/auth";
import { getShowBuckets, getUpcomingEpisodes } from "@/lib/queries";
import { getSettings } from "@/lib/shows";
import { getUpcomingMovies } from "@/lib/upcoming-movies";

// Everything on this page comes from the database and changes as soon as you
// mark an episode watched, so there's nothing worth prerendering at build time.
export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const { user } = await requireOnboardedSession();
  const params = await searchParams;
  const upcomingLimit = limitFrom(params, UPCOMING_PARAM, UPCOMING_PAGE_SIZE);

  const [{ watching }, upcoming, upcomingMovies] = await Promise.all([
    getShowBuckets(user.id),
    // Still fetched well past the first page: this is how far ahead the list
    // looks, and it's what makes the "(N left)" count on the expand link
    // honest. Only `upcomingLimit` of them are rendered.
    getUpcomingEpisodes(user.id, 90),
    // Soft: a slow or failing TMDB drops the movies, never the page.
    getSettings(user.id).then((settings) =>
      getUpcomingMovies(user.id, settings.country),
    ),
  ]);

  return (
    <>
      {/* Outside the `space-y` wrapper, which would otherwise add a top
          margin to the first section beneath it. */}
      <PullToRefreshPage />
      <div className="space-y-10">
        <section>
          <div className="flex items-center justify-between gap-2.5">
            <h1 className="text-[25px] font-semibold tracking-[-0.025em]">
              Watching
            </h1>
            <div className="flex items-center gap-1.5">
              <DiscoverIconButton />
              <SearchIconButton />
            </div>
          </div>

          {watching.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="Nothing in progress"
                description="Shows land here on their own once you mark an episode watched. Finished ones move to the Archive."
                icon="shows"
                action={<FindShowButton />}
              />
            </div>
          ) : (
            <ShowGrid shows={watching} />
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold tracking-[-0.015em]">
            Upcoming
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
            Episodes across everything you&rsquo;re watching and on your
            watchlist, and movies on your watchlist heading to cinemas or
            streaming. Air dates refresh once a day.
          </p>

          {upcoming.length === 0 && upcomingMovies.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="Nothing scheduled"
                description="None of your tracked shows or watchlist movies have an announced date coming up."
                variant="inline"
              />
            </div>
          ) : (
            <UpcomingList
              episodes={upcoming}
              movies={upcomingMovies}
              searchParams={params}
              limit={upcomingLimit}
            />
          )}
        </section>
      </div>
    </>
  );
}
