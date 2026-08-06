import Link from "next/link";

import { carryParams, oneParam } from "@/lib/search-params";

interface ShowMoreLinkProps {
  /** Search-param name this list reveals itself with. */
  param: string;
  /** Every param currently on the URL, so expanding one list keeps the others. */
  current: Record<string, string | string[] | undefined>;
  /** Rows to reveal on click. */
  step: number;
  /** Rows currently shown. */
  shown: number;
  /** Rows still hidden. */
  remaining: number;
  label: string;
}

/**
 * The "show more" control for the server-rendered lists.
 *
 * A link rather than a button, because the reveal is a different URL rather
 * than client state. That's what lets the lists stay server components: the
 * rows never cross into the client bundle, and the page renders only as many
 * as the URL asks for instead of shipping every row and hiding most of them.
 *
 * `scroll={false}` matters more than it looks. Next scrolls to the top on
 * navigation, which for a control at the bottom of a long list would throw the
 * reader back where they started every time they asked for more.
 *
 * Other params are carried across so two lists on one page (Archive's Finished
 * and Stopped) expand independently rather than collapsing each other — but
 * only the ones this app actually reads. See `lib/search-params.ts` for why
 * copying the URL wholesale was the wrong shape.
 */
export function ShowMoreLink({
  param,
  current,
  step,
  shown,
  remaining,
  label,
}: ShowMoreLinkProps) {
  const next = carryParams(current, param);

  next.set(param, String(shown + step));

  return (
    <Link
      href={`?${next.toString()}`}
      scroll={false}
      className="mt-3.5 flex min-h-[46px] w-full items-center justify-center rounded-[13px] border border-border text-sm text-muted transition-colors hover:bg-surface hover:text-foreground"
    >
      {label} {Math.min(step, remaining)} more
      <span className="ml-1.5 text-xs">({remaining} left)</span>
    </Link>
  );
}

/**
 * Reads a list's row limit off the URL.
 *
 * Anything that isn't a positive integer falls back to the default — the value
 * is attacker-supplied like any query param, and an unbounded one would let a
 * link ask the server to render every row it has.
 */
export function limitFrom(
  searchParams: Record<string, string | string[] | undefined>,
  param: string,
  fallback: number,
  max = 500,
): number {
  const parsed = Number(oneParam(searchParams, param));

  if (!Number.isInteger(parsed) || parsed < 1) return fallback;

  return Math.min(parsed, max);
}
