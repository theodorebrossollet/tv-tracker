import "server-only";

import { createHash } from "node:crypto";

import { MIN_SEEDS, type SuggestionKind } from "@/lib/discover-limits";
import type { Deck, DeckCard, DeckFilters } from "@/lib/discover-types";
import { easternDateKey } from "@/lib/format";
import { describeError, logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { loadShowRatings } from "@/lib/queries";
import { oneParam, type SearchParams } from "@/lib/search-params";
import {
  getMovieReleaseDates,
  getRecommendations,
  type CountryReleases,
  type TmdbRecommendation,
} from "@/lib/tmdb";
import { RECENT_RELEASE_DAYS } from "@/lib/upcoming-movies";

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
 * `?shuffle=<n>`. Anything else, including a mangled value, is the default, so
 * a bad link lands on the full deck rather than an error.
 */
export function parseDeckFilters(params: SearchParams): DeckFilters {
  const kind = oneParam(params, "kind");
  return {
    kind: kind === "movie" || kind === "show" ? kind : "any",
    short: oneParam(params, "short") === "1",
    shuffle: parseShuffle(oneParam(params, "shuffle")),
  };
}

/** A small non-negative whole number; anything else (junk, huge, negative) is 0. */
function parseShuffle(value: string | undefined): number {
  return value && /^\d{1,4}$/.test(value) ? Number(value) : 0;
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
  /** A movie's release date or a show's first air date, when known. */
  releaseDate: Date | null;
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
      releaseDate: movie.releaseDate,
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
      releaseDate: show.firstAirDate,
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

// ---- Availability -------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
/** Titles looked up per round; a deck stops after this many rounds. */
const MAX_AVAILABILITY_ROUNDS = 3;

/**
 * Whether a movie can be watched at home yet. The viewer's country decides:
 * its digital release date has to have passed. A movie with no digital date
 * there (older films mostly) counts once its release is more than
 * `RECENT_RELEASE_DAYS` back, the same window the dashboard uses for a movie
 * that may still be heading to streaming. An unknown release date never counts.
 */
export function movieIsOut(
  countries: CountryReleases[] | null,
  home: string | null,
  released: Date | null,
  now: Date,
): boolean {
  const digital =
    (home && countries?.find((entry) => entry.code === home)?.releases) || [];
  const dates = digital
    .filter((release) => release.kind === "digital")
    .map((release) => release.date.getTime());

  if (dates.length > 0) return Math.min(...dates) <= now.getTime();

  return (
    released !== null &&
    released.getTime() <= now.getTime() - RECENT_RELEASE_DAYS * DAY_MS
  );
}

/** Whether a show has started airing. An unknown first air date never counts. */
export function showHasAired(firstAired: Date | null, now: Date): boolean {
  return firstAired !== null && firstAired.getTime() <= now.getTime();
}

/**
 * The first `limit` items, in order, that can be watched now. Movies cost a
 * (cached) TMDB lookup each, so items are checked a round of `limit` at a time
 * and only a few rounds are tried; a failed lookup falls back to the release
 * date alone rather than hiding the item.
 */
async function keepAvailable<T>(
  items: T[],
  describe: (item: T) => { kind: SuggestionKind; id: string; released: Date | null },
  home: string | null,
  now: Date,
  limit: number,
): Promise<T[]> {
  const kept: T[] = [];
  const end = Math.min(items.length, limit * MAX_AVAILABILITY_ROUNDS);

  for (let start = 0; start < end && kept.length < limit; start += limit) {
    const round = items.slice(start, Math.min(start + limit, end));
    const out = await Promise.all(
      round.map(async (item) => {
        const { kind, id, released } = describe(item);
        if (kind === "show") return showHasAired(released, now);

        let countries: CountryReleases[] | null = null;
        if (home) {
          try {
            countries = await getMovieReleaseDates(id);
          } catch (error) {
            logger.warn("discover.release_dates_failed", describeError(error));
          }
        }
        return movieIsOut(countries, home, released, now);
      }),
    );
    round.forEach((item, i) => {
      if (out[i] && kept.length < limit) kept.push(item);
    });
  }

  return kept;
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
 * fewer than `MIN_SEEDS` seeds, or with "Under 2h" on (a candidate carries no
 * runtime to check). Only titles that can be watched now are dealt: shows that
 * have aired, movies whose digital release has passed in `options.country`.
 */
export async function getDeck(
  userId: string,
  filters: DeckFilters,
  options: { now?: Date; country?: string | null } = {},
): Promise<Deck> {
  const now = options.now ?? new Date();
  const home = options.country ?? null;
  const [seeds, ownPool] = await Promise.all([
    getSeeds(userId),
    loadWatchlist(userId),
  ]);

  const matchesKind = (kind: SuggestionKind) =>
    filters.kind === "any" || filters.kind === kind;

  const picked = pickOwnTitles(
    ownPool.filter(
      (t) =>
        matchesKind(t.card.kind) &&
        (!filters.short ||
          (t.card.kind === "movie" &&
            t.runtime !== null &&
            t.runtime < SHORT_RUNTIME_MINUTES)),
    ),
    // Day and shuffle count: the same cards all day, until the visitor asks.
    `${userId}:${easternDateKey(now)}${
      filters.shuffle > 0 ? `:${filters.shuffle}` : ""
    }`,
    now,
    // The whole pool in pick order: titles not out yet are skipped below.
    Infinity,
  );
  const own = (
    await keepAvailable(
      picked,
      (t) => ({ kind: t.card.kind, id: t.card.id, released: t.releaseDate }),
      home,
      now,
      MAX_OWN_CARDS,
    )
  ).map((t) => t.card);

  const wantsRecommendations = !filters.short && seeds.length >= MIN_SEEDS;

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
        const ranked = rankCandidates(
          lists,
          (c) =>
            !c.name.trim() ||
            !matchesKind(c.kind) ||
            excluded.has(`${c.kind}:${c.id}`),
        );
        recommended = (
          await keepAvailable(
            ranked,
            ({ candidate }) => ({
              kind: candidate.kind,
              id: candidate.id,
              released: candidate.releaseDate,
            }),
            home,
            now,
            MAX_RECOMMENDED_CARDS,
          )
        ).map(({ candidate, becauseTitle, becauseRating }) => ({
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
