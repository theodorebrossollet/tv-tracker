import { DiscoverDeck } from "@/components/discover-deck";
import { requireOnboardedSession } from "@/lib/auth";
import { getDeck, parseDeckFilters } from "@/lib/discover";
import { getLists } from "@/lib/queries";
import type { SearchParams } from "@/lib/search-params";

export const dynamic = "force-dynamic";

export const metadata = { title: "Discover · TV Tracker" };

/**
 * What to watch next. The gate lives here rather than in a component below,
 * because `tests/route-gates.test.ts` reads this file.
 */
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requireOnboardedSession();
  const filters = parseDeckFilters(await searchParams);

  const [deck, lists] = await Promise.all([
    getDeck(user.id, filters),
    getLists(user.id),
  ]);

  return (
    <DiscoverDeck
      cards={deck.cards}
      seedCount={deck.seedCount}
      recommendationsUnavailable={deck.recommendationsUnavailable}
      filters={filters}
      lists={lists.map(({ id, name }) => ({ id, name }))}
    />
  );
}
