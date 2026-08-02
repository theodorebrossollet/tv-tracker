// Resets an account's code — the admin-assisted recovery path for someone who
// has lost it (see docs/scope-v2.md, "No account recovery beyond the code").
//
// This does NOT create a new account and does not touch a single tracked
// show, watched episode, or setting: those key off `User.id`, which this
// script never changes. Only `codeHash` moves, so the old code stops working
// the instant this runs, and everything already owned by that `id` — data,
// nickname, password — stays exactly where it was.
//
// The password is deliberately left alone here. It's `loginWithCode` (see
// app/actions.ts) that decides whether signing in with the new code also
// forces a fresh password — same as any other code-based recovery — so a
// visitor who only lost the code and still remembers their password keeps
// working with no extra step forced on them.
//
// There is no self-serve version of this and there won't be one: telling two
// accounts apart without email or any other PII means asking the person their
// nickname, out of band, the same way a code is handed over in the first
// place.
//
// Usage:
//   node scripts/reset-user-code.mjs <nickname>
//   DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" node scripts/reset-user-code.mjs <nickname>

import { createClient } from "@libsql/client";
import { createHash, randomBytes } from "node:crypto";

import "dotenv/config";

const nickname = process.argv[2];

if (!nickname) {
  console.error("Usage: node scripts/reset-user-code.mjs <nickname>");
  process.exit(1);
}

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

// Same normalisation as lib/nickname.ts's nicknameKey — case-insensitive,
// matching what the uniqueness constraint is actually built on.
const nicknameKey = nickname.trim().toLowerCase();

let existing;

try {
  existing = await client.execute({
    sql: "SELECT id FROM User WHERE nicknameKey = ?",
    args: [nicknameKey],
  });
} catch (error) {
  console.error(
    `Could not look up the account: ${error instanceof Error ? error.message : error}\n` +
      `If this mentions a missing table or column, run 'npm run db:deploy' ` +
      `against the same DATABASE_URL first.`,
  );
  process.exit(1);
}

if (existing.rows.length === 0) {
  console.error(
    `No account found with nickname "${nickname}".\n` +
      `An account that never finished onboarding has no nickname yet, so it ` +
      `can't be found this way — check the User table directly ` +
      `(npm run db:studio) if that's the one that needs a new code.`,
  );
  process.exit(1);
}

const { id } = existing.rows[0];

// Same 128-bit format as create-user.mjs.
const code = randomBytes(16).toString("hex");
const codeHash = createHash("sha256").update(code).digest("hex");

await client.execute({
  sql: "UPDATE User SET codeHash = ? WHERE id = ?",
  args: [codeHash, id],
});

// stdout, once, unstructured — same reasoning as the other account scripts:
// this is a credential and lib/logger.ts's structured lines are retained and
// shipped somewhere.
console.log("");
console.log(`  Code reset for "${nickname}".`);
console.log("");
console.log(`  New code:  ${code}`);
console.log("");
console.log("  The old code no longer works. Tracked shows, watch history, and");
console.log("  settings are untouched — this only replaces the code.");
console.log("  Send it the same way as the first one, and tell them to keep it.");
console.log("");

process.exit(0);
