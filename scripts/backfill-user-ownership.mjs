// One-off data migration: gives every ownerless row an owner.
//
// The Phase A migration adds a nullable `userId` to TrackedShow,
// WatchedEpisode and Settings. Rows written under v1 have it empty. This fills
// them in with the single existing account, so Phase B can make the column NOT
// NULL without rejecting anything.
//
// This is the sharper version of the "adding a column needs a backfill" rule in
// AGENTS.md: it isn't blank fields rendering as blanks, it's establishing who
// owns data that already exists.
//
// Safe to re-run, and worth re-running immediately before Phase B. The v1 build
// stays live between the two phases and writes rows with no owner, so a gap of
// days means new orphans by the time NOT NULL lands. Every statement here is
// scoped to `WHERE userId IS NULL`, so a second run touches only what the first
// one couldn't have seen and never reassigns a row that already has an owner.
//
// Usage:
//   node scripts/backfill-user-ownership.mjs
//   DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" node scripts/backfill-user-ownership.mjs

import { createClient } from "@libsql/client";

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

const users = await client.execute("SELECT id FROM User ORDER BY createdAt");

if (users.rows.length === 0) {
  console.error(
    "No users exist yet. Run scripts/create-admin-user.mjs first — this " +
      "script assigns existing rows to that account.",
  );
  process.exit(1);
}

// Guessing would be worse than stopping. Once a second account exists, "which
// user owns the v1 data" is a question this script has no way to answer, and
// picking the oldest would quietly hand one person's library to someone else.
if (users.rows.length > 1) {
  console.error(
    `Found ${users.rows.length} users — refusing to guess which one owns the ` +
      `pre-accounts data.\nThis backfill is only meaningful while exactly one ` +
      `account exists. If rows are genuinely ownerless after that point, ` +
      `assign them by hand.`,
  );
  process.exit(1);
}

const userId = String(users.rows[0].id);

// Settings is included even though it holds a single row: Phase B rebuilds the
// table around `userId` as its primary key, and a NULL there would be dropped
// rather than migrated.
const TABLES = ["TrackedShow", "WatchedEpisode", "Settings"];

const results = [];

for (const table of TABLES) {
  const result = await client.execute({
    sql: `UPDATE "${table}" SET userId = ? WHERE userId IS NULL`,
    args: [userId],
  });

  results.push({ table, updated: Number(result.rowsAffected) });
}

console.log(`Assigned ownerless rows to user ${userId}:`);
for (const { table, updated } of results) {
  console.log(`  ${String(updated).padStart(6)}  ${table}`);
}

const total = results.reduce((sum, { updated }) => sum + updated, 0);
if (total === 0) {
  console.log("\nNothing to do — every row already has an owner.");
}

process.exit(0);
