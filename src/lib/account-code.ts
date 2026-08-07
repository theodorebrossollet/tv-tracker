// The shape of an account code, in one place.
//
// Nothing here is server-only: the login form uses it to stop a typo before it
// costs a round trip, and the actions use it as the real check.
//
// Why a format check is worth having at all, given the code is unguessable
// anyway: `loginWithCode` is the one action reachable without a session, and it
// is bounded by nothing. Every attempt that gets past this costs a Vercel
// invocation and an indexed Turso read. Guessing a code is infeasible — 128
// bits — so the risk was never a break-in; it is that a script can run up the
// bill on a repo whose endpoints are about to be public.
//
// Rejecting here spends no database at all, and it removes the entire class of
// "send junk in a loop". What it cannot do is bound *well-formed* attempts —
// that needs shared state, and shared state means a round trip, which is the
// thing being conserved. Volume belongs to the platform's rate limiting, not to
// this function; see docs/technical-design-v2.md.

/**
 * Bytes of randomness behind a code, matching `scripts/create-user.mjs`,
 * `create-admin-user.mjs` and `reset-user-code.mjs`. Hex-encoded, so the string
 * is twice this long.
 *
 * Derived rather than written twice: raising the entropy in the scripts without
 * widening the check here would reject every new code, and the failure would
 * look like "the code I was just given doesn't work".
 */
export const CODE_BYTES = 16;
export const CODE_LENGTH = CODE_BYTES * 2;

const CODE_PATTERN = new RegExp(`^[0-9a-f]{${CODE_LENGTH}}$`);

/**
 * Cleans up a pasted code.
 *
 * Lowercased as well as trimmed, which is a real fix rather than tidiness:
 * `hashCode` is a plain SHA-256, so an autocapitalised first character used to
 * fail with "That code isn't recognised" on a code that was perfectly correct.
 * Every generated code is lowercase hex, so folding case can only turn a
 * previously-failing input into a working one.
 */
export function normalizeCode(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Whether a normalized string could be a code this app generated. */
export function isAccountCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}
