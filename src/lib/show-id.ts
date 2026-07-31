/**
 * TMDB show ids are decimal integers, and everything downstream treats them as
 * opaque strings: they are interpolated into TMDB request paths, used as the
 * primary key of the `Show` cache, and passed to `revalidatePath`.
 *
 * Without a check at the edges, a value like `1399/season/1` or `1399?x=y`
 * points the server's TMDB request at a different endpoint than the caller
 * asked for, and the same string then keys a cache row and a revalidation path.
 * The origin can't be changed, so this isn't SSRF — but the id has to be an id.
 *
 * Deliberately kept free of `server-only` so both server actions and route
 * components can share it.
 */
export function isTmdbShowId(value: string): boolean {
  return /^\d+$/.test(value);
}
