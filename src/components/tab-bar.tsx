"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";

import { useSearch } from "@/components/search-provider";

/**
 * Routes that render without the tab bar.
 *
 * Signing in is the whole reason these exist, and every tab points somewhere
 * gated — a bar here would advertise five destinations that all bounce back to
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
  /** Active on the route itself and anything beneath it, not on lookalikes. */
  segment?: boolean;
  icon: React.ReactNode;
}

/**
 * Settings has no tab: it is visited rarely, and its slot went to Discover,
 * which used to hide behind a small icon in the Watching header. It is reached
 * from the initials avatar at the top of each of these screens instead
 * (`ProfileButton`).
 *
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
  {
    label: "Discover",
    href: "/discover",
    segment: true,
    icon: <SparkleIcon />,
  },
  {
    label: "Lists",
    href: "/lists",
    // Matched as a segment, not a prefix: see `isActive`.
    segment: true,
    icon: <ListIcon />,
  },
  { label: "Search", icon: <SearchGlyph /> },
];

const TAB_CLASS =
  "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[22px] text-[10.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

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

    // `/lists` and `/lists/abc`, but not a future `/listsomething`.
    if (tab.segment) {
      return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    }

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
      //
      // A floating capsule, the shape iOS 26 gives its own tab bars, rather
      // than a full-width strip: the page shows around and through it, and it
      // sits just above the home indicator instead of reserving the strip
      // beside it. The geometry lives in globals.css (`--tab-bar-gap`,
      // `--tab-bar-room`) because `main` and Discover's deck are sized against
      // it. This element only positions; it lets touches through, so the
      // margins either side of the capsule stay part of the page.
      className="pointer-events-none fixed inset-x-0 bottom-[var(--tab-bar-gap)] z-20 px-4"
    >
      <div
        // `viewportFit: "cover"` in the viewport export is still load-bearing:
        // without it iOS reports the inset as 0, and the capsule sits on the
        // home indicator.
        className="pointer-events-auto mx-auto grid max-w-md grid-cols-5 rounded-[28px] border border-border bg-surface/75 p-1 shadow-[0_12px_30px_rgba(0,0,0,.45)] backdrop-blur-xl backdrop-saturate-150"
      >
        {TABS.map((tab) => {
          const active = isActive(tab);
          // The selected tab gets a lozenge of its own inside the capsule, as
          // iOS draws it, as well as the colour.
          const className = `${TAB_CLASS} ${
            active ? "bg-accent-tint text-accent-deep" : "text-faint"
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
              <Pressed>{tab.icon}</Pressed>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Marks a tab as tapped before its screen arrives.
 *
 * Every route here is `force-dynamic`, so a tap waits on a server render. The
 * `loading.tsx` files cover the destination; this covers the moment before it,
 * while the router is still fetching and the old screen is still on display —
 * which is the part that read as the app ignoring the tap.
 *
 * `useLinkStatus` only works inside a `<Link>`, which is why this is a
 * component rather than a prop.
 */
function Pressed({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();

  return (
    <span
      className={`transition-opacity ${pending ? "animate-pulse opacity-60 motion-reduce:animate-none" : ""}`}
    >
      {children}
    </span>
  );
}

/**
 * Shared geometry for the glyphs.
 *
 * `currentColor` throughout, so the active state is one colour change on the
 * parent rather than one per icon each knowing about it.
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

function ListIcon() {
  return (
    <Glyph>
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
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

/** Four-point sparkles, one large and one small: Discover's mark. */
function SparkleIcon() {
  return (
    <Glyph>
      <path d="M10 3c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6Z" />
      <path d="M18 14c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3Z" />
    </Glyph>
  );
}
