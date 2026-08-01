import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { prisma } from "@/lib/prisma";

// Session handling for v2 accounts. See docs/technical-design-v2.md sections 2
// and 4 for the reasoning behind the shapes here.
//
// The database is the authority on whether a session is valid, not the cookie.
// That is what makes a single session revocable without rotating a secret and
// logging everyone out — which matters more here than in a system with account
// recovery, because a lost code cannot be recovered at all.

export const SESSION_COOKIE = "tvt_session";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Idle lifetime. Extends on use; expires 90 days after the last visit. */
const SESSION_TTL_MS = 90 * DAY_MS;

/**
 * How stale a session must get before a visit writes a new expiry.
 *
 * Without this, sliding expiration means a database *write* on every request,
 * on every `force-dynamic` page — which would quietly undo the "one indexed
 * read per request" argument for having a session table at all. Extending at
 * most daily makes no practical difference to a 90-day window.
 */
const EXTEND_AFTER_MS = DAY_MS;

/**
 * Browsers cap cookie lifetime at ~400 days, and the row is what actually
 * decides validity, so the cookie only has to outlive the session it points
 * at. Matching it to the 90-day TTL instead would log out an *active* user 90
 * days after login: the cookie cannot be re-issued during a page render (Next
 * only allows writes from actions and route handlers), so the slide would
 * apply to the row and not to the cookie carrying it.
 */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Hashes an account code for lookup.
 *
 * Deterministic and unsalted on purpose: it makes login one indexed read
 * rather than a scan comparing every row, and there is no dictionary to
 * precompute against 128 bits of server-generated randomness. The slow-hash
 * reasoning that applies to user-chosen passwords does not apply here.
 */
export function hashCode(code: string): string {
  return sha256(code);
}

export interface SessionContext {
  sessionId: string;
  user: { id: string; nickname: string | null };
}

/**
 * Issues a session and sets its cookie. Only callable from a server action or
 * route handler, because it writes a cookie.
 */
export async function createSession(userId: string): Promise<void> {
  // The cookie carries the token; the database stores only its hash. A dump of
  // the database therefore yields no usable session, mirroring `codeHash`.
  const token = randomBytes(32).toString("hex");

  await prisma.session.create({
    data: {
      id: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  const store = await cookies();

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Off outside production so the cookie works over http://localhost. Safari
    // has historically refused Secure cookies there even though the spec
    // treats localhost as a trustworthy origin.
    secure: process.env.NODE_ENV === "production",
    // Lax, not Strict: Strict drops the cookie on any inbound link from
    // another app, which for something launched from a phone home screen reads
    // as a random logout rather than a security feature.
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * Reads the current session, or null.
 *
 * Memoized per request with React's `cache` because a page and the action it
 * posts to both want it, and every call would otherwise be another round trip.
 * Safe to call while rendering: it reads the cookie and may write the *row*,
 * but never touches the cookie.
 */
export const getSession = cache(async function getSession(): Promise<SessionContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { id: sha256(token) },
    select: {
      id: true,
      expiresAt: true,
      user: { select: { id: true, nickname: true } },
    },
  });

  if (!session) return null;

  const now = Date.now();

  // Expired rows are left for the daily sweep rather than deleted here: this
  // runs during rendering, and a read path that deletes on every stale visit
  // turns a cheap lookup into a write for no benefit.
  if (session.expiresAt.getTime() <= now) return null;

  if (session.expiresAt.getTime() - now < SESSION_TTL_MS - EXTEND_AFTER_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(now + SESSION_TTL_MS) },
    });
  }

  return { sessionId: session.id, user: session.user };
});

/**
 * Requires a valid session, redirecting to /login otherwise.
 *
 * **Call this above an action's `try` block, never inside one.** `redirect`
 * works by throwing, and every action in `app/actions.ts` funnels unknown
 * errors through `toResult` — which would turn an expired session into
 * "Something went wrong. Please try again." and log it as `action.failed`.
 * Next's own documentation says the same thing about `redirect` and
 * `try/catch`.
 */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect("/login");

  return session;
}

/**
 * Requires a session that has finished onboarding.
 *
 * Session validity and "has a nickname" are separate checks and both have to
 * pass, so this wraps `requireSession` rather than replacing it. Every action
 * uses this one except `setNickname` and `logout`, which are the two that must
 * remain reachable while `nickname` is still null.
 */
export async function requireOnboardedSession(): Promise<SessionContext> {
  const session = await requireSession();
  if (session.user.nickname === null) redirect("/welcome");

  return session;
}

/** Revokes the current session. Clears the cookie, so actions only. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    // deleteMany rather than delete: logging out twice, or with a cookie whose
    // row is already gone, is a success rather than something to report.
    await prisma.session.deleteMany({ where: { id: sha256(token) } });
  }

  store.delete(SESSION_COOKIE);
}

/**
 * Removes sessions that have already expired. Nothing else deletes them, so
 * without this they accumulate for the lifetime of the database.
 */
export async function deleteExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });

  return count;
}
