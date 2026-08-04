/**
 * Placeholder shapes for the `loading.tsx` files.
 *
 * Every screen in this app is `force-dynamic`, so a tab tap waits on a server
 * render before anything can change. Without a loading boundary the browser
 * shows the *old* screen for that whole time and the tapped tab doesn't even
 * light up, which reads as the app ignoring you — reported from a phone as
 * "slow when switching between tabs". The wait is the same length either way;
 * what changes is whether it looks like progress or like a freeze.
 *
 * Shapes rather than a spinner: matching the layout that is about to arrive
 * means the screen settles into place instead of being replaced.
 */

/** One pulsing block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-surface ${className}`} />;
}

/**
 * Wraps a screen's placeholders.
 *
 * `role="status"` with a hidden label, because a screen reader gets nothing
 * from grey rectangles and should be told the page is loading. The pulse stops
 * for anyone who has asked for less motion.
 */
export function SkeletonScreen({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
        {children}
      </div>
    </div>
  );
}

/** The 25px screen title, with the round search button beside it. */
export function SkeletonHeader() {
  return (
    <div className="flex items-center justify-between gap-2.5">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="size-10 rounded-full" />
    </div>
  );
}

/** A dashboard show card: poster, title, progress bar, next episode. */
export function SkeletonShowCard() {
  return (
    <div className="flex gap-3 rounded-[15px] border border-border p-[11px]">
      <Skeleton className="h-[78px] w-[52px] shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[7px]">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-1 w-full rounded-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

/** A library row: smaller poster, name, detail line. */
export function SkeletonListRow() {
  return (
    <div className="flex items-center gap-3 rounded-[15px] border border-border p-[11px]">
      <Skeleton className="h-[66px] w-[44px] shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="size-8 shrink-0 rounded-full" />
    </div>
  );
}

/** A settings group: mono label, then a card of rows. */
export function SkeletonGroup({ rows }: { rows: number }) {
  return (
    <div className="mt-[22px]">
      <Skeleton className="h-2.5 w-24" />
      <div className="mt-2.5 divide-y divide-border-faint overflow-hidden rounded-[14px] border border-border">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex h-[52px] items-center px-3.5">
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
