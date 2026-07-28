import { SearchClient } from "./search-client";
import { getTrackedStatusMap } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Search · TV Tracker" };

export default async function SearchPage() {
  // Passed down so results can show which shows are already on a list.
  const tracked = await getTrackedStatusMap();

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Search</h1>
      <p className="mt-1 text-sm text-muted">
        Find a show on TMDB, then add it to your watching list or watchlist.
      </p>

      <SearchClient trackedEntries={[...tracked.entries()]} />
    </div>
  );
}
