// Password rules, shared by the action that enforces them and the form that
// previews them. Nothing here may import a server-only module — the hashing
// lives in lib/password.ts, which does.
//
// Deliberately no composition rules (no "must contain a symbol"). They push
// people towards predictable substitutions and shorter passwords, and NIST has
// recommended against them for years. Length is the control that matters.

export const PASSWORD_MIN = 8;

/**
 * An upper bound exists only to cap the cost of hashing. scrypt's work is
 * bounded by its parameters rather than input length, but accepting megabytes
 * of input is free work an unauthenticated caller can ask for.
 */
export const PASSWORD_MAX = 128;

export const PASSWORD_RULES = `At least ${PASSWORD_MIN} characters.`;

export type PasswordCheck = { ok: true } | { ok: false; error: string };

export function validatePassword(
  password: string,
  { nickname }: { nickname?: string } = {},
): PasswordCheck {
  // Not trimmed, unlike the nickname: leading and trailing spaces are legal
  // characters in a password, and silently removing them would lock someone
  // out of an account whose password a manager generated with one.
  if (password.length < PASSWORD_MIN) {
    return {
      ok: false,
      error: `Use at least ${PASSWORD_MIN} characters.`,
    };
  }

  if (password.length > PASSWORD_MAX) {
    return { ok: false, error: `Keep it under ${PASSWORD_MAX} characters.` };
  }

  if (nickname && password.toLowerCase() === nickname.toLowerCase()) {
    return { ok: false, error: "Don't use your nickname as your password." };
  }

  return { ok: true };
}
