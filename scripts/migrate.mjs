// Applies Prisma's generated migration SQL to whatever DATABASE_URL points at.
//
// Why this exists: `prisma migrate deploy` only understands local SQLite file
// paths — it rejects `libsql://` URLs outright ("P1013: the scheme is not
// recognized"). So the Prisma CLI can create migrations locally, but it cannot
// apply them to Turso. This script does that last step over the libSQL client.
//
// Usage:
//   node scripts/migrate.mjs          # uses DATABASE_URL from the environment
//
// Local development doesn't need this — `npx prisma migrate dev` handles the
// local dev.db file as usual. Run this when pointing at Turso.

import { createClient } from "@libsql/client";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import "dotenv/config";

const MIGRATIONS_DIR = "prisma/migrations";

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

// Our own tracking table, deliberately not Prisma's `_prisma_migrations`:
// Prisma owns that one and expects its exact schema (checksums, rollback
// state). Writing to it by hand risks confusing the Prisma CLI later.
await client.execute(`
  CREATE TABLE IF NOT EXISTS _applied_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`);

const appliedRows = await client.execute("SELECT name FROM _applied_migrations");
const applied = new Set(appliedRows.rows.map((row) => String(row.name)));

// Prisma names migration folders with a timestamp prefix, so a lexical sort is
// also chronological order.
const available = readdirSync(MIGRATIONS_DIR)
  .filter((entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
  .sort();

const pending = available.filter((name) => !applied.has(name));

if (pending.length === 0) {
  console.log(`No pending migrations (${applied.size} already applied).`);
  process.exit(0);
}

for (const name of pending) {
  const sql = readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

  process.stdout.write(`Applying ${name}… `);

  // executeMultiple runs the whole file as a script, so multi-statement
  // migrations work without splitting on semicolons by hand.
  await client.executeMultiple(sql);

  await client.execute({
    sql: "INSERT INTO _applied_migrations (name, applied_at) VALUES (?, ?)",
    args: [name, new Date().toISOString()],
  });

  console.log("done");
}

console.log(`Applied ${pending.length} migration(s).`);
process.exit(0);
