"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createSession,
  destroySession,
  hashCode,
  requireOnboardedSession,
  requireSession,
} from "@/lib/auth";
import {
  describeWait,
  isLockedOut,
  lockoutMs,
} from "@/lib/login-throttle";
import { fakeVerify, hashPassword, verifyPassword } from "@/lib/password";
import { PASSWORD_MAX, validatePassword } from "@/lib/password-rules";
import { describeError, logger } from "@/lib/logger";
import { NICKNAME_MAX, validateNickname } from "@/lib/nickname";
import { prisma } from "@/lib/prisma";
import { isSchemaMismatch, missingSchemaObject } from "@/lib/schema-error";
import { isTmdbShowId } from "@/lib/show-id";
import { syncShowFromTmdb } from "@/lib/shows";
import { searchTvShows, TmdbError, type TmdbSearchResult } from "@/lib/tmdb";
import type { TrackStatus } from "@/lib/types";

// Every action below the account section starts with `requireOnboardedSession`,
// and scopes its Prisma calls by the userId it returns. Both halves matter and
// neither is optional: server actions are reachable by direct POST, so the gate
// is the only thing standing in front of them — and a forgotten `userId` filter
// leaks another account's data on a read, or corrupts it on a write.
//
// The gate goes ABOVE each `try`, never inside. `redirect` works by throwing,
// and `toResult` would swallow it into a generic error toast.
//
// What stops a malicious page from POSTing clearAllData on your behalf is not
// the session cookie — it is SameSite=Lax plus Next's own CSRF check on server
// actions, which compares the request's `Origin` to the `Host` (or
// `X-Forwarded-Host`) and rejects mismatches. That control is load-bearing and
// invisible, so two things follow:
//
//   - `experimental.serverActions.allowedOrigins` is the knob that widens it.
//     It is absent from next.config.ts today, which is the safe default —
//     same-origin only. Adding a domain there weakens exactly this protection.
//   - Route handlers get none of it, and none of the session gate either. The
//     cron route is safe because it checks its own bearer token; any future
//     route handler must bring its own auth. There is no longer a shared
//     password sitting in front of everything to catch what a route forgets.

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Prisma's "unique constraint failed". Two writers raced and the second one
 * lost — which, for a write whose whole point is "make this row exist", means
 * the work is done rather than failed.
 */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Turns an unexpected failure into a message safe to show the user. */
function toResult(error: unknown): ActionResult {
  if (error instanceof TmdbError) {
    return { ok: false, error: error.message };
  }

  // A deploy that landed before its migration. Split out from the generic
  // failure because the two need different things: the visitor needs to know
  // it is temporary and not their fault, and the operator needs to know which
  // migration is missing without reading a stack trace.
  if (isSchemaMismatch(error)) {
    logger.error("action.schema_mismatch", { missing: missingSchemaObject(error) });

    return {
      ok: false,
      error: "The app is being updated. Please try again in a minute.",
    };
  }

  logger.error("action.failed", describeError(error));
  return { ok: false, error: "Something went wrong. Please try again." };
}

/**
 * Refreshes every route that can show a show's tracked state or progress.
 *
 * One layout-level call rather than four path-level ones. Note this is wider
 * than what it replaced — it invalidates everything under the root layout, not
 * three fixed paths plus one show — which is fine here only because every route
 * in the app is `force-dynamic` and re-renders on request anyway. What these
 * calls actually buy is purging the *client* router cache, which is what would
 * otherwise show a stale count after navigating back.
 *
 * The narrow version was also easy to get wrong: each new route that displays
 * progress had to remember to add itself here, and a missing line looks like
 * nothing at all.
 */
function revalidateShowViews() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Accounts
//
// These four are the only actions that may run without a completed account.
// Everything below them gets `requireOnboardedSession()` in the next stage,
// once queries are scoped by user — adding the gate before the data is
// partitioned would lock the app without making anything private.
//
// Two credentials, hashed two different ways on purpose: the account code is a
// 128-bit invite (SHA-256, indexed lookup) and the password is user-chosen
// (scrypt, salted, slow). lib/password.ts explains why one treatment would be
// wrong for both.
//
// Note where the session check sits in `completeOnboarding`: above the `try`,
// not inside it. `requireSession` redirects by throwing, and `toResult` would
// swallow that into a generic error toast.
// ---------------------------------------------------------------------------

/**
 * First login, and the only way back in after a forgotten password.
 *
 * The code is an invite rather than the day-to-day credential: it survives
 * onboarding precisely so that losing a password isn't losing the account.
 * There is no other recovery route, and no email to send one to.
 *
 * Note the redirect sits after the try block, never inside it. `redirect`
 * works by throwing, so `toResult` would swallow it into a generic error.
 */
export async function loginWithCode(code: string): Promise<ActionResult> {
  const trimmed = code.trim();

  if (!trimmed) return { ok: false, error: "Enter your account code." };

  let destination: string;

  try {
    const user = await prisma.user.findUnique({
      where: { codeHash: hashCode(trimmed) },
      select: { id: true, nickname: true, passwordHash: true },
    });

    // Deliberately the same message whether the code is malformed or simply
    // wrong. There is nothing useful to distinguish, and no account
    // enumeration to enable.
    if (!user) return { ok: false, error: "That code isn't recognised." };

    // An account with a password already set that still reaches this action
    // is here to *recover*, not just sign in — the whole reason "forgot your
    // password? use your code" exists is to get back in when the current
    // password is the thing they lost. Leaving the old hash in place would
    // sign them in with a password they still don't know, and next time
    // they'd be right back here. Clearing it forces the same "choose a
    // password" step first-login already goes through.
    const needsNewPassword = user.passwordHash !== null;

    // The code proves ownership, so it clears any password lockout. That is
    // what keeps a stranger from locking someone out of their own account by
    // guessing at their nickname: the way back in never depended on the
    // password.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
        ...(needsNewPassword ? { passwordHash: null } : {}),
      },
    });

    // Recovering means the existing credentials can't be trusted — the whole
    // reason to be here is that something went wrong with them. Every existing
    // session goes before the new one is minted, so "sign in with your code"
    // actually evicts whoever prompted it rather than joining them.
    //
    // Not done for a plain code sign-in: an account with no password set yet
    // is mid-onboarding, not recovering, and has nothing worth evicting.
    let revoked = 0;
    if (needsNewPassword) {
      ({ count: revoked } = await prisma.session.deleteMany({
        where: { userId: user.id },
      }));
    }

    await createSession(user.id);

    // The code itself is never logged — see the note in lib/logger.ts about
    // TMDB URLs, which applies with more force to a credential its owner
    // cannot rotate.
    logger.info("auth.login", { userId: user.id, via: "code" });
    if (needsNewPassword) {
      logger.info("auth.password_reset_via_code", {
        userId: user.id,
        sessionsRevoked: revoked,
      });
    }

    destination = user.nickname === null || needsNewPassword ? "/welcome" : "/";
  } catch (error) {
    return toResult(error);
  }

  // Signing in changes what the layout should show, and the layout is cached
  // per path — so it has to be invalidated explicitly, not just navigated past.
  revalidatePath("/", "layout");
  redirect(destination);
}

/** Everyday sign-in, once an account has finished onboarding. */
export async function loginWithPassword(
  nickname: string,
  password: string,
): Promise<ActionResult> {
  const key = nickname.trim().toLowerCase();

  if (!key || !password) {
    return { ok: false, error: "Enter your nickname and password." };
  }

  // `PASSWORD_MAX` exists to bound scrypt's input (see password-rules.ts), but
  // it was only ever applied when *setting* a password — not here, which is the
  // one path an unauthenticated caller can drive. Every attempt costs ~100ms of
  // CPU and 32MB, an unknown nickname included, since `fakeVerify` runs to keep
  // the timing flat. Without a cap the caller chooses how much work to ask for.
  //
  // Checked before the lookup, so it costs a round trip as well as the hash.
  // Same message as a wrong password: an over-length value was never a
  // credential, and saying which half was wrong would tell an attacker whether
  // the nickname exists.
  if (password.length > PASSWORD_MAX || key.length > NICKNAME_MAX) {
    return { ok: false, error: "Wrong nickname or password." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { nicknameKey: key },
      select: {
        id: true,
        passwordHash: true,
        failedLogins: true,
        lockedUntil: true,
      },
    });

    // One message for every failure, and a matching amount of work for each.
    // Skipping the hash when the nickname is unknown would make the response
    // time say which half was wrong — and nicknames are meant to be publicly
    // visible eventually, so they're the half an attacker already has.
    if (!user?.passwordHash) {
      await fakeVerify();
      return { ok: false, error: "Wrong nickname or password." };
    }

    // Checked before the hash, so a locked account costs an attacker nothing
    // to discover but also gains them nothing: the wait is what stops them.
    // Saying so plainly is the right trade — the alternative is a legitimate
    // owner staring at "wrong password" for a password they know is right.
    if (isLockedOut(user.lockedUntil)) {
      logger.warn("auth.login_locked_out", { userId: user.id });
      return {
        ok: false,
        error: `Too many attempts. Try again ${describeWait(user.lockedUntil!)}, or sign in with your code.`,
      };
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      const failedLogins = user.failedLogins + 1;
      const lockFor = lockoutMs(failedLogins);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins,
          lockedUntil: lockFor > 0 ? new Date(Date.now() + lockFor) : null,
        },
      });

      logger.warn("auth.login_failed", { userId: user.id, failedLogins });
      return { ok: false, error: "Wrong nickname or password." };
    }

    // Cleared on success, so the counter measures a *run* of failures rather
    // than accumulating over months of ordinary typos.
    if (user.failedLogins > 0 || user.lockedUntil !== null) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
    }

    await createSession(user.id);
    logger.info("auth.login", { userId: user.id, via: "password" });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/", "layout");
  redirect("/");
}

/** Revokes the current session. Succeeds even when there isn't one. */
export async function logout(): Promise<ActionResult> {
  try {
    await destroySession();
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Finishes an account: nickname and password, chosen together at first login.
 *
 * Both are written in one update. Setting them separately would leave an
 * account that is half-configured if the second step is abandoned, and
 * `requireOnboardedSession` would have to describe which half.
 *
 * The nickname is permanent, and enforced here rather than by hiding the UI:
 * server actions are POST-able directly, so a missing check would let a direct
 * POST rename an account that is supposed to be locked.
 */
export async function completeOnboarding(
  rawNickname: string,
  password: string,
): Promise<ActionResult> {
  // Above the try. `requireSession` redirects by throwing, and `toResult`
  // would turn an expired session into "Something went wrong".
  const session = await requireSession();

  // An account that already has a nickname is only here for the password —
  // it keeps the name it chose, and the submitted one is ignored rather than
  // silently applied.
  const existing = session.user.nickname;

  const checkedNickname = existing
    ? ({ ok: true, nickname: existing, key: existing.toLowerCase() } as const)
    : validateNickname(rawNickname);

  if (!checkedNickname.ok) {
    return { ok: false, error: checkedNickname.error };
  }

  const checkedPassword = validatePassword(password, {
    nickname: checkedNickname.nickname,
  });

  if (!checkedPassword.ok) return { ok: false, error: checkedPassword.error };

  try {
    const passwordHash = await hashPassword(password);

    // Both conditions live in the filter so they are properties of the write
    // itself: reading first and then updating would leave a window where two
    // concurrent posts both see the account unfinished.
    //
    // `passwordHash: null` is the load-bearing half. Without it this action
    // re-hashes and overwrites the password of an *already finished* account —
    // and since server actions are POST-able directly, that is a password
    // change with no knowledge of the current one. Onboarding runs once.
    const { count } = await prisma.user.updateMany({
      where: { id: session.user.id, nickname: existing, passwordHash: null },
      data: {
        nickname: checkedNickname.nickname,
        nicknameKey: checkedNickname.key,
        passwordHash,
      },
    });

    if (count === 0) {
      return { ok: false, error: "Your account has already been set up." };
    }

    logger.info("auth.onboarded", { userId: session.user.id });
  } catch (error) {
    // The unique index on `nicknameKey` is what actually decides this, rather
    // than a lookup beforehand — two people claiming the same name at once
    // would both pass a check-then-write.
    if (isUniqueConstraintError(error)) {
      return { ok: false, error: "That nickname is taken." };
    }

    return toResult(error);
  }

  // Outside the try, same as the logins above.
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Changes the password on an already-signed-in, already-onboarded account.
 *
 * Re-checks the account code rather than the current password, on purpose:
 * the code is the one credential this app treats as proof of ownership (it's
 * what `loginWithCode` accepts for recovery), so requiring it here means a
 * hijacked *session* alone can't rotate the password — the same bar recovery
 * already has to clear. There's no separate "enter your current password"
 * step, because someone changing their password from settings may well be
 * doing it *because* they've half-forgotten the current one.
 */
export async function changePassword(
  code: string,
  newPassword: string,
): Promise<ActionResult> {
  // Above the try — same reasoning as every other action in this section.
  const session = await requireOnboardedSession();

  const trimmedCode = code.trim();
  if (!trimmedCode) return { ok: false, error: "Enter your account code." };

  const checkedPassword = validatePassword(newPassword, {
    nickname: session.user.nickname ?? undefined,
  });
  if (!checkedPassword.ok) return { ok: false, error: checkedPassword.error };

  try {
    const passwordHash = await hashPassword(newPassword);

    // `codeHash` in the filter is the actual check — a valid session doesn't
    // satisfy it on its own. Same message for "wrong code" as a failed
    // `loginWithCode` lookup: nothing useful to distinguish, and no account
    // enumeration to enable.
    const { count } = await prisma.user.updateMany({
      where: { id: session.user.id, codeHash: hashCode(trimmedCode) },
      data: { passwordHash, failedLogins: 0, lockedUntil: null },
    });

    if (count === 0) return { ok: false, error: "That code isn't recognised." };

    // Changing a password is the "I think someone else is in here" action, so
    // the new password has to actually shut them out. Sessions outlive it
    // otherwise: expiry slides forward on every visit, so one exercised
    // monthly never lapses, and nothing else in the app ends a session it
    // isn't holding the cookie for.
    //
    // The session making the change is spared — signing someone out of the
    // page they are standing on to tell them their password changed is a
    // worse experience than the threat is worth.
    const { count: revoked } = await prisma.session.deleteMany({
      where: { userId: session.user.id, id: { not: session.sessionId } },
    });

    logger.info("auth.password_changed", {
      userId: session.user.id,
      sessionsRevoked: revoked,
    });
  } catch (error) {
    return toResult(error);
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchSuggestion {
  id: string;
  name: string;
  posterPath: string | null;
  firstAirYear: string | null;
  status: TrackStatus | null;
}

/**
 * Backs the search overlay's as-you-type suggestions. Results aren't cached in
 * the database until a show is actually opened or added.
 */
export async function searchSuggestions(
  query: string,
): Promise<{ results?: SearchSuggestion[]; error?: string }> {
  const { user } = await requireOnboardedSession();

  // Capped rather than rejected: TMDB has nothing useful to say about a pasted
  // wall of text, and sending it verbatim helps no one.
  const trimmed = query.trim().slice(0, 200);
  if (!trimmed) return { results: [] };

  let results: TmdbSearchResult[];
  try {
    results = await searchTvShows(trimmed);
  } catch (error) {
    return { error: toResult(error).error };
  }

  // One query for the whole page of results, rather than one per row.
  const tracked = await prisma.trackedShow.findMany({
    where: {
      userId: user.id,
      showId: { in: results.map((result) => String(result.id)) },
    },
    select: { showId: true, status: true },
  });
  const statusByShow = new Map(tracked.map((row) => [row.showId, row.status]));

  return {
    results: results.slice(0, 12).map((result) => {
      const id = String(result.id);

      return {
        id,
        name: result.name,
        posterPath: result.posterPath,
        firstAirYear: result.firstAirYear,
        status: (statusByShow.get(id) ?? null) as TrackStatus | null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tracking
//
// There is only one way a show enters your lists: the "+" button puts it on the
// watchlist. It graduates to "watching" on its own the moment you mark any
// episode watched — which is the point at which "watching" becomes true.
// ---------------------------------------------------------------------------

/** Adds a show to the watchlist, caching it from TMDB on the way in. */
export async function addToWatchlist(tmdbShowId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Actions are POST-able directly, so this is an entry point for untrusted
  // input regardless of what the UI sends. The id reaches a TMDB request path
  // from here, via syncShowFromTmdb.
  if (!isTmdbShowId(tmdbShowId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const existing = await prisma.trackedShow.findUnique({
      where: { userId_showId: { userId: user.id, showId: tmdbShowId } },
      select: { id: true },
    });

    // Already tracked — don't demote a show you're watching back to the
    // watchlist just because the button was pressed again.
    if (existing) return { ok: true };

    await syncShowFromTmdb(tmdbShowId);
    await prisma.trackedShow.create({
      data: { userId: user.id, showId: tmdbShowId, status: "watchlist" },
    });
  } catch (error) {
    // The check above and this create aren't atomic, so a double-click can
    // lose the race and hit the unique constraint. The show is tracked either
    // way, which is all the caller asked for — reporting "something went
    // wrong" for a successful add is the actual bug.
    if (isUniqueConstraintError(error)) return { ok: true };

    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

/** Removes a show from your lists. The cached show/episode rows stay. */
export async function removeShow(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Never reaches TMDB, but the guard holds the invariant uniformly: every
  // showId an action accepts is an id, not just the ones that hit the network.
  // Real rows can't have a non-id key, so this rejects nothing legitimate.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    // `userId` is what keeps this from removing the show for everyone who
    // tracks it. In v1 the filter was incidentally unique; now it is the only
    // thing scoping the delete.
    await prisma.trackedShow.deleteMany({ where: { userId: user.id, showId } });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Watch progress
// ---------------------------------------------------------------------------

/**
 * Marks an episode watched and promotes its show to "watching".
 *
 * The promotion also covers shows that were never added at all: marking an
 * episode watched is a clearer statement of intent than pressing "+", so it
 * creates the tracked row rather than silently recording progress for a show
 * that appears on no list.
 *
 * It also un-pauses. Watching an episode of a paused show is the clearest
 * possible signal you've picked it back up, so there's no separate "resume"
 * action to find.
 */
export async function markEpisodeWatched(
  episodeId: string,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  try {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { showId: true },
    });

    if (!episode) return { ok: false, error: "Unknown episode." };

    // Concurrent, because they touch different rows and neither reads what the
    // other writes. Turso is a network hop per statement, and this is the most
    // tapped action in the app.
    //
    // The ordering that *does* matter is `previous` versus the upsert below:
    // it exists to spot a show coming back from paused or stopped, and the
    // upsert overwrites exactly the status it reads. Reading it after would
    // report every resumed show as already "watching" and the log would
    // silently stop firing — so it stays here, before the write.
    const [, previous] = await Promise.all([
      prisma.watchedEpisode.upsert({
        where: { userId_episodeId: { userId: user.id, episodeId } },
        create: { userId: user.id, episodeId },
        update: {},
      }),
      prisma.trackedShow.findUnique({
        where: { userId_showId: { userId: user.id, showId: episode.showId } },
        select: { status: true },
      }),
    ]);

    await prisma.trackedShow.upsert({
      where: { userId_showId: { userId: user.id, showId: episode.showId } },
      create: { userId: user.id, showId: episode.showId, status: "watching" },
      update: { status: "watching" },
    });

    if (previous?.status === "paused" || previous?.status === "stopped") {
      logger.info("show.resumed", {
        userId: user.id,
        showId: episode.showId,
        via: "watched_episode",
        from: previous.status,
      });
    }

    revalidateShowViews();
  } catch (error) {
    return toResult(error);
  }

  return { ok: true };
}

/**
 * Drops a show back to the watchlist once it has no watched episodes left.
 *
 * This is the exact inverse of the promotion rule: "watching" means at least
 * one episode watched, so undoing the last one has to undo the move as well.
 * Without it, marking an episode by mistake left the show stuck under Watching
 * with zero progress and no way back short of removing and re-adding it.
 *
 * Shows already on the watchlist are untouched, and a show that isn't tracked
 * at all is left alone rather than being added.
 */
async function demoteIfNothingWatched(userId: string, showId: string) {
  const remaining = await prisma.watchedEpisode.count({
    where: { userId, episode: { showId } },
  });

  if (remaining > 0) return;

  // Scoped to "watching" on purpose. A paused show with no watched episodes
  // left is a contradiction anyway, but silently moving it would undo an
  // explicit choice the user made — leave their decision alone.
  const { count } = await prisma.trackedShow.updateMany({
    where: { userId, showId, status: "watching" },
    data: { status: "watchlist" },
  });

  if (count > 0) logger.info("show.demoted_to_watchlist", { userId, showId });
}

/**
 * Sets a started show aside without losing its history.
 *
 * `paused` and `stopped` differ only in intent — coming back versus not — but
 * that intent is the whole point: it's what makes the two lists worth scanning
 * separately months later.
 *
 * Only meaningful from "watching" (or from the other set-aside state, so you
 * can change your mind about which one it is). Setting aside something never
 * started is what the watchlist already is, and doing it to an untracked show
 * would create a tracked row for something never added.
 */
async function setAside(
  userId: string,
  showId: string,
  status: "paused" | "stopped",
): Promise<ActionResult> {
  // Same uniform-invariant guard as removeShow.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  const other = status === "paused" ? "stopped" : "paused";

  try {
    const { count } = await prisma.trackedShow.updateMany({
      where: { userId, showId, status: { in: ["watching", other] } },
      data: { status },
    });

    if (count === 0) {
      return {
        ok: false,
        error: "Only a show you've started can be set aside.",
      };
    }

    logger.info(`show.${status}`, { userId, showId });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

/** Set aside, meaning to come back to it. */
export async function pauseShow(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();
  return setAside(user.id, showId, "paused");
}

/** Set aside for good. */
export async function stopShow(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();
  return setAside(user.id, showId, "stopped");
}

/**
 * Puts a paused or stopped show back on the watching list without marking
 * anything watched — resuming a show you're behind on shouldn't require
 * pretending you've seen an episode.
 */
export async function resumeShow(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Same uniform-invariant guard as removeShow.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const { count } = await prisma.trackedShow.updateMany({
      where: { userId: user.id, showId, status: { in: ["paused", "stopped"] } },
      data: { status: "watching" },
    });

    if (count === 0) {
      return { ok: false, error: "That show isn't paused or stopped." };
    }

    logger.info("show.resumed", { userId: user.id, showId, via: "explicit" });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

/**
 * Unmarks an episode, and returns the show to the watchlist if that was the
 * last watched episode.
 */
export async function unmarkEpisodeWatched(
  episodeId: string,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  try {
    // Independent: the delete is keyed by user and episode id, so it doesn't
    // need the lookup's answer. Only the demotion check that follows does.
    const [episode] = await Promise.all([
      prisma.episode.findUnique({
        where: { id: episodeId },
        select: { showId: true },
      }),
      prisma.watchedEpisode.deleteMany({
        where: { userId: user.id, episodeId },
      }),
    ]);

    if (episode) await demoteIfNothingWatched(user.id, episode.showId);

    revalidateShowViews();
  } catch (error) {
    return toResult(error);
  }

  return { ok: true };
}

/** Marks every already-aired episode of a season watched, or clears them all. */
export async function setSeasonWatched(
  showId: string,
  seasonNumber: number,
  watched: boolean,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Same uniform-invariant guard as removeShow.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    // The caller's own watch marks come back with the episodes rather than in
    // a second query — which is what the separate "already watched" read below
    // used to be. Scoped by userId, or it would carry everyone's marks and
    // decide there was nothing left to insert.
    const episodes = await prisma.episode.findMany({
      where: {
        showId,
        seasonNumber,
        airDate: { not: null, lte: new Date() },
      },
      select: {
        id: true,
        watched: { where: { userId: user.id }, select: { id: true } },
      },
    });

    const episodeIds = episodes.map((episode) => episode.id);

    if (watched) {
      // SQLite doesn't support `skipDuplicates`, so filter out the episodes
      // that are already marked instead of relying on conflict handling.
      const missing = episodes
        .filter((episode) => episode.watched.length === 0)
        .map((episode) => episode.id);

      // Concurrent rather than sequential: different rows, and neither reads
      // the other. Not a `$transaction` — the insert tolerates a lost race and
      // the promotion must survive one, but a transaction would roll the
      // promotion back along with it.
      await Promise.all([
        // Same race as addToWatchlist: another click can mark an episode
        // between the read above and this insert. The season ends up fully
        // marked either way, so a lost race isn't a failure worth reporting.
        missing.length > 0
          ? prisma.watchedEpisode
              .createMany({
                data: missing.map((episodeId) => ({
                  userId: user.id,
                  episodeId,
                })),
              })
              .catch((error) => {
                if (!isUniqueConstraintError(error)) throw error;
              })
          : null,

        // Same promotion rule as marking a single episode.
        episodeIds.length > 0
          ? prisma.trackedShow.upsert({
              where: { userId_showId: { userId: user.id, showId } },
              create: { userId: user.id, showId, status: "watching" },
              update: { status: "watching" },
            })
          : null,
      ]);
    } else {
      await prisma.watchedEpisode.deleteMany({
        where: { userId: user.id, episodeId: { in: episodeIds } },
      });

      // Same rule as unmarking a single episode.
      await demoteIfNothingWatched(user.id, showId);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateNotificationPrefs(
  enabled: boolean,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  try {
    await prisma.settings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, notifyEnabled: enabled },
      update: { notifyEnabled: enabled },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/settings");
  return { ok: true };
}

/** Sets the default country for streaming availability. "" clears it. */
export async function updateCountry(country: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  const value = country.trim().toUpperCase();

  if (value && !/^[A-Z]{2}$/.test(value)) {
    return { ok: false, error: "Country must be a two-letter code." };
  }

  try {
    await prisma.settings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, country: value || null },
      update: { country: value || null },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/settings");
  revalidatePath("/show", "layout");
  return { ok: true };
}


/**
 * Wipes the user's tracking data. The global Show/Episode cache is kept so
 * re-adding a show doesn't have to re-download everything from TMDB.
 */
export async function clearAllData(): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  try {
    // One transaction, children first: a failure partway through used to leave
    // watch history gone but the tracked shows still listed, which reads as
    // "everything I watched was forgotten" rather than as a failed wipe.
    // The `where` clauses are the only thing between "wipe my data" and "wipe
    // everyone's". In v1 these were bare deleteMany calls on tables that held
    // one user's rows; they are now shared.
    await prisma.$transaction([
      prisma.watchedEpisode.deleteMany({ where: { userId: user.id } }),
      prisma.trackedShow.deleteMany({ where: { userId: user.id } }),
      prisma.settings.deleteMany({ where: { userId: user.id } }),
    ]);
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
