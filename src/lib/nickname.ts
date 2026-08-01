// Nickname rules, shared by the server action that enforces them and the form
// that previews them. Nothing here may import a server-only module — same
// constraint as lib/types.ts and for the same reason.
//
// See docs/technical-design-v2.md, "Nickname format", for how this set was
// chosen. Two constraints shaped it: a future profile page will very likely be
// addressed as /u/<nickname>, so anything with meaning in a URL path is out;
// and length plus character set alone would admit "...", "---" and "!!!".

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 12;

/**
 * `%` is deliberately absent. It would be legal as *content*, but a character
 * that must be percent-encoded at every interpolation site is a double-decode
 * bug waiting for the first URL a nickname appears in, and it buys nothing.
 */
const ALLOWED = /^[A-Za-z0-9@#$&*!_.-]+$/;

const HAS_ALPHANUMERIC = /[A-Za-z0-9]/;

export const NICKNAME_RULES =
  `${NICKNAME_MIN}–${NICKNAME_MAX} characters: letters, numbers, and ` +
  `@ # $ & * ! _ . -`;

/**
 * The form the uniqueness constraint is applied to.
 *
 * Uniqueness is case-insensitive by decision — "Theo" and "theo" are the same
 * nickname — and this column is how that is enforced, because Prisma's DSL
 * cannot declare SQLite's COLLATE NOCASE. The stored `nickname` keeps the
 * casing the user chose; only the comparison is folded.
 */
export function nicknameKey(nickname: string): string {
  return nickname.toLowerCase();
}

export type NicknameCheck =
  | { ok: true; nickname: string; key: string }
  | { ok: false; error: string };

/**
 * Validates a proposed nickname, returning the value to store or a message to
 * show the user.
 *
 * Surrounding whitespace is trimmed rather than rejected: it is almost always
 * an artefact of copy-paste, and failing someone's first login over an
 * invisible character is a poor introduction to an app they cannot recover an
 * account for.
 */
export function validateNickname(raw: string): NicknameCheck {
  const nickname = raw.trim();

  if (!nickname) {
    return { ok: false, error: "Choose a nickname." };
  }

  // Counted in code points, not UTF-16 units, so an astral character costs one
  // rather than two. The character set below rejects it either way — this just
  // means the length message is the one shown, which is the more useful of the
  // two.
  const length = [...nickname].length;

  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    return {
      ok: false,
      error: `Nicknames are ${NICKNAME_MIN}–${NICKNAME_MAX} characters.`,
    };
  }

  if (!ALLOWED.test(nickname)) {
    return {
      ok: false,
      error: "Use letters, numbers, or @ # $ & * ! _ . - only.",
    };
  }

  if (!HAS_ALPHANUMERIC.test(nickname)) {
    return {
      ok: false,
      error: "Include at least one letter or number.",
    };
  }

  return { ok: true, nickname, key: nicknameKey(nickname) };
}
