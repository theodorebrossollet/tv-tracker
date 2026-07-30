import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { ShowGrid } from "@/components/show-grid";
import { UpcomingList } from "@/components/upcoming-list";
import { getShowBuckets, getUpcomingEpisodes } from "@/lib/queries";

// Everything on this page comes from the database and changes as soon as you
// mark an episode watched, so there's nothing worth prerendering at build time.
export const dynamic = "force-dynamic";


export default async function DashboardPage() {
  const [{ watching }, upcoming] = await Promise.all([
    getShowBuckets(),
    // Fetch well past the first page so "Load more" needs no round trip.
    getUpcomingEpisodes(90),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold tracking-tight">Watching</h1>

        {watching.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing in progress"
              description="Shows land here automatically once you mark an episode watched. Finished ones move to the Archive."
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
          watchlist. Air dates come from TMDB and refresh twice a day.
        </p>

        {upcoming.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing scheduled"
              description="None of your tracked shows have an announced air date coming up."
            />
          </div>
        ) : (
          <UpcomingList episodes={upcoming} />
        )}
      </section>
    </div>
  );
}
