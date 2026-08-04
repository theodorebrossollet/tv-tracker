import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { ShowGrid } from "@/components/show-grid";
import { limitFrom } from "@/components/show-more-link";
import {
  UPCOMING_PAGE_SIZE,
  UPCOMING_PARAM,
  UpcomingList,
} from "@/components/upcoming-list";
import { requireOnboardedSession } from "@/lib/auth";
import { getShowBuckets, getUpcomingEpisodes } from "@/lib/queries";

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

  const [{ watching }, upcoming] = await Promise.all([
    getShowBuckets(user.id),
    // Still fetched well past the first page: this is how far ahead the list
    // looks, and it's what makes the "(N left)" count on the expand link
    // honest. Only `upcomingLimit` of them are rendered.
    getUpcomingEpisodes(user.id, 90),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold tracking-tight">Watching</h1>

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
        <h2 className="text-xl font-semibold tracking-tight">
          Upcoming episodes
        </h2>
        <p className="mt-1 text-sm text-muted">
          Across everything you&rsquo;re watching and everything on your
          watchlist. Air dates come from TMDB and refresh once a day.
        </p>

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
    </div>
  );
}
