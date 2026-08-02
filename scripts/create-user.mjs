// Creates an account and prints its code once.
//
// This is the only way accounts come into existence — there is no sign-up
// form, by design (docs/scope-v2.md). Generate a code, hand it over out of
// band, and the recipient chooses a nickname and password the first time they
// use it.
//
// The code is printed to stdout exactly once and stored only as a SHA-256
// hash. It is deliberately never passed to lib/logger.ts: log lines are
// structured, retained, and shipped somewhere, and this is the credential for
// an account whose only recovery route is the code itself.
//
// Tell whoever you give it to: keep the code even after setting a password.
// It is the way back in if they forget it, and there is no email to send a
// reset to.
//
// Usage:
//   DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" node scripts/create-user.mjs
//
// Unlike scripts/create-admin-user.mjs this has no "must be the first account"
// guard — that one exists solely to bootstrap the pre-accounts data, and
// refuses to run twice so it cannot mint a second owner for it.

import { createClient } from "@libsql/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import "dotenv/config";

const url = process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env or the environment.");
  process.exit(1);
}

if (url.startsWith("libsql://") && !authToken) {
  console.error("DATABASE_URL points at Turso but TURSO_AUTH_TOKEN is not set.");
  process.exit(1);
}

const client = createClient({ url, authToken });

// 16 bytes / 128 bits, matching create-admin-user.mjs. Far past brute-force
// feasibility at any request rate, and short enough to paste onto a phone.
const code = randomBytes(16).toString("hex");
const codeHash = createHash("sha256").update(code).digest("hex");

// Prisma would apply @default(cuid()) client-side, which this raw libSQL
// insert doesn't go through. Any opaque unique string satisfies the column,
// and every User row is created by one of these scripts.
const id = randomUUID();

try {
  await client.execute({
    sql: "INSERT INTO User (id, codeHash, createdAt) VALUES (?, ?, ?)",
    args: [id, codeHash, new Date().toISOString()],
  });
} catch (error) {
  // Most likely cause by far: the database is behind the code, or this is
  // pointed at a database that predates accounts entirely.
  console.error(
    `Could not create the account: ${error instanceof Error ? error.message : error}\n` +
      `If this mentions a missing table or column, run 'npm run db:deploy' ` +
      `against the same DATABASE_URL first.`,
  );
  process.exit(1);
}

const total = await client.execute("SELECT count(*) AS n FROM User");

// stdout, once, unstructured. Read the note at the top before changing this.
console.log("");
console.log("  Account created.");
console.log("");
console.log(`  Code:  ${code}`);
console.log("");
console.log("  Send this to them directly, and tell them to keep it:");
console.log("    · it sets the account up the first time they use it");
console.log("    · it is the only way back in if they forget their password");
console.log("");
console.log(`  (user id ${id} — ${total.rows[0].n} account(s) now exist)`);
console.log("");

process.exit(0);
