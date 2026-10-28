import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { ProfileButton } from "@/components/profile-button";
import { PullToRefreshPage } from "@/components/pull-to-refresh-page";
import { ShowGrid } from "@/components/show-grid";
import { limitFrom } from "@/components/show-more-link";
import {
  UPCOMING_PAGE_SIZE,
  UPCOMING_PARAM,
  UpcomingList,
} from "@/components/upcoming-list";
import {
  UPCOMING_MOVIES_PARAM,
  UpcomingMoviesList,
} from "@/components/upcoming-movies-list";
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
  const upcomingMoviesLimit = limitFrom(
    params,
    UPCOMING_MOVIES_PARAM,
    UPCOMING_PAGE_SIZE,
  );

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
            <ProfileButton nickname={user.nickname} />
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
            Upcoming episodes
          </h2>

          {upcoming.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="Nothing scheduled"
                description="None of your tracked shows have an announced air date coming up."
                variant="inline"
              />
            </div>
          ) : (
            <UpcomingList
              episodes={upcoming}
              searchParams={params}
              limit={upcomingLimit}
            />
          )}
        </section>

        {/* Only when there is something to say: movies are rare next to
            episodes, and an empty section would just be noise. */}
        {upcomingMovies.length > 0 ? (
          <section>
            <h2 className="text-lg font-semibold tracking-[-0.015em]">
              Upcoming movies
            </h2>

            <UpcomingMoviesList
              movies={upcomingMovies}
              searchParams={params}
              limit={upcomingMoviesLimit}
            />
          </section>
        ) : null}
      </div>
    </>
  );
}
