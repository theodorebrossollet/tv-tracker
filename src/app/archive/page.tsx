import { LibraryScreen } from "@/components/library-screen";
import { requireOnboardedSession } from "@/lib/auth";
import { getShowBuckets } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Archive · TV Tracker" };

/**
 * The Library screen, archive segment.
 *
 * Shows you're done with, one way or the other. Keeping these off the Watching
 * page is what lets that page mean "in progress" without a filter.
 *
 * See the note in `../watchlist/page.tsx` about why the gate lives here rather
 * than in the shared screen.
 */
interface ArchivePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  const { user } = await requireOnboardedSession();
  const params = await searchParams;
  const buckets = await getShowBuckets(user.id);

  return (
    <LibraryScreen segment="archive" buckets={buckets} searchParams={params} />
  );
}
