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
const { completeOnboarding, loginWithCode, loginWithPassword, logout } =
  await import("@/app/actions");
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

  it("sends a finished account straight to the app", async () => {
    await makeOnboardedUser("theo", "correct-horse");

    expect(await redirectedTo(() => loginWithCode("correct-horse"))).toBe("/");
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
