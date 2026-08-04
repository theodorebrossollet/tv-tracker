import {
  Skeleton,
  SkeletonHeader,
  SkeletonListRow,
  SkeletonScreen,
} from "@/components/skeleton";

/**
 * Shared by both Library routes, which render the same screen with a different
 * segment selected — so they wait on the same query and should look identical
 * while they do.
 */
export function LibraryLoading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />

      {/* The segmented control, which is the part you just tapped. */}
      <Skeleton className="mt-3.5 h-[46px] w-full rounded-[13px]" />
      <Skeleton className="mt-3 h-3 w-3/4" />

      <div className="mt-[18px] flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonListRow key={index} />
        ))}
      </div>
    </SkeletonScreen>
  );
}
