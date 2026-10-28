import Link from "next/link";

import { initials } from "@/lib/initials";

/**
 * The round initials avatar in the top-right of each top-level screen, which
 * opens the profile page — where Settings lives now that it no longer has a
 * tab of its own.
 *
 * 40px of circle inside 44px of hit area, the size the old round header
 * buttons used, so the headers that swapped one for this keep their height.
 * That matters most on Discover, whose deck is sized to the pixel against the
 * screen. No "use client": it is a link and nothing else.
 */
export function ProfileButton({ nickname }: { nickname: string | null }) {
  return (
    <Link
      href="/settings"
      aria-label="Profile and settings"
      className="-m-0.5 flex size-11 shrink-0 items-center justify-center"
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full border border-accent-border bg-accent-tint text-[15px] font-semibold tracking-[-0.01em] text-accent-deep"
      >
        {initials(nickname)}
      </span>
    </Link>
  );
}
