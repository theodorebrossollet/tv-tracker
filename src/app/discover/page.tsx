import { DiscoverDeck } from "@/components/discover-deck";
import { ProfileButton } from "@/components/profile-button";
import { requireOnboardedSession } from "@/lib/auth";
import { getDeck, parseDeckFilters } from "@/lib/discover";
import type { SearchParams } from "@/lib/search-params";
import { getSettings } from "@/lib/shows";

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

  const { country } = await getSettings(user.id);
  const deck = await getDeck(user.id, filters, { country });

  return (
    <DiscoverDeck
      cards={deck.cards}
      seedCount={deck.seedCount}
      recommendationsUnavailable={deck.recommendationsUnavailable}
      filters={filters}
      profile={<ProfileButton nickname={user.nickname} />}
    />
  );
}
