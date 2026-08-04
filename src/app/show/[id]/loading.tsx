import { Skeleton, SkeletonScreen } from "@/components/skeleton";

/**
 * Opening a show that isn't cached yet fetches it from TMDB — one request for
 * the show plus one per season, run sequentially to stay inside the rate limit.
 * For a long-running series that's a couple of seconds, which without this
 * looks like the app has frozen.
 *
 * Known trade-off: this file creates a Suspense boundary, so the shell streams
 * with a 200 before the page can call `notFound()`. An unknown show id
 * therefore renders the correct "Not found" page but with a 200 status rather
 * than 404 (measured: 404 without this file, 200 with it). Kept because the
 * loading state helps on every uncached show — the common path — while the
 * status code only matters to crawlers and uptime checks, and this app is
 * private with no SEO surface. Delete this file if that ever changes.
 */
export default function Loading() {
  return (
    <SkeletonScreen>
      {/* Refresh strip. */}
      <Skeleton className="-mx-4 h-9 w-[calc(100%+2rem)] rounded-none" />

      <div className="mt-3 flex items-end gap-3.5">
        <Skeleton className="h-[117px] w-[78px] shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <Skeleton className="h-6 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-[5px] w-full rounded-full" />
        </div>
      </div>

      {/* Episodes / Watch / About. */}
      <Skeleton className="mt-5 h-[46px] w-full rounded-[13px]" />

      {/* Next up. */}
      <Skeleton className="mt-4 h-[150px] w-full rounded-2xl" />

      <div className="mt-4 flex gap-1.5">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-[38px] w-14 rounded-[10px]" />
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-6 shrink-0 rounded-[7px]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
