/**
 * Where a show is available elsewhere on a service you already pay for.
 *
 * Generic over anything shaped like `CountryAvailability`, same reasoning as
 * `pick-country.ts`: it needs no import from the server-only TMDB module, so
 * nothing here risks crossing into a client component.
 */

interface CountryLike {
  code: string;
  flatrate: { id: number }[];
  free: { id: number }[];
}

/** Parses the comma-separated `Settings.providerIds` column. */
export function parseProviderIds(raw: string | null): number[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((value) => Number(value))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * True when the home country already has one of the owned providers, either
 * on its subscription tier or for free — meaning there's nothing to gain from
 * pointing at another country.
 */
export function coveredAtHome<C extends CountryLike>(
  countries: C[],
  providerIds: number[],
  homeCode: string | undefined,
): boolean {
  if (!homeCode || providerIds.length === 0) return false;

  const owned = new Set(providerIds);
  const home = countries.find((country) => country.code === homeCode);
  if (!home) return false;

  return [...home.flatrate, ...home.free].some((provider) =>
    owned.has(provider.id),
  );
}

/**
 * Countries other than `homeCode` where a show is on one of the owned
 * provider ids — subscription or free tiers only. Rent/buy is deliberately
 * excluded: that costs money in any country, so having the "service" doesn't
 * get it there for free the way a subscription or a free tier does.
 */
export function findAlternateCountries<C extends CountryLike>(
  countries: C[],
  providerIds: number[],
  homeCode: string | undefined,
): Array<{ code: string; providers: C["flatrate"][number][] }> {
  if (providerIds.length === 0) return [];

  const owned = new Set(providerIds);

  return countries
    .filter((country) => country.code !== homeCode)
    .map((country) => ({
      code: country.code,
      providers: [...country.flatrate, ...country.free].filter((provider) =>
        owned.has(provider.id),
      ),
    }))
    .filter((country) => country.providers.length > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}
