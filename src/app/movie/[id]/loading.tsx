import { Skeleton, SkeletonScreen } from "@/components/skeleton";

/**
 * An uncached movie is one TMDB request, so this is brief — but the page is
 * force-dynamic like every other screen, and without a boundary the previous
 * screen stays up while it renders. Same trade-off as the show page's loading
 * state: the shell streams with a 200 before `notFound()` can run.
 */
export default function Loading() {
  return (
    <SkeletonScreen>
      <div className="mt-3 flex items-end gap-3.5">
        <Skeleton className="h-[138px] w-[92px] shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <Skeleton className="h-6 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <Skeleton className="h-9 w-32 rounded-full" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>

      <div className="mt-5 space-y-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </SkeletonScreen>
  );
}
