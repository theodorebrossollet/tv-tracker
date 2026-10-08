import type { SuggestionKind } from "@/lib/discover-limits";

// Plain types shared by `lib/discover.ts` (server) and the Discover client
// components. Types only: `discover.ts` reads prisma and TMDB, so a client
// component importing these from there would drag the server modules along.

/** What the deck is narrowed to; parsed from the URL by `parseDeckFilters`. */
export interface DeckFilters {
  kind: "any" | "movie" | "show";
  /** Movies under two hours only; shows are left out while it is on. */
  short: boolean;
  /** One of the caller's lists; null means the whole watchlist. */
  listId: string | null;
  /**
   * How many times the visitor has asked for a fresh pick of their own titles
   * today; 0 until they do. It is part of the pick's seed, so a new number is a
   * new set of cards.
   */
  shuffle: number;
}

export type DeckCard =
  | {
      source: "own";
      kind: SuggestionKind;
      id: string;
      title: string;
      posterPath: string | null;
      year: string | null;
    }
  | {
      source: "recommended";
      kind: SuggestionKind;
      id: string;
      title: string;
      posterPath: string | null;
      year: string | null;
      becauseTitle: string;
      /** A show seed's rating is its show average, so it may be fractional. */
      becauseRating: number;
    };

export interface Deck {
  cards: DeckCard[];
  /** Qualifying seeds; under `MIN_SEEDS` means no recommendations were tried. */
  seedCount: number;
  /** Recommendations were wanted but TMDB failed or the load was throttled. */
  recommendationsUnavailable: boolean;
}

/** The extra detail a card shows when scrolled down (loaded lazily). */
export interface CardDetails {
  overview: string | null;
  genres: string | null;
  runtime: number | null;
  cast: Array<{ id: number; name: string; character: string | null }>;
  trailerKey: string | null;
  providers: string[];
}
