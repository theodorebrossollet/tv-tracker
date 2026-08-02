/**
 * Chooses which country's streaming availability to show.
 *
 * Order of preference: the one asked for in the URL, then the one from
 * settings, then whatever TMDB listed first. Both of the first two are
 * *matched against the available list* rather than trusted — a hand-edited or
 * simply stale code falls through to the same default as no code at all,
 * instead of rendering an empty panel for a country this show isn't in.
 *
 * Generic over anything with a `code` so it needs no import from the
 * server-only TMDB module.
 */
export function pickCountry<T extends { code: string }>(
  available: T[],
  requested: string | string[] | undefined,
  settingsCountry: string | null,
): T | undefined {
  const wanted = Array.isArray(requested) ? requested.at(-1) : requested;

  return (
    available.find((country) => country.code === wanted) ??
    available.find((country) => country.code === settingsCountry) ??
    available[0]
  );
}
