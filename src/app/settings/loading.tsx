import {
  Skeleton,
  SkeletonGroup,
  SkeletonScreen,
} from "@/components/skeleton";

/**
 * Settings waits on TMDB for the country and service lists, not just the
 * database — a cold instance re-fetches both — so this is the screen where the
 * wait is most likely to be noticed.
 */
export default function Loading() {
  return (
    <SkeletonScreen>
      <Skeleton className="h-7 w-32" />
      <SkeletonGroup rows={3} />
      <SkeletonGroup rows={2} />
      <SkeletonGroup rows={4} />
    </SkeletonScreen>
  );
}
