// Dumps whatever DATABASE_URL points at to a portable .sql file.
//
// Why this exists: the Turso CLI's `.dump` does the same job, but it means
// installing and authenticating a second tool to protect the data this repo
// already holds credentials for. This script reuses the libSQL client and the
// DATABASE_URL / TURSO_AUTH_TOKEN that `scripts/migrate.mjs` already needs, so
// taking a backup is one command with nothing else set up.
//
// Run this before any migration that rewrites a table holding real data.
// `migrate.mjs` applies migration files with `executeMultiple`, which is not
// transactional: a file that fails halfway leaves the statements before the
// failure applied and cannot be repaired automatically. Show/Episode rows can
// be re-fetched from TMDB after such a failure. Watch history cannot — it
// exists nowhere else.
//
// Usage:
//   npm run db:backup                                  # uses DATABASE_URL from .env
//   DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" npm run db:backup
//   npm run db:backup -- ./my-backup.sql               # explicit output path
//
// Restore (destructive — it drops each table before recreating it):
//   turso db shell <database-name> < backup-….sql
//   sqlite3 dev.db < backup-….sql                      # for a local file

import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";

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

const outPath =
  process.argv[2] ??
  `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;

const client = createClient({ url, authToken });

/**
 * Renders one value as SQL. The escaping here is the whole correctness story of
 * this script: a mis-escaped quote in a show synopsis produces a file that
 * looks fine and fails to restore, which is the worst possible outcome for a
 * backup. Blobs go out as hex literals rather than being coerced to strings.
 */
function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "bigint") return String(value);
  if (typeof value === "number") {
    // NaN/Infinity have no SQL literal. Storing NULL loses less than emitting
    // something the restore would reject outright.
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `X'${Buffer.from(value).toString("hex")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

const quoteId = (name) => `"${name.replace(/"/g, '""')}"`;

const lines = [
  `-- tv-tracker backup`,
  `-- taken ${new Date().toISOString()}`,
  `-- source ${url.replace(/\?.*$/, "")}`,
  ``,
  // Rows are written in whatever order the tables come out, so referential
  // checks have to be off until every table is populated. The transaction makes
  // a partial restore impossible: it either all lands or none of it does.
  `PRAGMA foreign_keys=OFF;`,
  `BEGIN TRANSACTION;`,
  ``,
];

// `sqlite_%` covers the engine's own bookkeeping (sqlite_sequence and friends),
// which is rebuilt on restore and errors if you try to recreate it by hand.
const tables = await client.execute(
  `SELECT name, sql FROM sqlite_master
   WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
   ORDER BY name`,
);

if (tables.rows.length === 0) {
  console.error(`No tables found at ${url}. Refusing to write an empty backup.`);
  process.exit(1);
}

const counts = [];

for (const table of tables.rows) {
  const name = String(table.name);

  lines.push(`DROP TABLE IF EXISTS ${quoteId(name)};`);
  lines.push(`${table.sql};`);

  const rows = await client.execute(`SELECT * FROM ${quoteId(name)}`);
  const columns = rows.columns.map(quoteId).join(", ");

  for (const row of rows.rows) {
    const values = rows.columns.map((column) => literal(row[column])).join(", ");
    lines.push(`INSERT INTO ${quoteId(name)} (${columns}) VALUES (${values});`);
  }

  lines.push(``);
  counts.push({ table: name, rows: rows.rows.length });
}

// Indexes come after the data: building them once at the end is both faster and
// avoids a unique index rejecting a row mid-restore that the source accepted.
const indexes = await client.execute(
  `SELECT sql FROM sqlite_master
   WHERE type = 'index' AND sql IS NOT NULL
   ORDER BY name`,
);

for (const index of indexes.rows) {
  lines.push(`${index.sql};`);
}

lines.push(``, `COMMIT;`, `PRAGMA foreign_keys=ON;`, ``);

writeFileSync(outPath, lines.join("\n"), "utf8");

// Printed so the backup can be eyeballed without opening it. A dump whose
// row counts don't match what the app shows is the signal to stop, not to
// press on with the migration.
console.log(`Wrote ${outPath}`);
for (const { table, rows } of counts) {
  console.log(`  ${String(rows).padStart(6)}  ${table}`);
}

process.exit(0);
