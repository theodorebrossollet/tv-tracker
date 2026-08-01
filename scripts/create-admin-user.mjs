// One-off: creates the first account, for the data that already exists.
//
// v1 had one implicit user. This gives that user a row to point at, so
// scripts/backfill-user-ownership.mjs can establish ownership of the tracked
// shows and watch history already in the database. Run it once, after the
// Phase A migration and before the backfill — see docs/technical-design-v2.md
// section 3.
//
// The code is printed to stdout exactly once and stored only as a SHA-256
// hash. It is deliberately never passed to lib/logger.ts: log lines are
// structured, retained, and shipped somewhere, and this is the single
// credential for an account with no recovery path. If you lose it, the account
// is gone — there is no reset flow to fall back on.
//
// Usage:
//   node scripts/create-admin-user.mjs
//   DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" node scripts/create-admin-user.mjs
//
// New accounts for other people come from scripts/create-user.mjs, which does
// the same thing without the "must be the first user" guard.

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

// Refusing here rather than creating a second account is the whole point of
// this script existing separately from create-user.mjs. A second run would
// mint a fresh code while the first user still owns every backfilled row —
// leaving two accounts, one of them holding all the data and neither obviously
// the right one. That is a confusing thing to discover in production, by hand,
// from a code that was printed once and scrolled away.
const existing = await client.execute("SELECT id FROM User LIMIT 1");

if (existing.rows.length > 0) {
  console.error(
    "A user already exists — refusing to create another.\n" +
      "This script is only for bootstrapping the first account. Use " +
      "scripts/create-user.mjs to add more.",
  );
  process.exit(1);
}

// 16 bytes / 128 bits. Shorter than APP_PASSWORD's 32 on purpose: 128 bits is
// already far past brute-force feasibility at any request rate, and every extra
// character is one more to copy across to a phone.
const code = randomBytes(16).toString("hex");
const codeHash = createHash("sha256").update(code).digest("hex");

// Prisma would apply @default(cuid()) client-side, which this raw libSQL insert
// doesn't go through. Any opaque unique string satisfies the column, and every
// User row is created by one of these scripts, so the format stays consistent.
const id = randomUUID();

await client.execute({
  sql: "INSERT INTO User (id, codeHash, createdAt) VALUES (?, ?, ?)",
  args: [id, codeHash, new Date().toISOString()],
});

// stdout, once, unstructured. Read the note at the top before changing this.
console.log("");
console.log("  Account created.");
console.log("");
console.log(`  Code:  ${code}`);
console.log("");
console.log("  This is shown once and cannot be recovered. Save it now.");
console.log("  Nickname is chosen at first login, not here.");
console.log("");
console.log(`  (user id ${id})`);
console.log("");

process.exit(0);
