import { PULL_THRESHOLD } from "@/lib/pull-to-refresh";

/**
 * The arrow that turns as a pull approaches the threshold, pointing up once
 * letting go would refresh. Shared so the show page's strip and the lists'
 * indicator draw the same gesture the same way.
 */
export function PullArrow({ pull }: { pull: number }) {
  return (
    <span
      aria-hidden="true"
      className="transition-transform"
      style={{
        transform: `rotate(${Math.min(180, (pull / PULL_THRESHOLD) * 180)}deg)`,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-[11px]"
      >
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    </span>
  );
}

/** The spinner both refresh indicators show while one is in flight. */
export function RefreshSpinner() {
  return (
    <span
      aria-hidden="true"
      className="size-[11px] animate-spin rounded-full border-[1.5px] border-border border-t-accent motion-reduce:animate-none"
    />
  );
}
