import "server-only";

import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password hashing, for the credentials a user chooses at first login.
//
// This is deliberately NOT the same treatment as `hashCode` in lib/auth.ts.
// That one is a bare SHA-256, which is defensible only because account codes
// are 128-bit values this app generates: there is no dictionary to run against
// them, and an indexed lookup is worth having. A password someone chose is the
// opposite case on both counts, so it needs a slow, salted KDF and gets one.

/**
 * Hand-wrapped rather than `promisify(scrypt)`: promisify resolves to the
 * callback overload without an options argument, so the cost parameters below
 * would not type-check — and silently defaulting them would be worse than the
 * five lines this costs.
 */
function scryptAsync(
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

/**
 * scrypt, from Node's standard library, rather than bcrypt or argon2 from npm.
 * Both of those are native modules, which are a recurring source of pain on
 * serverless builds; scrypt is memory-hard, well regarded for passwords, and
 * already here.
 *
 * N=2^15 with r=8 costs roughly 100ms and 32MB per hash. That is a middle
 * setting: heavy enough to make offline guessing expensive, light enough to
 * stay well inside a serverless function's memory and time budget, on a login
 * that also has a 128-bit account code as its backstop.
 */
const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

/** 128 * N * r is scrypt's working set — 32MB here, so allow headroom. */
const MAX_MEM = 128 * N * R * 2;

/**
 * `scrypt$N$r$p$salt$hash`.
 *
 * Self-describing so the parameters can be raised later without invalidating
 * every existing password: a stored hash carries the settings it was made
 * with, and verification uses those rather than today's constants.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);

  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });

  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/**
 * Checks a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed record: a corrupt row
 * should fail the login, not crash the action and surface as "something went
 * wrong" for what is really a bad password.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, hashHex] = parts;

  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isFinite(cost.N) || !Number.isFinite(cost.r) || !Number.isFinite(cost.p)) {
    return false;
  }

  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  let derived: Buffer;

  try {
    derived = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length, {
      ...cost,
      maxmem: 128 * cost.N * cost.r * 2,
    });
  } catch {
    // Unusable parameters in the stored record — same reasoning as above.
    return false;
  }

  return timingSafeEqual(derived, expected);
}

/**
 * Burns roughly one hash's worth of time.
 *
 * Called when the nickname doesn't exist, so a wrong nickname and a wrong
 * password take about the same time to reject. Without it, the response time
 * says which of the two was wrong — a small leak, but the fix costs one line
 * and nicknames are meant to become publicly visible later, at which point
 * they are the half of the credential an attacker already has.
 */
export async function fakeVerify(): Promise<void> {
  await scryptAsync(randomBytes(16), randomBytes(16), KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
}
