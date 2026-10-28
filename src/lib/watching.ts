import type { TrackedShowSummary } from "@/lib/queries";

export type HeroShow = TrackedShowSummary & {
  nextUnwatched: NonNullable<TrackedShowSummary["nextUnwatched"]>;
};

/**
 * Splits the Watching list into the one show the hero features and the rest.
 *
 * The hero is the first show with an episode ready to watch. The list arrives
 * in `sortByActionability` order, so that is the most recently watched show
 * with something aired and unwatched — what "up next" means. A list where
 * nothing is ready (every show caught up, or none aired yet) has no hero, and
 * every show stays in the list.
 *
 * Pure and client-safe: the page decides the layout from it.
 */
export function splitHero(shows: TrackedShowSummary[]): {
  hero: HeroShow | null;
  rest: TrackedShowSummary[];
} {
  const index = shows.findIndex((show) => show.nextUnwatched !== null);
  if (index === -1) return { hero: null, rest: shows };

  return {
    hero: shows[index] as HeroShow,
    rest: [...shows.slice(0, index), ...shows.slice(index + 1)],
  };
}
