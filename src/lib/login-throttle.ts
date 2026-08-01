// Backoff policy for repeated failed password sign-ins.
//
// Only relevant once `APP_PASSWORD` is gone: until then the shared gate stands
// in front of the login form. After that, `/login/password` is reachable by
// anyone who finds the URL, and scrypt alone caps guessing at roughly ten a
// second — around 860k attempts a day, which is thin against an 8-character
// minimum.
//
// Counted per account, not per IP. An in-process counter is worthless here for
// the reason proxy.ts already documents: the app runs across many short-lived
// serverless instances, so the count resets constantly and would read as
// protection while providing none. The database is the only shared state, and
// the account is the thing actually under attack.
//
// Pure functions, no database access — the policy is worth testing on its own,
// separately from the action that applies it.

/** Failures tolerated before any lockout begins. */
export const FAILURE_THRESHOLD = 5;

const BASE_LOCKOUT_MS = 30_000;

/**
 * Capped deliberately. An uncapped doubling would eventually lock an account
 * out for weeks, turning a nuisance into real damage — and it buys nothing: at
 * five minutes a guesser is down to roughly 300 attempts a day, which is
 * already hopeless against any password worth the name.
 */
const MAX_LOCKOUT_MS = 300_000;

/**
 * How long to refuse sign-in after `failedLogins` consecutive failures.
 *
 * Zero below the threshold, so ordinary typos cost nothing.
 */
export function lockoutMs(failedLogins: number): number {
  if (failedLogins < FAILURE_THRESHOLD) return 0;

  const doublings = failedLogins - FAILURE_THRESHOLD;

  // Guard the shift itself: 2 ** 1024 is Infinity, and Infinity * anything
  // stays Infinity rather than clamping, which would produce an Invalid Date.
  if (doublings > 20) return MAX_LOCKOUT_MS;

  return Math.min(BASE_LOCKOUT_MS * 2 ** doublings, MAX_LOCKOUT_MS);
}

/** Whether a lockout is still in force. Null means never locked. */
export function isLockedOut(lockedUntil: Date | null, now = new Date()): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

/**
 * A wait time a person can act on.
 *
 * Deliberately vague — "about a minute" rather than "57 seconds" — because the
 * exact remaining time is not useful to the owner and is a free clock for
 * anyone probing the endpoint.
 */
export function describeWait(lockedUntil: Date, now = new Date()): string {
  const seconds = Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000);

  if (seconds <= 60) return "in about a minute";

  return `in about ${Math.ceil(seconds / 60)} minutes`;
}
