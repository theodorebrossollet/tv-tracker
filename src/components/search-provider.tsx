"use client";

import { createContext, useCallback, useContext, useState } from "react";

import { SearchOverlay } from "@/components/search-overlay";

interface SearchContextValue {
  open: () => void;
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

  return (
    <SearchContext.Provider value={{ open }}>
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
