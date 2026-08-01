import { EmptyState } from "@/components/empty-state";
import { FindShowButton } from "@/components/find-show-button";
import { ShowList } from "@/components/show-list";
import { requireOnboardedSession } from "@/lib/auth";
import { getShowBuckets } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Watchlist · TV Tracker" };

/**
 * Everything you intend to watch: never started, plus set aside for now.
 *
 * Paused sits here rather than in the Archive because the intent is the same —
 * you mean to get to it. Shows given up on go to the Archive instead.
 */
export default async function WatchlistPage() {
  const { user } = await requireOnboardedSession();
  const { watchlist, paused } = await getShowBuckets(user.id);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold tracking-tight">Watchlist</h1>
        <p className="mt-1 text-sm text-muted">
          Shows you haven&rsquo;t started. Mark any episode watched and the show
          moves to Watching on its own.
        </p>

        {watchlist.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="Watchlist is empty"
              description="Add shows here when you want to remember to start them later."
              action={<FindShowButton />}
            />
          </div>
        ) : (
          <ShowList shows={watchlist} />
        )}
      </section>

      {paused.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold tracking-tight">Paused</h2>
          <p className="mt-1 text-sm text-muted">
            Started, then set aside for now. Your progress is kept, and these
            stay out of Watching and Upcoming episodes. Marking any episode
            watched brings a show back.
          </p>

          <ShowList shows={paused} detail="progress" />
        </section>
      ) : null}
    </div>
  );
}
