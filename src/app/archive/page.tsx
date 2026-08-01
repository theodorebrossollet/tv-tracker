import { EmptyState } from "@/components/empty-state";
import { ShowList } from "@/components/show-list";
import { requireOnboardedSession } from "@/lib/auth";
import { getShowBuckets } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Archive · TV Tracker" };

/**
 * Shows you're done with, one way or the other.
 *
 * Keeping these off the Watching page is what lets that page mean "in
 * progress" without a filter — the previous "hide finished shows" toggle
 * existed only because finished shows had nowhere else to live.
 */
export default async function ArchivePage() {
  const { user } = await requireOnboardedSession();
  const { finished, stopped } = await getShowBuckets(user.id);

  if (finished.length === 0 && stopped.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Archive</h1>
        <div className="mt-5">
          <EmptyState
            title="Nothing archived yet"
            description="Shows land here when you finish them, or when you stop watching one for good."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold tracking-tight">Archive</h1>
        <p className="mt-1 text-sm text-muted">
          Shows you&rsquo;ve finished or stopped. Everything here keeps its
          watch history.
        </p>
      </section>

      {finished.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold tracking-tight">Finished</h2>
          <p className="mt-1 text-sm text-muted">
            Every aired episode watched. If one of these returns with a new
            season it moves back to Watching on its own — being finished is
            worked out from your progress, not stored.
          </p>

          <ShowList shows={finished} detail="progress" />
        </section>
      ) : null}

      {stopped.length > 0 ? (
        <section>
          <h2 className="text-xl font-semibold tracking-tight">Stopped</h2>
          <p className="mt-1 text-sm text-muted">
            Started, then given up on. Marking any episode watched brings a show
            back to Watching.
          </p>

          <ShowList shows={stopped} detail="progress" />
        </section>
      ) : null}
    </div>
  );
}
