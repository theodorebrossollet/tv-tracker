import { Skeleton, SkeletonScreen } from "@/components/skeleton";

export default function Loading() {
  return (
    <SkeletonScreen>
      <Skeleton className="h-7 w-28" />
      <Skeleton className="mx-auto mt-[18px] aspect-[2/3] w-full max-w-sm rounded-2xl" />
    </SkeletonScreen>
  );
}
