"use client";

import type { DeckCard, DeckFilters } from "@/lib/discover-types";

export interface DiscoverDeckProps {
  cards: DeckCard[];
  seedCount: number;
  recommendationsUnavailable: boolean;
  filters: DeckFilters;
  lists: Array<{ id: string; name: string }>;
}

// Stub: the swipe deck lands in the next task.
export function DiscoverDeck(props: DiscoverDeckProps) {
  void props;
  return null;
}
