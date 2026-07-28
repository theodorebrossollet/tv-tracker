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
