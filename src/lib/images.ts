// Poster URL building. Kept separate from lib/tmdb.ts because that module is
// server-only (it holds the API key) while poster URLs are just public CDN
// paths that client components need too.

const IMAGE_BASE = "https://image.tmdb.org/t/p";

export type PosterSize = "w185" | "w342" | "w500";

/** Builds a full poster URL, or null when TMDB has no image for the title. */
export function posterUrl(
  path: string | null | undefined,
  size: PosterSize = "w342",
): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export type BackdropSize = "w300" | "w780" | "w1280";

/**
 * A 16:9 image URL — a show's backdrop or an episode's still — or null when
 * TMDB has none. Same host and path shape as posters, so `next.config.ts`'s
 * `remotePatterns` already admits it.
 */
export function backdropUrl(
  path: string | null | undefined,
  size: BackdropSize = "w780",
): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

/** A cast member's photo, or null when TMDB has none. */
export function profileUrl(path: string | null | undefined): string | null {
  return path ? `${IMAGE_BASE}/w185${path}` : null;
}
