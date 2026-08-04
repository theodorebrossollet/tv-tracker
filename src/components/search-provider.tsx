"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { SearchOverlay } from "@/components/search-overlay";

/** How many recent searches to keep. Enough to be useful, few enough to scan. */
const RECENT_LIMIT = 6;

interface SearchContextValue {
  open: () => void;
  /**
   * Whether the overlay is showing. The tab bar needs it: Search is a tab like
   * any other, but it has no route to match `usePathname` against, so this is
   * the only thing that can mark it active.
   */
  isOpen: boolean;
}

const SearchContext = createContext<SearchContextValue | null>(null);

/**
 * Holds the search overlay's open state so anything in the tree can trigger it
 * — the tab bar, the header icon, and the "Find a show" buttons on the empty
 * states.
 *
 * Recent searches live here, in memory, for the length of the session. Not
 * `localStorage`: this is an invite-only app whose accounts share devices among
 * family, and a list of what someone searched for surviving sign-out is a
 * privacy leak nobody asked for. Losing them on reload costs a retype.
 */
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const remember = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setRecent((current) => [
      trimmed,
      // Case-insensitive, so "severance" doesn't sit under "Severance".
      ...current.filter(
        (entry) => entry.toLowerCase() !== trimmed.toLowerCase(),
      ),
    ].slice(0, RECENT_LIMIT));
  }, []);

  // Memoised: without it every consumer re-renders on any parent render, and
  // the tab bar is one of them on every screen.
  const value = useMemo(() => ({ open, isOpen }), [open, isOpen]);

  return (
    <SearchContext.Provider value={value}>
      {children}
      {isOpen ? (
        <SearchOverlay onClose={close} recent={recent} onRemember={remember} />
      ) : null}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);

  if (!context) {
    throw new Error("useSearch must be used inside <SearchProvider>");
  }

  return context;
}
