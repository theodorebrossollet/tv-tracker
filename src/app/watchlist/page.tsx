import { LibraryScreen } from "@/components/library-screen";
import { requireOnboardedSession } from "@/lib/auth";
import { getShowBuckets } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Watchlist · TV Tracker" };

/**
 * The Library screen, watchlist segment.
 *
 * Everything you intend to watch: never started, plus set aside for now.
 * Paused sits here rather than in the Archive because the intent is the same —
 * you mean to get to it. Shows given up on go to the Archive instead.
 *
 * The screen itself is shared with `/archive`; this route exists to keep the
 * URL, the metadata title and the session gate where they were. The gate stays
 * in the page rather than moving into `LibraryScreen`, because
 * `tests/route-gates.test.ts` reads these files and a gate one component deeper
 * is a gate it cannot see.
 */
interface WatchlistPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WatchlistPage({
  searchParams,
}: WatchlistPageProps) {
  const { user } = await requireOnboardedSession();
  const params = await searchParams;
  const buckets = await getShowBuckets(user.id);

  return (
    <LibraryScreen
      segment="watchlist"
      buckets={buckets}
      searchParams={params}
    />
  );
}
