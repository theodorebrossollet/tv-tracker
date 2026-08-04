"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSearch } from "@/components/search-provider";

/**
 * Routes that render without the tab bar.
 *
 * Signing in is the whole reason these exist, and every tab points somewhere
 * gated — a bar here would advertise four destinations that all bounce back to
 * `/login`. The old top nav did render on them, which mattered less when it was
 * a row of pills than it does as a full-width bar pinned above the thumb.
 */
const BARE = ["/login", "/welcome"];

interface Tab {
  label: string;
  /** Absent on Search, which opens the overlay instead of navigating. */
  href?: string;
  /** Extra routes that also count as this tab. */
  also?: string[];
  icon: React.ReactNode;
}

/**
 * Library is one screen over two routes. `/watchlist` and `/archive` are its
 * two segments rather than separate destinations, so the tab is active for
 * both and points at whichever is the more common entry.
 */
const TABS: Tab[] = [
  { label: "Watching", href: "/", icon: <TvIcon /> },
  {
    label: "Library",
    href: "/watchlist",
    also: ["/archive"],
    // The same bookmark the empty Watchlist draws, so the tab and the screen
    // it leads to agree about what Library means.
    icon: <BookmarkIcon />,
  },
  { label: "Search", icon: <SearchGlyph /> },
  { label: "Settings", href: "/settings", icon: <SlidersIcon /> },
];

const TAB_CLASS =
  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[10.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

export function TabBar() {
  const pathname = usePathname();
  const { open, isOpen } = useSearch();

  if (BARE.some((route) => pathname.startsWith(route))) return null;

  function isActive(tab: Tab): boolean {
    // Search has no route to match against — the provider is the only thing
    // that knows whether it is showing.
    if (!tab.href) return isOpen;

    // The dashboard is every path's prefix, so it has to match exactly.
    if (tab.href === "/") return pathname === "/";

    return [tab.href, ...(tab.also ?? [])].some((route) =>
      pathname.startsWith(route),
    );
  }

  return (
    <nav
      aria-label="Main"
      // Fixed rather than an inner scroll container. The prototype nests each
      // screen in a `flex: 1; min-height: 0; overflow-y: auto` region, but that
      // is an artifact of drawing phones as fixed 390x844 boxes: in a real
      // browser it costs scroll restoration (Next restores window scroll, not a
      // div's, so dashboard -> show -> back loses your place) and permanently
      // disables the URL bar collapsing on scroll. The page scrolls the
      // document; only this bar is pinned.
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/92 backdrop-blur"
    >
      <div
        // The inset is what the prototype drew as a fixed 4px "home indicator
        // strip". Reading the real value needs `viewportFit: "cover"` in the
        // viewport export, or it resolves to 0 on iOS and the bar sits under
        // the gesture bar.
        className="mx-auto grid max-w-lg grid-cols-4 px-1.5 pb-[env(safe-area-inset-bottom)] pt-2"
      >
        {TABS.map((tab) => {
          const active = isActive(tab);
          const className = `${TAB_CLASS} ${
            active ? "text-accent-deep" : "text-faint"
          }`;

          // Search is a tab, but it opens the overlay rather than navigating —
          // so there is no route to gate, no scroll position to lose, and the
          // debounce and Escape handling in `search-overlay.tsx` are reused as
          // they are.
          if (!tab.href) {
            return (
              <button
                key={tab.label}
                type="button"
                onClick={open}
                aria-haspopup="dialog"
                aria-expanded={active}
                className={className}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          }

          return (
            <Link
              key={tab.label}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={className}
            >
              {tab.icon}
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Shared geometry for the four glyphs.
 *
 * `currentColor` throughout, so the active state is one colour change on the
 * parent rather than four icons each knowing about it.
 */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[21px]"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function TvIcon() {
  return (
    <Glyph>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="m7 3 5 4 5-4" />
    </Glyph>
  );
}

function BookmarkIcon() {
  return (
    <Glyph>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </Glyph>
  );
}

function SearchGlyph() {
  return (
    <Glyph>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Glyph>
  );
}

function SlidersIcon() {
  return (
    <Glyph>
      <path d="M4 8h5" />
      <path d="M13 8h7" />
      <path d="M4 16h11" />
      <path d="M19 16h1" />
      <circle cx="11" cy="8" r="2.2" />
      <circle cx="17" cy="16" r="2.2" />
    </Glyph>
  );
}
