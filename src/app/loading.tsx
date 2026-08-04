import {
  Skeleton,
  SkeletonHeader,
  SkeletonScreen,
  SkeletonShowCard,
} from "@/components/skeleton";

/** Watching: the show cards, then the start of the upcoming list. */
export default function Loading() {
  return (
    <SkeletonScreen>
      <SkeletonHeader />
      <Skeleton className="mt-2.5 h-3 w-32" />

      <div className="mt-3.5 flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonShowCard key={index} />
        ))}
      </div>

      <div className="mt-7">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2.5 h-3 w-full" />
      </div>
    </SkeletonScreen>
  );
}
