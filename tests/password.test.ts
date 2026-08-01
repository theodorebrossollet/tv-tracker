import { describe, expect, it } from "vitest";

import { fakeVerify, hashPassword, verifyPassword } from "@/lib/password";
import { validatePassword } from "@/lib/password-rules";

describe("hashPassword / verifyPassword", () => {
  it("round-trips a password", async () => {
    const stored = await hashPassword("hunter2hunter2");

    await expect(verifyPassword("hunter2hunter2", stored)).resolves.toBe(true);
    await expect(verifyPassword("hunter2hunter3", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("hunter2hunter2");
    const b = await hashPassword("hunter2hunter2");

    expect(a).not.toBe(b);
    // Both still verify — the salt is carried in the record, not remembered.
    await expect(verifyPassword("hunter2hunter2", a)).resolves.toBe(true);
    await expect(verifyPassword("hunter2hunter2", b)).resolves.toBe(true);
  });

  it("never stores the password", async () => {
    const stored = await hashPassword("correct-horse-battery");

    expect(stored).not.toContain("correct-horse-battery");
    expect(stored).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  });

  it("carries its parameters, so they can be raised later", async () => {
    // A record made with different settings must still verify, or changing the
    // constants would lock every existing account out.
    const stored = await hashPassword("hunter2hunter2");
    const [, n, r, p] = stored.split("$");

    expect(Number(n)).toBeGreaterThan(1);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it("returns false for a malformed record rather than throwing", async () => {
    // A corrupt row should fail the login, not crash the action and surface as
    // "something went wrong" for what is really a bad password.
    for (const bad of ["", "nonsense", "scrypt$1$2$3", "bcrypt$1$2$3$aa$bb", "scrypt$x$y$z$aa$bb"]) {
      await expect(verifyPassword("hunter2hunter2", bad), bad).resolves.toBe(false);
    }
  });

  it("fakeVerify costs about as much as a real check", async () => {
    // It exists so a wrong nickname and a wrong password take similar time.
    const stored = await hashPassword("hunter2hunter2");

    const realStart = performance.now();
    await verifyPassword("wrong", stored);
    const real = performance.now() - realStart;

    const fakeStart = performance.now();
    await fakeVerify();
    const fake = performance.now() - fakeStart;

    // Deliberately loose: this asserts the same order of magnitude, not a
    // constant-time guarantee, which JS can't offer anyway.
    expect(fake).toBeGreaterThan(real / 10);
    expect(fake).toBeLessThan(real * 10);
  });
});

describe("validatePassword", () => {
  it("accepts anything long enough", () => {
    for (const value of ["12345678", "a very long passphrase", "  spaces  "]) {
      expect(validatePassword(value), value).toMatchObject({ ok: true });
    }
  });

  it("does not trim, because spaces are legal characters", () => {
    // Trimming would lock someone out of an account whose password a manager
    // generated with a trailing space.
    expect(validatePassword("  12345  ")).toMatchObject({ ok: true });
    expect(validatePassword(" 1234 ")).toMatchObject({ ok: false });
  });

  it("rejects short and absurdly long values", () => {
    expect(validatePassword("1234567")).toMatchObject({ ok: false });
    expect(validatePassword("x".repeat(128))).toMatchObject({ ok: true });
    expect(validatePassword("x".repeat(129))).toMatchObject({ ok: false });
  });

  it("rejects the nickname as a password, ignoring case", () => {
    expect(validatePassword("Theodore", { nickname: "theodore" })).toMatchObject({
      ok: false,
    });
    expect(validatePassword("theodore1", { nickname: "theodore" })).toMatchObject({
      ok: true,
    });
  });
});
