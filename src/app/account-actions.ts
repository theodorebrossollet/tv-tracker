"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  clearSessionCookie,
  createSession,
  destroySession,
  hashCode,
  requireOnboardedSession,
  requireSession,
} from "@/lib/auth";
import {
  isUniqueConstraintError,
  toResult,
  type ActionResult,
} from "@/lib/action-result";
import { describeWait, isLockedOut, lockoutMs } from "@/lib/login-throttle";
import { logger } from "@/lib/logger";
import { NICKNAME_MAX, validateNickname } from "@/lib/nickname";
import { fakeVerify, hashPassword, verifyPassword } from "@/lib/password";
import { PASSWORD_MAX, validatePassword } from "@/lib/password-rules";
import { prisma } from "@/lib/prisma";

// Signing in, signing out, finishing an account, changing a password.
//
// Split from `app/actions.ts` because it shares nothing with tracking beyond
// `ActionResult` — these six touch User and Session and nothing else, while
// everything there is about shows and episodes. **Every rule in that file's
// header applies here too**, and they are the load-bearing ones: actions are
// POST-able directly, so the gate is the only thing in front of them, and Next's
// same-origin check on server actions is what stops another site posting on a
// visitor's behalf. Read it before adding anything here.
//
// These are the only actions that may run without a *completed* account, which
// is why the two that must stay reachable mid-onboarding — `completeOnboarding`
// and `logout` — use `requireSession` rather than `requireOnboardedSession`.
//
// Two credentials, hashed two different ways on purpose: the account code is a
// 128-bit invite (SHA-256, indexed lookup) and the password is user-chosen
// (scrypt, salted, slow). `lib/password.ts` explains why one treatment would be
// wrong for both.
//
// The session check goes ABOVE each `try`, never inside. `redirect` and the
// gates both work by throwing, and `toResult` would swallow that into a generic
// error toast. Same for the `redirect` that ends a successful sign-in.

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
      // The database does the arithmetic, not Node. `user.failedLogins + 1`
      // reads a value fetched by the lookup above, and the two statements are
      // separate round trips with nothing holding a lock between them — so N
      // attempts fired at once all read the same count and all write the same
      // successor, advancing it by one for the whole batch. Vercel scales out
      // per request, so that concurrency is free to an attacker, and it is the
      // reason this counter lives in the database rather than in-process at
      // all. `increment` makes it monotonic: N attempts cost N.
      const { failedLogins } = await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: { increment: 1 } },
        select: { failedLogins: true },
      });

      const lockFor = lockoutMs(failedLogins);

      // Only written once there is a lock to record. Clearing it on every
      // failure below the threshold would be the one write that *undoes* a
      // lock a concurrent request just set.
      if (lockFor > 0) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + lockFor) },
        });
      }

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
 * Ends every session on the account, including this one.
 *
 * `changePassword` already revokes the others, but only as a side effect of
 * picking a new password — so the answer to "I left myself signed in on a
 * borrowed laptop" was to change a password that was never the problem. This
 * does that one job on its own.
 *
 * Everything goes, this session included. Keeping the current one would mean
 * deciding it is the trustworthy one, and someone reaching for this doesn't
 * necessarily know which device they are on; signing out and back in is a
 * cheap, unambiguous end state. That's also why it needs no confirmation
 * beyond the button: the worst case is typing your password again.
 */
export async function signOutEverywhere(): Promise<ActionResult> {
  const session = await requireOnboardedSession();

  try {
    const { count } = await prisma.session.deleteMany({
      where: { userId: session.user.id },
    });

    // Cookie only. The deleteMany above already took this session's row with
    // the rest, so `destroySession` would spend a round trip deleting nothing —
    // but the cookie still has to go, or the browser keeps presenting a token
    // until it expires and every request pays a lookup to be told it's invalid.
    await clearSessionCookie();

    logger.info("auth.signed_out_everywhere", {
      userId: session.user.id,
      sessionsRevoked: count,
    });
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
    // The code is checked before the hash, not after. scrypt here is ~100ms and
    // 32MB, and hashing first spent all of it on every wrong-code attempt — an
    // allocation an authenticated caller could ask for in a loop, for a write
    // that was never going to land. There is no timing argument for the old
    // order either: this caller is already signed in, and the code isn't being
    // probed for existence, only matched against their own account.
    const matches = await prisma.user.count({
      where: { id: session.user.id, codeHash: hashCode(trimmedCode) },
    });

    // Same message for "wrong code" as a failed `loginWithCode` lookup:
    // nothing useful to distinguish, and no account enumeration to enable.
    if (matches === 0) return { ok: false, error: "That code isn't recognised." };

    const passwordHash = await hashPassword(newPassword);

    // `codeHash` stays in the filter rather than relying on the check above —
    // a valid session doesn't satisfy it on its own, and re-stating it makes
    // the write itself conditional on the credential instead of on a decision
    // made a statement earlier. A code rotated in between lands here as a
    // no-op, which is the correct outcome.
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
