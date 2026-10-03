import type { SuggestionKind } from "@/lib/discover-limits";
import type { TmdbRecommendation } from "@/lib/tmdb";

// ---- Ranking (pure: no I/O, no prisma) --------------------------------

/** A title counts as a seed only when rated at least this high. */
export const MIN_SEED_RATING = 8;
/** Fewest qualifying seeds needed before suggestions are shown. */
export const MIN_SEEDS = 3;
/** Most seeds queried per refresh; bounds TMDB calls. */
export const MAX_SEEDS = 10;
/** Candidates with fewer TMDB votes are dropped as noise. */
export const MIN_VOTES = 100;

export interface Seed {
  kind: SuggestionKind;
  id: string;
  title: string;
  rating: number;
}

export interface RankedSuggestion {
  candidate: TmdbRecommendation;
  becauseTitle: string;
  becauseRating: number;
}

interface Entry {
  candidate: TmdbRecommendation;
  seedKeys: Set<string>;
  ratingSum: number;
  best: Seed;
}

function seedKey(s: Seed): string {
  return `${s.kind}:${s.id}`;
}

/** True when `a` should be preferred over `b` as the "because" seed. */
function betterSeed(a: Seed, b: Seed): boolean {
  if (a.rating !== b.rating) return a.rating > b.rating;
  return seedKey(a) < seedKey(b);
}

/**
 * Ranks recommendation candidates: most distinct seeds first, then the
 * higher summed seed rating, then TMDB `voteAverage`, then kind and id so
 * the order never depends on input order.
 */
export function rankCandidates(
  lists: Array<{ seed: Seed; candidates: TmdbRecommendation[] }>,
  exclude: (c: TmdbRecommendation) => boolean,
): RankedSuggestion[] {
  const entries = new Map<string, Entry>();

  for (const { seed, candidates } of lists) {
    const sk = seedKey(seed);
    for (const candidate of candidates) {
      if (candidate.voteCount < MIN_VOTES || exclude(candidate)) continue;
      const key = `${candidate.kind}:${candidate.id}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = { candidate, seedKeys: new Set(), ratingSum: 0, best: seed };
        entries.set(key, entry);
      }
      if (entry.seedKeys.has(sk)) continue;
      entry.seedKeys.add(sk);
      entry.ratingSum += seed.rating;
      if (betterSeed(seed, entry.best)) {
        entry.best = seed;
        entry.candidate = candidate;
      }
    }
  }

  return [...entries.values()]
    .sort(
      (a, b) =>
        b.seedKeys.size - a.seedKeys.size ||
        b.ratingSum - a.ratingSum ||
        b.candidate.voteAverage - a.candidate.voteAverage ||
        (a.candidate.kind < b.candidate.kind
          ? -1
          : a.candidate.kind > b.candidate.kind
            ? 1
            : 0) ||
        (a.candidate.id < b.candidate.id
          ? -1
          : a.candidate.id > b.candidate.id
            ? 1
            : 0),
    )
    .map((e) => ({
      candidate: e.candidate,
      becauseTitle: e.best.title,
      becauseRating: e.best.rating,
    }));
}
