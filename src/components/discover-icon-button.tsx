import Link from "next/link";

/**
 * The round Discover link in the dashboard header, beside search.
 *
 * Sized like `SearchIconButton` — 40px of circle inside 44px of hit area — so
 * the two read as one pair. A link rather than a button: Discover is a page.
 * No "use client": nothing here runs in the browser.
 */
export function DiscoverIconButton() {
  return (
    <Link
      href="/discover"
      aria-label="Discover"
      className="-m-0.5 flex size-11 shrink-0 items-center justify-center"
    >
      <span className="flex size-10 items-center justify-center rounded-full border border-border text-muted transition-colors hover:bg-surface hover:text-foreground">
        <SparkleIcon className="size-[17px]" />
      </span>
    </Link>
  );
}

/** Four-point sparkles: one large, one small. Drawn, so there is no text. */
export function SparkleIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M10 3c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6Z" />
      <path d="M18 14c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3Z" />
    </svg>
  );
}
