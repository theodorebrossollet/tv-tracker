// One-off data migration: re-anchors stored episode air dates from midnight
// UTC to midnight US Eastern.
//
// Air dates used to be parsed as midnight UTC, which unlocked episodes for
// marking several hours before the broadcast date had begun anywhere in the
// Americas. `parseAirDate` in src/lib/tmdb.ts now anchors them to
// America/New_York; this brings rows cached under the old rule into line
// without re-fetching everything from TMDB.
//
// Safe to re-run: rows are only touched when their time-of-day is exactly
// 00:00 UTC, which is true of old rows and never true of converted ones (the
// zone is behind UTC, so converted rows sit at 04:00 or 05:00).
//
// Usage:
//   node scripts/backfill-air-dates.mjs
//   DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" node scripts/backfill-air-dates.mjs

import { createClient } from "@libsql/client";

import "dotenv/config";

const ZONE = "America/New_York";

const ZONE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zoneOffsetMs(at) {
  const parts = ZONE_PARTS.formatToParts(at);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);

  return (
    Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour") % 24,
      read("minute"),
      read("second"),
    ) - at.getTime()
  );
}

/** Same logic as parseAirDate in src/lib/tmdb.ts — keep the two in step. */
function midnightEastern(dateOnly) {
  const midnightUtc = new Date(`${dateOnly}T00:00:00.000Z`);
  const firstPass = new Date(midnightUtc.getTime() - zoneOffsetMs(midnightUtc));
  return new Date(midnightUtc.getTime() - zoneOffsetMs(firstPass));
}

const url = process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = createClient({ url, authToken });

const rows = await client.execute(
  "SELECT id, airDate FROM Episode WHERE airDate IS NOT NULL",
);

let converted = 0;
let skipped = 0;

for (const row of rows.rows) {
  const current = new Date(row.airDate);

  if (Number.isNaN(current.getTime())) {
    skipped++;
    continue;
  }

  // Already converted (or otherwise not a bare UTC midnight) — leave it.
  if (
    current.getUTCHours() !== 0 ||
    current.getUTCMinutes() !== 0 ||
    current.getUTCSeconds() !== 0
  ) {
    skipped++;
    continue;
  }

  const dateOnly = current.toISOString().slice(0, 10);

  await client.execute({
    sql: "UPDATE Episode SET airDate = ? WHERE id = ?",
    args: [midnightEastern(dateOnly).toISOString(), row.id],
  });

  converted++;
}

console.log(`Converted ${converted} air date(s); left ${skipped} unchanged.`);
process.exit(0);
