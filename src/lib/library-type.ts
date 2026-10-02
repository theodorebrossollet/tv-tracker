import { oneParam, type SearchParams } from "@/lib/search-params";

// Client-safe: the Library switch and the pages both read it.

export type LibraryType = "shows" | "movies";

/**
 * Which half of the Library the URL asks for.
 *
 * `movies` only when the last `type` value is exactly that; anything else —
 * missing, `shows`, a different case, junk, a repeated param ending in junk —
 * is shows, so a mangled link lands on the default rather than an empty page.
 */
export function typeFrom(params: SearchParams): LibraryType {
  return oneParam(params, "type") === "movies" ? "movies" : "shows";
}
