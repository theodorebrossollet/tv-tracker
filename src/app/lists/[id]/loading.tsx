import {
  Skeleton,
  SkeletonListRow,
  SkeletonScreen,
} from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen>
      <div className="flex items-center justify-between gap-2.5">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="size-8 rounded-full" />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-10 w-28 rounded-full" />
      </div>

      <div className="mt-[18px] flex flex-col gap-2">
        {Array.from({ length: 4 }, (_, index) => (
          <SkeletonListRow key={index} />
        ))}
      </div>
    </SkeletonScreen>
  );
}
