"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SearchIcon } from "@/components/search-overlay";
import { useSearch } from "@/components/search-provider";

const LINKS = [
  { href: "/", label: "Watching" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/archive", label: "Archive" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const { open } = useSearch();

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-5xl items-center gap-1 px-4 py-3 sm:gap-2 sm:px-6">
        <Link
          href="/"
          className="mr-2 shrink-0 text-sm font-semibold tracking-tight sm:mr-4"
        >
          TV Tracker
        </Link>

        {LINKS.map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-surface hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={open}
          aria-label="Search shows"
          title="Search shows"
          className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <SearchIcon className="size-[18px]" />
        </button>
      </nav>
    </header>
  );
}
