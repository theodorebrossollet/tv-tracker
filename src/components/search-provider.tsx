"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { SearchOverlay } from "@/components/search-overlay";

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
 * — the nav icon, and the "Find a show" buttons on the empty states.
 */
export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Memoised on `isOpen`: without it every consumer of this context re-renders
  // on any parent render, and the tab bar is now one of them on every screen.
  const value = useMemo(() => ({ open, isOpen }), [open, isOpen]);

  return (
    <SearchContext.Provider value={value}>
      {children}
      {isOpen ? <SearchOverlay onClose={close} /> : null}
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
