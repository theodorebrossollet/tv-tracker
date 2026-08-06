import { beforeEach, describe, expect, it, vi } from "vitest";

// A cookie jar standing in for the browser's. Next's `cookies()` is only
// available inside a request, and the point of these tests is the session
// logic, not Next's plumbing.
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

// `redirect` throws in Next too, which is what makes it work as a control-flow
// escape from a page or action. Throwing something recognisable here lets the
// tests assert on the destination.
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

// Same stub the other action tests use: revalidatePath needs a request context
// that doesn't exist here.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  SESSION_COOKIE,
  createSession,
  deleteExpiredSessions,
  destroySession,
  getSession,
  hashCode,
  requireOnboardedSession,
  requireSession,
} = await import("@/lib/auth");
const {
  changePassword,
  completeOnboarding,
  loginWithCode,
  loginWithPassword,
  logout,
  signOutEverywhere,
} = await import("@/app/account-actions");
const { FAILURE_THRESHOLD } = await import("@/lib/login-throttle");
const { PASSWORD_MAX } = await import("@/lib/password-rules");
const { NICKNAME_MAX } = await import("@/lib/nickname");
const { hashPassword } = await import("@/lib/password");
const { prisma } = await import("@/lib/prisma");
const { resetDatabase } = await import("./helpers");

const DAY_MS = 24 * 60 * 60 * 1000;

async function makeUser(
  nickname: string | null = null,
  code = "code-1",
  password: string | null = null,
) {
  return prisma.user.create({
    data: {
      codeHash: hashCode(code),
      nickname,
      nicknameKey: nickname?.toLowerCase() ?? null,
      passwordHash: password === null ? null : await hashPassword(password),
    },
  });
}

/** A finished account: nickname and password both set. */
const makeOnboardedUser = (nickname = "theo", code = "code-1", password = "hunter2hunter2") =>
  makeUser(nickname, code, password);

/** The destination of a redirect thrown by the call, or null if it returned. */
async function redirectedTo(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    throw error;
  }
}

beforeEach(async () => {
  jar.clear();
  await resetDatabase();
});

describe("sessions", () => {
  it("stores only a hash of the token that goes in the cookie", async () => {
    const user = await makeUser();
    await createSession(user.id);

    const token = jar.get(SESSION_COOKIE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    // The row must not be usable as a credential if the database leaks.
    expect(rows[0].id).not.toBe(token);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("resolves a valid cookie to its user", async () => {
    const user = await makeUser("theo");
    await createSession(user.id);

    await expect(getSession()).resolves.toMatchObject({
      user: { id: user.id, nickname: "theo" },
    });
  });

  it("returns null with no cookie, an unknown token, or an expired row", async () => {
    await expect(getSession()).resolves.toBeNull();

    jar.set(SESSION_COOKIE, "not-a-real-token");
    await expect(getSession()).resolves.toBeNull();

    const user = await makeUser();
    await createSession(user.id);
    await prisma.session.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(getSession()).resolves.toBeNull();
  });

  it("extends a session that hasn't been used for a day", async () => {
    const user = await makeUser();
    await createSession(user.id);

    // Two days of the window already spent — past the extend threshold.
    const stale = new Date(Date.now() + 88 * DAY_MS);
    await prisma.session.updateMany({ data: { expiresAt: stale } });

    await getSession();

    const after = await prisma.session.findFirstOrThrow();
    expect(after.expiresAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("does not write on every read", async () => {
    // Sliding expiry that writes per request would make every force-dynamic
    // page load a database write, which is the cost the session table was
    // argued to avoid.
    const user = await makeUser();
    await createSession(user.id);

    const before = await prisma.session.findFirstOrThrow();
    await getSession();
    const after = await prisma.session.findFirstOrThrow();

    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
  });

  it("revokes on destroy, and tolerates doing it twice", async () => {
    const user = await makeUser();
    await createSession(user.id);

    await destroySession();

    expect(jar.has(SESSION_COOKIE)).toBe(false);
    await expect(prisma.session.count()).resolves.toBe(0);
    await expect(destroySession()).resolves.toBeUndefined();
  });

  it("sweeps expired sessions and leaves live ones", async () => {
    const user = await makeUser();
    await prisma.session.createMany({
      data: [
        { id: "dead", userId: user.id, expiresAt: new Date(Date.now() - 1000) },
        { id: "live", userId: user.id, expiresAt: new Date(Date.now() + DAY_MS) },
      ],
    });

    await expect(deleteExpiredSessions()).resolves.toBe(1);
    await expect(prisma.session.findMany({ select: { id: true } })).resolves.toEqual(
      [{ id: "live" }],
    );
  });
});

describe("gates", () => {
  it("sends a signed-out visitor to /login", async () => {
    expect(await redirectedTo(requireSession)).toBe("/login");
    expect(await redirectedTo(requireOnboardedSession)).toBe("/login");
  });

  it("sends a signed-in visitor with no nickname to /welcome", async () => {
    const user = await makeUser(null);
    await createSession(user.id);

    // Session validity and "onboarding done" are separate checks: this one
    // passes the first and fails the second.
    expect(await redirectedTo(requireSession)).toBeNull();
    expect(await redirectedTo(requireOnboardedSession)).toBe("/welcome");
  });

  it("sends a signed-in visitor with no password to /welcome", async () => {
    // The state every account was left in before passwords existed. A gate
    // that only checks the nickname would wave these straight through with no
    // usable credential set.
    const user = await makeUser("theo", "code-1", null);
    await createSession(user.id);

    expect(await redirectedTo(requireSession)).toBeNull();
    expect(await redirectedTo(requireOnboardedSession)).toBe("/welcome");
  });

  it("lets an onboarded visitor through", async () => {
    const user = await makeOnboardedUser();
    await createSession(user.id);

    expect(await redirectedTo(requireOnboardedSession)).toBeNull();
  });
});

describe("loginWithCode", () => {
  it("issues a session and redirects by onboarding state", async () => {
    await makeUser(null, "correct-horse");

    // Success redirects rather than returning. Navigating on the client
    // instead needed router.replace plus router.refresh, and those two in one
    // transition deadlock — the action returns 200, the destination renders,
    // and the form sits on "Signing in…" forever.
    expect(await redirectedTo(() => loginWithCode("correct-horse"))).toBe("/welcome");
    await expect(prisma.session.count()).resolves.toBe(1);
  });

  it("sends a finished account to choose a new password, not straight into the app", async () => {
    // The code is the recovery route for a forgotten password — signing in
    // with it and landing in the app with the old, still-forgotten password
    // intact would just bring them back here next time.
    const user = await makeOnboardedUser("theo", "correct-horse");

    expect(await redirectedTo(() => loginWithCode("correct-horse"))).toBe("/welcome");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBeNull();
    expect(after.nickname).toBe("theo"); // unaffected — only the password resets
  });

  it("lets a recovered account finish with a new password", async () => {
    const user = await makeOnboardedUser("theo", "correct-horse", "old-password1");
    await redirectedTo(() => loginWithCode("correct-horse"));

    expect(
      await redirectedTo(() => completeOnboarding("theo", "new-password1")),
    ).toBe("/");

    jar.clear();
    await prisma.session.deleteMany();

    expect(
      await redirectedTo(() => loginWithPassword("theo", "new-password1")),
    ).toBe("/");
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.not.toMatchObject({ passwordHash: null });
  });

  it("leaves an unfinished account (no password yet) alone", async () => {
    // Nickname set, password never chosen — the existing "keep the nickname,
    // only ask for a password" welcome path, not the reset path.
    const user = await makeUser("theo", "correct-horse", null);

    await redirectedTo(() => loginWithCode("correct-horse"));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBeNull();
  });

  it("revokes existing sessions when recovering", async () => {
    // Recovery is the other half of the same story as changePassword: someone
    // reaching for their code has lost control of something, so the sessions
    // that predate it can't be trusted either.
    const user = await makeOnboardedUser("theo", "correct-horse", "old-password1");

    await createSession(user.id);
    const staleCookie = jar.get(SESSION_COOKIE)!;

    await redirectedTo(() => loginWithCode("correct-horse"));

    // Exactly one session: the one the code sign-in just minted.
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);

    jar.set(SESSION_COOKIE, staleCookie);
    await expect(getSession()).resolves.toBeNull();
  });

  it("keeps a mid-onboarding session when there is no password to recover", async () => {
    // No password set means nothing has been lost — this is someone still
    // finishing setup, and signing them out mid-flow would be gratuitous.
    const user = await makeUser("theo", "correct-horse", null);

    await createSession(user.id);
    const existing = jar.get(SESSION_COOKIE)!;

    await redirectedTo(() => loginWithCode("correct-horse"));

    jar.set(SESSION_COOKIE, existing);
    await expect(getSession()).resolves.not.toBeNull();
  });

  it("tolerates a pasted code with surrounding whitespace", async () => {
    await makeUser(null, "correct-horse");

    expect(await redirectedTo(() => loginWithCode("  correct-horse\n"))).toBe("/welcome");
  });

  it("rejects a wrong code without creating a session", async () => {
    await makeUser(null, "correct-horse");

    const result = await loginWithCode("wrong");

    expect(result.ok).toBe(false);
    // Asserting the *message*, not just `ok: false`. Without the "no such user"
    // guard this action crashes on a null user and `toResult` reports the
    // generic failure — which would satisfy a bare `ok === false` and leave the
    // missing guard undetected.
    expect(result.error).toMatch(/isn't recognised/i);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it("rejects an empty code", async () => {
    await expect(loginWithCode("   ")).resolves.toMatchObject({ ok: false });
  });

  it("ends only the session it was called with, not the account's others", async () => {
    // The point of a stored session table: one device can be cut off without
    // disturbing the rest. A logout that cleared every row would make "sign out
    // from a device that isn't mine" mean "sign out everywhere".
    const user = await makeOnboardedUser();
    await prisma.session.create({
      data: {
        id: "other-device",
        userId: user.id,
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    });

    await createSession(user.id);
    expect(await redirectedTo(logout)).toBe("/login");

    await expect(
      prisma.session.findMany({ select: { id: true } }),
    ).resolves.toEqual([{ id: "other-device" }]);
  });

  it("clears the session on logout", async () => {
    await makeUser(null, "correct-horse");
    await redirectedTo(() => loginWithCode("correct-horse"));

    expect(await redirectedTo(logout)).toBe("/login");
    await expect(prisma.session.count()).resolves.toBe(0);
    await expect(getSession()).resolves.toBeNull();
  });
});

describe("loginWithPassword", () => {
  it("signs in a finished account", async () => {
    await makeOnboardedUser("theo", "code-1", "hunter2hunter2");

    expect(
      await redirectedTo(() => loginWithPassword("theo", "hunter2hunter2")),
    ).toBe("/");
    await expect(prisma.session.count()).resolves.toBe(1);
  });

  it("matches the nickname case-insensitively", async () => {
    await makeOnboardedUser("Theo", "code-1", "hunter2hunter2");

    expect(
      await redirectedTo(() => loginWithPassword("  tHeO ", "hunter2hunter2")),
    ).toBe("/");
  });

  it("rejects a wrong password without creating a session", async () => {
    await makeOnboardedUser("theo", "code-1", "hunter2hunter2");

    const result = await loginWithPassword("theo", "wrong-password");

    expect(result.ok).toBe(false);
    // The message, not just ok:false — a crash would also be ok:false, and the
    // wording is what proves the rejection was deliberate.
    expect(result.error).toMatch(/wrong nickname or password/i);
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it("says the same thing for an unknown nickname as for a wrong password", async () => {
    await makeOnboardedUser("theo", "code-1", "hunter2hunter2");

    const unknown = await loginWithPassword("nobody", "hunter2hunter2");
    const wrong = await loginWithPassword("theo", "not-the-password");

    // Identical wording, so the form never reveals which half was wrong.
    expect(unknown.error).toBe(wrong.error);
  });

  it("turns away an over-length password without hashing it", async () => {
    const user = await makeOnboardedUser("theo", "code-1", "hunter2hunter2");

    // Hashing is ~100ms of CPU and 32MB, and this action is reachable by an
    // unauthenticated POST — so the input it hands to scrypt has to be bounded.
    // The spy is the assertion: it proves the request was turned away *before*
    // the expensive part, not merely that it was rejected.
    const lookup = vi.spyOn(prisma.user, "findUnique");
    const result = await loginWithPassword("theo", "x".repeat(PASSWORD_MAX + 1));

    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/wrong nickname or password/i);
    expect(lookup).not.toHaveBeenCalled();

    lookup.mockRestore();

    // Still the same message an ordinary failure gets, and the account is
    // untouched — no failed-login counted against it.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLogins).toBe(0);
  });

  it("turns away an over-length nickname the same way", async () => {
    await makeOnboardedUser("theo", "code-1", "hunter2hunter2");

    const lookup = vi.spyOn(prisma.user, "findUnique");
    const result = await loginWithPassword("n".repeat(NICKNAME_MAX + 1), "hunter2hunter2");

    expect(result).toMatchObject({ ok: false });
    expect(lookup).not.toHaveBeenCalled();

    lookup.mockRestore();
  });

  it("refuses an account that hasn't set a password yet", async () => {
    // Nickname set, password still null — reachable for accounts that existed
    // before passwords, and it must not be a way in without one.
    await makeUser("theo", "code-1", null);

    // A real-looking password, not "" — an empty one is rejected by the
    // required-fields check before the password branch is ever reached, so it
    // would pass this test even with that branch removed.
    const result = await loginWithPassword("theo", "hunter2hunter2");

    expect(result.ok).toBe(false);
    // The specific message, not the generic crash one: without the null-hash
    // guard, verifyPassword throws on a null record and toResult reports
    // "Something went wrong", which is also ok: false.
    expect(result.error).toMatch(/wrong nickname or password/i);
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it("rejects empty input", async () => {
    await expect(loginWithPassword("", "")).resolves.toMatchObject({ ok: false });
    await expect(loginWithPassword("theo", "")).resolves.toMatchObject({ ok: false });
  });
});

describe("login throttling", () => {
  const failTimes = async (n: number) => {
    for (let i = 0; i < n; i++) {
      await loginWithPassword("theo", "not-the-password");
    }
  };

  it("counts consecutive failures on the account", async () => {
    const user = await makeOnboardedUser();

    await failTimes(3);

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ failedLogins: 3, lockedUntil: null });
  });

  it("counts every failure when they arrive at once", async () => {
    // The throttle's whole value is the count, and the count used to be
    // computed in Node from a row read a statement earlier: `failedLogins + 1`
    // against a value every concurrent request had already fetched. All of them
    // wrote the same successor, so a batch of N wrong guesses advanced the
    // counter by one — worth roughly a 200x increase in guesses per lockout
    // window against an attacker who simply doesn't send them in series, which
    // is free on a platform that scales out per request.
    //
    // Fails against the read-modify-write version, which lands on 1.
    const user = await makeOnboardedUser();
    const attempts = 6;

    await Promise.all(
      Array.from({ length: attempts }, () =>
        loginWithPassword("theo", "not-the-password"),
      ),
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ failedLogins: attempts });
  });

  it("locks the account once the threshold is crossed", async () => {
    const user = await makeOnboardedUser();

    await failTimes(FAILURE_THRESHOLD);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lockedUntil).not.toBeNull();
    expect(after.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses the right password while locked", async () => {
    await makeOnboardedUser();
    await failTimes(FAILURE_THRESHOLD);

    // The password is correct. The lockout is the point.
    const result = await loginWithPassword("theo", "hunter2hunter2");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too many attempts/i);
    await expect(prisma.session.count()).resolves.toBe(0);
  });

  it("lets the right password through once the lock expires", async () => {
    const user = await makeOnboardedUser();
    await failTimes(FAILURE_THRESHOLD);

    await prisma.user.update({
      where: { id: user.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    expect(
      await redirectedTo(() => loginWithPassword("theo", "hunter2hunter2")),
    ).toBe("/");
  });

  it("resets the counter on a successful sign-in", async () => {
    const user = await makeOnboardedUser();

    await failTimes(FAILURE_THRESHOLD - 1);
    await redirectedTo(() => loginWithPassword("theo", "hunter2hunter2"));

    // Without the reset the counter accrues across months of ordinary typos
    // and eventually locks someone who never got anything wrong twice running.
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  it("lets the account code clear a lockout", async () => {
    // The escape hatch that makes locking safe: a stranger who trips someone
    // else's lockout cannot keep them out, because the way back in never
    // depended on the password.
    const user = await makeOnboardedUser("theo", "correct-horse");
    await failTimes(FAILURE_THRESHOLD);

    // Also sent to set a new password, same as any other code recovery — see
    // the "loginWithCode" describe block above.
    expect(await redirectedTo(() => loginWithCode("correct-horse"))).toBe("/welcome");

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  it("does not count failures against an unknown nickname", async () => {
    await makeOnboardedUser();

    await loginWithPassword("nobody-at-all", "whatever-password");

    // Nothing to count against, and the real account must not be affected.
    await expect(
      prisma.user.findFirstOrThrow(),
    ).resolves.toMatchObject({ failedLogins: 0 });
  });
});

describe("completeOnboarding", () => {
  it("sets nickname and password together", async () => {
    const user = await makeUser(null);
    await createSession(user.id);

    expect(
      await redirectedTo(() => completeOnboarding("ThEo", "hunter2hunter2")),
    ).toBe("/");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.nickname).toBe("ThEo");
    expect(after.nicknameKey).toBe("theo");
    // Stored as a salted scrypt record, never the password itself.
    expect(after.passwordHash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(after.passwordHash).not.toContain("hunter2hunter2");
  });

  it("lets the new credentials sign in", async () => {
    const user = await makeUser(null);
    await createSession(user.id);
    await redirectedTo(() => completeOnboarding("theo", "hunter2hunter2"));

    jar.clear();
    await prisma.session.deleteMany();

    expect(
      await redirectedTo(() => loginWithPassword("theo", "hunter2hunter2")),
    ).toBe("/");
  });

  it("keeps the existing nickname and only adds a password", async () => {
    // The state accounts were left in before passwords existed.
    const user = await makeUser("theo", "code-1", null);
    await createSession(user.id);

    // A different nickname is submitted; it must be ignored, not applied.
    expect(
      await redirectedTo(() => completeOnboarding("someoneelse", "hunter2hunter2")),
    ).toBe("/");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.nickname).toBe("theo");
    expect(after.passwordHash).not.toBeNull();
  });

  it("refuses to run twice, because nicknames are permanent", async () => {
    const user = await makeUser(null);
    await createSession(user.id);
    await redirectedTo(() => completeOnboarding("theo", "hunter2hunter2"));

    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    // The UI never offers this, but actions are POST-able directly. Without
    // `passwordHash: null` in the update's filter, this call silently resets
    // the password of a finished account — a password change that never had to
    // know the current one.
    const result = await completeOnboarding("someoneelse", "another-password");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already been set up/i);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.nickname).toBe("theo");
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("rejects a nickname taken by someone else, ignoring case", async () => {
    await makeOnboardedUser("Theo", "code-taken");

    const user = await makeUser(null, "code-mine");
    await createSession(user.id);

    const result = await completeOnboarding("tHeO", "hunter2hunter2");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/taken/i);
  });

  it("rejects values the shared validation rejects", async () => {
    const user = await makeUser(null);
    await createSession(user.id);

    const cases: Array<[string, string]> = [
      ["ab", "hunter2hunter2"], // nickname too short
      ["a/b", "hunter2hunter2"], // illegal character
      ["...", "hunter2hunter2"], // no alphanumeric
      ["theo", "short"], // password too short
      ["theo", "theo"], // password is the nickname
    ];

    for (const [nick, pass] of cases) {
      expect(await completeOnboarding(nick, pass), `${nick}/${pass}`).toMatchObject({
        ok: false,
      });
    }

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ nickname: null, passwordHash: null });
  });

  it("redirects a signed-out caller instead of writing", async () => {
    expect(
      await redirectedTo(() => completeOnboarding("theo", "hunter2hunter2")),
    ).toBe("/login");
  });
});

describe("signOutEverywhere", () => {
  it("ends every session on the account, this one included", async () => {
    // The gap this fills: revocation existed, but only as a side effect of
    // changing a password. "I left myself signed in on a borrowed laptop"
    // shouldn't require picking a new password and re-entering it everywhere.
    const user = await makeOnboardedUser("theo", "correct-horse", "hunter2hunter2");

    await createSession(user.id);
    const otherCookie = jar.get(SESSION_COOKIE)!;
    await createSession(user.id);

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
    expect(await redirectedTo(() => signOutEverywhere())).toBe("/login");

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

    // Including the caller's own — no cookie left resolving to anything.
    jar.set(SESSION_COOKIE, otherCookie);
    await expect(getSession()).resolves.toBeNull();
  });

  it("clears the cookie, not just the row", async () => {
    // The row is gone either way, but a cookie left behind means the browser
    // keeps presenting a dead token and every request pays a lookup to be
    // told so.
    const user = await makeOnboardedUser("theo", "correct-horse", "hunter2hunter2");
    await createSession(user.id);

    await redirectedTo(() => signOutEverywhere());

    expect(jar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("leaves another account alone", async () => {
    const user = await makeOnboardedUser("theo", "correct-horse", "hunter2hunter2");
    const other = await makeOnboardedUser("sam", "code-2", "other-password1");

    await createSession(other.id);
    await createSession(user.id);

    await redirectedTo(() => signOutEverywhere());

    expect(await prisma.session.count({ where: { userId: other.id } })).toBe(1);
  });

  it("redirects a signed-out caller instead of writing", async () => {
    expect(await redirectedTo(() => signOutEverywhere())).toBe("/login");
  });
});

describe("changePassword", () => {
  it("changes the password when the code matches", async () => {
    const user = await makeOnboardedUser("theo", "correct-horse", "old-password1");
    await createSession(user.id);

    const result = await changePassword("correct-horse", "new-password1");
    expect(result.ok).toBe(true);

    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    jar.clear();
    await prisma.session.deleteMany();

    expect(
      await redirectedTo(() => loginWithPassword("theo", "new-password1")),
    ).toBe("/");
    // The old password must no longer work.
    await expect(
      loginWithPassword("theo", "old-password1"),
    ).resolves.toMatchObject({ ok: false });

    expect(before.passwordHash).not.toBeNull();
  });

  it("rejects a wrong code without touching the password", async () => {
    const user = await makeOnboardedUser("theo", "correct-horse", "old-password1");
    await createSession(user.id);

    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const result = await changePassword("wrong-code", "new-password1");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/isn't recognised/i);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("rejects a new password that fails the shared validation", async () => {
    const user = await makeOnboardedUser("theo", "correct-horse", "old-password1");
    await createSession(user.id);

    const result = await changePassword("correct-horse", "short");
    expect(result.ok).toBe(false);

    // The old password is still the one that works.
    expect(
      await redirectedTo(() => loginWithPassword("theo", "old-password1")),
    ).toBe("/");
  });

  it("redirects a signed-out caller instead of writing", async () => {
    expect(
      await redirectedTo(() => changePassword("correct-horse", "new-password1")),
    ).toBe("/login");
  });

  it("signs out every other session, keeping the one making the change", async () => {
    // The threat this answers: someone else holds a live cookie. Changing the
    // password has to end that, or "change your password" is advice that
    // doesn't work — expiry slides forward on every visit, so their session
    // never lapses on its own.
    const user = await makeOnboardedUser("theo", "correct-horse", "old-password1");

    await createSession(user.id);
    const otherCookie = jar.get(SESSION_COOKIE)!;

    // Created second, so its cookie is the one the jar now holds — this stands
    // in for the browser actually making the change.
    await createSession(user.id);
    const ownCookie = jar.get(SESSION_COOKIE)!;

    expect(otherCookie).not.toBe(ownCookie);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

    expect(await changePassword("correct-horse", "new-password1")).toMatchObject(
      { ok: true },
    );

    // The caller is still signed in...
    await expect(getSession()).resolves.toMatchObject({ user: { id: user.id } });

    // ...and the other cookie now resolves to nothing.
    jar.set(SESSION_COOKIE, otherCookie);
    await expect(getSession()).resolves.toBeNull();

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it("leaves another account's sessions alone", async () => {
    const user = await makeOnboardedUser("theo", "correct-horse", "old-password1");
    const other = await makeOnboardedUser("sam", "code-2", "other-password1");

    await createSession(other.id);
    await createSession(user.id);

    await changePassword("correct-horse", "new-password1");

    // The revoking `deleteMany` is scoped by userId; without that filter this
    // would sign the whole household out.
    expect(await prisma.session.count({ where: { userId: other.id } })).toBe(1);
  });
});
