import "server-only";

import { createHash } from "node:crypto";

import { MIN_SEEDS, type SuggestionKind } from "@/lib/discover-limits";
import type { Deck, DeckCard, DeckFilters } from "@/lib/discover-types";
import { easternDateKey } from "@/lib/format";
import { describeError, logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getListDetail, loadShowRatings } from "@/lib/queries";
import { oneParam, type SearchParams } from "@/lib/search-params";
import { getRecommendations, type TmdbRecommendation } from "@/lib/tmdb";

export type {
  CardDetails,
  Deck,
  DeckCard,
  DeckFilters,
} from "@/lib/discover-types";

// ---- Ranking (pure: no I/O, no prisma) --------------------------------

/** A title counts as a seed only when rated at least this high. */
export const MIN_SEED_RATING = 8;
// MIN_SEEDS lives in the client-safe limits module: the deck UI needs it too.
export { MIN_SEEDS };
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

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
        compare(a.candidate.kind, b.candidate.kind) ||
        compare(a.candidate.id, b.candidate.id),
    )
    .map((e) => ({
      candidate: e.candidate,
      becauseTitle: e.best.title,
      becauseRating: e.best.rating,
    }));
}

// ---- Seeds and deck (reads; every query carries the caller's userId) ---

/** Most recommended cards in one deck. */
export const MAX_RECOMMENDED_CARDS = 20;
/** Most of the caller's own titles in one deck. */
export const MAX_OWN_CARDS = 10;
/** "Under 2h": a movie qualifies when its runtime is below this. */
export const SHORT_RUNTIME_MINUTES = 120;
/**
 * Deck loads per account per minute that may query TMDB. Generous on purpose:
 * every add or dismiss revalidates `/discover`, so each swipe on a
 * recommendation is a load, and at 6 a normal run of swipes emptied the deck
 * mid-session. Per-seed answers are cached for 24h, so repeat loads are cheap.
 */
export const DECK_LOADS_PER_MINUTE = 30;

const MINUTE_MS = 60_000;
const LIST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The caller's tracked titles rated at least `MIN_SEED_RATING`, most recently
 * rated first, at most `MAX_SEEDS`.
 *
 * There is no "rated at" column, so the watch date stands in for it: a movie's
 * `watchedAt`, and for a show the latest watch among its RATED current-run
 * episodes (an unrated later episode says nothing about the rating). A show's
 * rating is its show average from `loadShowRatings`, the Library's own rule.
 */
export async function getSeeds(userId: string): Promise<Seed[]> {
  const [movies, shows] = await Promise.all([
    prisma.trackedMovie.findMany({
      where: { userId, status: "watched", rating: { gte: MIN_SEED_RATING } },
      select: {
        movieId: true,
        rating: true,
        watchedAt: true,
        addedAt: true,
        movie: { select: { title: true } },
      },
    }),
    prisma.trackedShow.findMany({
      where: { userId },
      select: { showId: true, show: { select: { name: true } } },
    }),
  ]);

  const dated: Array<{ seed: Seed; at: number }> = movies.map((m) => ({
    seed: {
      kind: "movie",
      id: m.movieId,
      title: m.movie.title,
      rating: m.rating ?? 0,
    },
    at: (m.watchedAt ?? m.addedAt).getTime(),
  }));

  if (shows.length > 0) {
    const averages = await loadShowRatings(
      userId,
      shows.map((s) => s.showId),
    );
    const qualifying = shows.filter(
      (s) => (averages.get(s.showId) ?? 0) >= MIN_SEED_RATING,
    );

    if (qualifying.length > 0) {
      const ratedWatches = await prisma.watchedEpisode.findMany({
        where: {
          userId,
          rating: { not: null },
          episode: { showId: { in: qualifying.map((s) => s.showId) } },
        },
        select: { watchedAt: true, episode: { select: { showId: true } } },
      });
      const latest = new Map<string, number>();
      for (const w of ratedWatches) {
        const t = w.watchedAt.getTime();
        if (t > (latest.get(w.episode.showId) ?? -Infinity)) {
          latest.set(w.episode.showId, t);
        }
      }

      for (const s of qualifying) {
        dated.push({
          seed: {
            kind: "show",
            id: s.showId,
            title: s.show.name,
            rating: averages.get(s.showId)!,
          },
          at: latest.get(s.showId) ?? 0,
        });
      }
    }
  }

  return dated
    .sort(
      (a, b) =>
        b.at - a.at || compare(seedKey(a.seed), seedKey(b.seed)),
    )
    .slice(0, MAX_SEEDS)
    .map((d) => d.seed);
}

/**
 * Reads the deck filters off the URL: `?kind=movie|show`, `?short=1`,
 * `?list=<id>`. Anything else, including a mangled value, is the default, so
 * a bad link lands on the full deck rather than an error.
 */
export function parseDeckFilters(params: SearchParams): DeckFilters {
  const kind = oneParam(params, "kind");
  const list = oneParam(params, "list");
  return {
    kind: kind === "movie" || kind === "show" ? kind : "any",
    short: oneParam(params, "short") === "1",
    listId: list && LIST_ID_PATTERN.test(list) ? list : null,
  };
}

// In-process, so it bounds TMDB use per server instance only. That is enough
// for its purpose (a reload loop or a stuck client), and TMDB answers are
// cached for 24h anyway; it is not a security boundary.
const deckLoads = new Map<string, number[]>();

/** Records a deck load that would query TMDB; false once over the limit. */
function takeDeckLoad(userId: string, now: number): boolean {
  const recent = (deckLoads.get(userId) ?? []).filter(
    (t) => now - t < MINUTE_MS,
  );
  if (recent.length >= DECK_LOADS_PER_MINUTE) {
    deckLoads.set(userId, recent);
    return false;
  }
  recent.push(now);
  deckLoads.set(userId, recent);
  return true;
}

/** Test-only: forget every recorded deck load. */
export function resetDeckThrottleForTests(): void {
  deckLoads.clear();
}

function utcYear(date: Date | null): string | null {
  return date ? String(date.getUTCFullYear()) : null;
}

export interface OwnTitle {
  card: DeckCard & { source: "own" };
  runtime: number | null;
  addedAt: number;
}

/** The caller's watchlist movies and shows (the whole watchlist). */
async function loadWatchlist(userId: string): Promise<OwnTitle[]> {
  const [movies, shows] = await Promise.all([
    prisma.trackedMovie.findMany({
      where: { userId, status: "watchlist" },
      select: {
        addedAt: true,
        movie: {
          select: {
            id: true,
            title: true,
            posterPath: true,
            releaseDate: true,
            runtime: true,
          },
        },
      },
    }),
    prisma.trackedShow.findMany({
      where: { userId, status: "watchlist" },
      select: {
        addedAt: true,
        show: {
          select: { id: true, name: true, posterPath: true, firstAirDate: true },
        },
      },
    }),
  ]);

  const titles: OwnTitle[] = [
    ...movies.map(({ addedAt, movie }) => ({
      card: {
        source: "own" as const,
        kind: "movie" as const,
        id: movie.id,
        title: movie.title,
        posterPath: movie.posterPath,
        year: utcYear(movie.releaseDate),
      },
      runtime: movie.runtime,
      addedAt: addedAt.getTime(),
    })),
    ...shows.map(({ addedAt, show }) => ({
      card: {
        source: "own" as const,
        kind: "show" as const,
        id: show.id,
        title: show.name,
        posterPath: show.posterPath,
        year: utcYear(show.firstAirDate),
      },
      runtime: null,
      addedAt: addedAt.getTime(),
    })),
  ];

  return titles.sort(
    (a, b) =>
      b.addedAt - a.addedAt ||
      compare(
        `${a.card.kind}:${a.card.id}`,
        `${b.card.kind}:${b.card.id}`,
      ),
  );
}

/** How quickly the head start of a recently added title fades, in days. */
const FAVOUR_HALF_LIFE_DAYS = 30;

/**
 * A repeatable number in (0, 1) for one title on one day: the hash of the two,
 * so it depends on nothing else in the pool.
 */
function unitFor(seed: string, titleKey: string): number {
  const bytes = createHash("sha256").update(`${seed}|${titleKey}`).digest();
  // The first 6 bytes: 48 bits, exact in a double.
  const n = bytes.readUIntBE(0, 6);
  return (n + 0.5) / 2 ** 48;
}

/**
 * Which of the caller's own titles go in today's deck: a weighted random pick
 * of at most `max` from the whole pool, not the newest few.
 *
 * Every title has a chance, and a recently added one a better one: weight is 1
 * for an old title, rising to 3 for one added just now and halving its head
 * start every 30 days. The pick is Efraimidis-Spirakis sampling (each title gets
 * the key `u^(1/weight)` and the largest keys win), with `u` a hash of the seed
 * and the title. That makes it repeatable for a given seed, and, because a
 * title's key does not depend on the others, stable: adding or removing a title
 * changes at most one of the cards. The seed is the account plus the Eastern
 * calendar day, so the deck is the same all day (every add or dismiss
 * re-renders the page and rebuilds it) and different tomorrow.
 *
 * The result is in key order, which is the order the cards are dealt in.
 */
export function pickOwnTitles(
  titles: OwnTitle[],
  seed: string,
  now: Date,
  max: number = MAX_OWN_CARDS,
): OwnTitle[] {
  const DAY_MS = 24 * 60 * 60 * 1000;

  return titles
    .map((title) => {
      const titleKey = `${title.card.kind}:${title.card.id}`;
      const ageDays = Math.max(0, (now.getTime() - title.addedAt) / DAY_MS);
      const weight = 1 + 2 * 0.5 ** (ageDays / FAVOUR_HALF_LIFE_DAYS);
      // log(u^(1/w)) = log(u)/w, which orders the same and avoids underflow.
      return { title, titleKey, key: Math.log(unitFor(seed, titleKey)) / weight };
    })
    .sort((a, b) => b.key - a.key || compare(a.titleKey, b.titleKey))
    .slice(0, Math.max(0, max))
    .map(({ title }) => title);
}

/**
 * One of the caller's lists, unwatched items only, in the list's own order.
 * `getListDetail` decides "watched" (through `isListItemWatched`, honouring
 * the list's `trackSeparately` and the Library's "finished" rule), and returns
 * null for a list that is not the caller's, which leaves the pool empty.
 *
 * Library status otherwise doesn't matter (a family list holds titles nobody
 * put on a watchlist), except that a movie the caller marked not interested
 * or a show they stopped is never offered. `status` is the caller's own: the
 * list read joins tracking by `userId`.
 */
async function loadListTitles(
  userId: string,
  listId: string,
): Promise<OwnTitle[]> {
  const detail = await getListDetail(userId, listId);
  if (!detail) return [];

  const unwatched = detail.items.filter(
    (item) =>
      !item.watched &&
      item.status !== (item.kind === "movie" ? "not_interested" : "stopped"),
  );
  const movieIds = unwatched
    .filter((item) => item.kind === "movie")
    .map((item) => item.titleId);
  const runtimes = new Map(
    movieIds.length > 0
      ? (
          await prisma.movie.findMany({
            where: { id: { in: movieIds } },
            select: { id: true, runtime: true },
          })
        ).map((m) => [m.id, m.runtime])
      : [],
  );

  return unwatched.map((item) => ({
    card: {
      source: "own",
      kind: item.kind,
      id: item.titleId,
      title: item.title,
      posterPath: item.posterPath,
      year: item.year,
    },
    runtime: item.kind === "movie" ? (runtimes.get(item.titleId) ?? null) : null,
    addedAt: item.addedAt.getTime(),
  }));
}

/**
 * Every `${kind}:${id}` the caller already has an opinion on: tracked in any
 * status, on any of their lists, or dismissed. Built from the caller's rows
 * only, so another account's tracks never hide a suggestion.
 */
async function loadExclusions(userId: string): Promise<Set<string>> {
  const [movies, shows, items, dismissed] = await Promise.all([
    prisma.trackedMovie.findMany({ where: { userId }, select: { movieId: true } }),
    prisma.trackedShow.findMany({ where: { userId }, select: { showId: true } }),
    prisma.listItem.findMany({
      where: { list: { userId } },
      select: { movieId: true, showId: true },
    }),
    prisma.dismissedSuggestion.findMany({
      where: { userId },
      select: { kind: true, tmdbId: true },
    }),
  ]);

  const keys = new Set<string>();
  for (const m of movies) keys.add(`movie:${m.movieId}`);
  for (const s of shows) keys.add(`show:${s.showId}`);
  for (const item of items) {
    if (item.movieId) keys.add(`movie:${item.movieId}`);
    if (item.showId) keys.add(`show:${item.showId}`);
  }
  for (const d of dismissed) keys.add(`${d.kind}:${d.tmdbId}`);
  return keys;
}

/**
 * Asks TMDB once per seed. One failing seed is dropped and the rest kept;
 * null only when every call failed.
 */
async function fetchRecommendations(
  seeds: Seed[],
): Promise<Array<{ seed: Seed; candidates: TmdbRecommendation[] }> | null> {
  const results = await Promise.allSettled(
    seeds.map((seed) => getRecommendations(seed.kind, seed.id)),
  );

  const lists: Array<{ seed: Seed; candidates: TmdbRecommendation[] }> = [];
  const failures: unknown[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      lists.push({ seed: seeds[i], candidates: result.value });
    } else {
      failures.push(result.reason);
    }
  });

  if (failures.length > 0) {
    logger.warn("discover.recommendations_failed", {
      failed: failures.length,
      seeds: seeds.length,
      ...describeError(failures[0]),
    });
  }

  return lists.length > 0 || seeds.length === 0 ? lists : null;
}

/** Two recommended, then one own, repeating; the rest of either appended. */
function interleave(recommended: DeckCard[], own: DeckCard[]): DeckCard[] {
  const cards: DeckCard[] = [];
  let r = 0;
  let o = 0;
  while (r < recommended.length || o < own.length) {
    for (let n = 0; n < 2 && r < recommended.length; n++) {
      cards.push(recommended[r++]);
    }
    if (o < own.length) cards.push(own[o++]);
  }
  return cards;
}

/**
 * The Discover deck: up to `MAX_RECOMMENDED_CARDS` ranked recommendations
 * interleaved with up to `MAX_OWN_CARDS` of the caller's own to-watch titles.
 *
 * Never throws on a TMDB failure: the deck falls back to own titles and says
 * `recommendationsUnavailable`. Recommendations are not attempted at all with
 * fewer than `MIN_SEEDS` seeds, with "Under 2h" on (a candidate carries no
 * runtime to check), or with a list chosen (the pool is that list).
 */
export async function getDeck(
  userId: string,
  filters: DeckFilters,
  options: { now?: Date } = {},
): Promise<Deck> {
  const now = options.now ?? new Date();
  const [seeds, ownPool] = await Promise.all([
    getSeeds(userId),
    filters.listId
      ? loadListTitles(userId, filters.listId)
      : loadWatchlist(userId),
  ]);

  const matchesKind = (kind: SuggestionKind) =>
    filters.kind === "any" || filters.kind === kind;

  const own = pickOwnTitles(
    ownPool.filter(
      (t) =>
        matchesKind(t.card.kind) &&
        (!filters.short ||
          (t.card.kind === "movie" &&
            t.runtime !== null &&
            t.runtime < SHORT_RUNTIME_MINUTES)),
    ),
    `${userId}:${easternDateKey(now)}`,
    now,
  ).map((t) => t.card);

  const wantsRecommendations =
    !filters.short && !filters.listId && seeds.length >= MIN_SEEDS;

  let recommended: DeckCard[] = [];
  let recommendationsUnavailable = false;

  if (wantsRecommendations) {
    if (!takeDeckLoad(userId, Date.now())) {
      recommendationsUnavailable = true;
    } else {
      const [lists, excluded] = await Promise.all([
        fetchRecommendations(seeds),
        loadExclusions(userId),
      ]);
      if (lists === null) {
        recommendationsUnavailable = true;
      } else {
        recommended = rankCandidates(
          lists,
          (c) =>
            !c.name.trim() ||
            !matchesKind(c.kind) ||
            excluded.has(`${c.kind}:${c.id}`),
        )
          .slice(0, MAX_RECOMMENDED_CARDS)
          .map(({ candidate, becauseTitle, becauseRating }) => ({
            source: "recommended",
            kind: candidate.kind,
            id: candidate.id,
            title: candidate.name,
            posterPath: candidate.posterPath,
            year: candidate.year,
            becauseTitle,
            becauseRating,
          }));
      }
    }
  }

  return {
    cards: interleave(recommended, own),
    seedCount: seeds.length,
    recommendationsUnavailable,
  };
}
