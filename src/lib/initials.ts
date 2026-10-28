/**
 * The letters on the profile avatar: the first letter of the first and last
 * words of a nickname, or just the first letter of a one-word one ("Theo" is
 * "T", not "TH" — two letters of one name read as an abbreviation, not
 * initials). Nicknames are free text, so anything that isn't a letter or digit
 * is skipped rather than drawn, and an empty result falls back to "?".
 *
 * Pure and client-safe: the avatar renders on every top-level screen.
 */
export function initials(nickname: string | null | undefined): string {
  const words = (nickname ?? "")
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0])
    .filter((letter): letter is string => letter !== undefined);

  if (words.length === 0) return "?";

  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : "";

  return (first + last).toLocaleUpperCase();
}
