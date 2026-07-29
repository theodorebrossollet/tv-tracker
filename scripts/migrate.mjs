// Applies Prisma's generated migration SQL to whatever DATABASE_URL points at.
//
// Why this exists: `prisma migrate deploy` only understands local SQLite file
// paths — it rejects `libsql://` URLs outright ("P1013: the scheme is not
// recognized"). So the Prisma CLI can create migrations locally, but it cannot
// apply them to Turso. This script does that last step over the libSQL client.
//
// It records applied migrations in Prisma's own `_prisma_migrations` table,
// using the same format the CLI uses (id = UUID, checksum = sha256 of
// migration.sql). That matters: if this script kept its own bookkeeping,
// `prisma migrate dev` would later see a database it doesn't recognise and
// offer to reset it — destroying the data this script exists to preserve.
//
// Usage:
//   npm run db:deploy                 # uses DATABASE_URL from .env
//   DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" npm run db:deploy
//
// Local development doesn't need this — `npx prisma migrate dev` handles the
// local dev.db file as usual.

import { createClient } from "@libsql/client";
import { createHash, randomUUID } from "node:crypto";
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

// Same DDL the Prisma CLI creates, so a database bootstrapped by this script is
// indistinguishable from one bootstrapped by `prisma migrate deploy`.
await client.execute(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  TEXT PRIMARY KEY NOT NULL,
    "checksum"            TEXT NOT NULL,
    "finished_at"         DATETIME,
    "migration_name"      TEXT NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      DATETIME,
    "started_at"          DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  )
`);

const appliedRows = await client.execute(
  "SELECT migration_name, checksum FROM _prisma_migrations WHERE rolled_back_at IS NULL",
);
const applied = new Map(
  appliedRows.rows.map((row) => [String(row.migration_name), String(row.checksum)]),
);

// Prisma names migration folders with a timestamp prefix, so a lexical sort is
// also chronological order.
const available = readdirSync(MIGRATIONS_DIR)
  .filter((entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
  .sort();

const pending = [];

for (const name of available) {
  const sql = readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"));
  const checksum = createHash("sha256").update(sql).digest("hex");
  const previous = applied.get(name);

  if (previous === undefined) {
    pending.push({ name, sql: sql.toString("utf8"), checksum });
    continue;
  }

  // An already-applied migration whose file has since changed means the local
  // history and the database have diverged. Applying anything on top would
  // silently build on a schema that isn't what the files describe.
  if (previous !== checksum) {
    console.error(
      `Migration ${name} was already applied, but its migration.sql has changed since.\n` +
        `Editing an applied migration is not supported — create a new migration instead.`,
    );
    process.exit(1);
  }
}

if (pending.length === 0) {
  console.log(`No pending migrations (${applied.size} already applied).`);
  process.exit(0);
}

for (const { name, sql, checksum } of pending) {
  process.stdout.write(`Applying ${name}… `);

  const startedAt = new Date().toISOString();

  // executeMultiple runs the whole file as a script, so multi-statement
  // migrations work without splitting on semicolons by hand.
  await client.executeMultiple(sql);

  await client.execute({
    sql: `INSERT INTO _prisma_migrations
            (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
          VALUES (?, ?, ?, ?, ?, 1)`,
    args: [randomUUID(), checksum, new Date().toISOString(), name, startedAt],
  });

  console.log("done");
}

console.log(`Applied ${pending.length} migration(s).`);
process.exit(0);
