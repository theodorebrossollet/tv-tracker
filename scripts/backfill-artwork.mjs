// One-off data fill: stores TMDB's 16:9 backdrop on every cached show and
// movie that has none yet.
//
// Migration 20261028181917_add_artwork adds `Show.backdropPath`,
// `Movie.backdropPath` and `Episode.stillPath`, and the syncs now write them.
// But both refresh paths key on time, not completeness (AGENTS.md: "Adding a
// column needs a backfill"): rows synced before the column existed stay blank
// until they next age out — a day for tracked shows, longer for movies, which
// nothing re-syncs on a schedule. This fills the backdrops now, one TMDB
// request per row.
//
// Episode stills are left to the next sync of each show (the daily cron for
// tracked ones, the on-view refresh for the rest): they come from the season
// fetches a sync already makes, and repeating that walk here would cost every
// season of every show for a thumbnail.
//
// Safe to re-run: only rows whose backdropPath is NULL are visited. A title
// TMDB has no backdrop for stays NULL and is simply asked again next time.
//
// Run it AFTER the migration (`npm run db:deploy`) against the same database:
//   node scripts/backfill-artwork.mjs
//   DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" TMDB_API_KEY="…" node scripts/backfill-artwork.mjs

import { createClient } from "@libsql/client";

import "dotenv/config";

const TMDB_BASE = "https://api.themoviedb.org/3";
/** Gentle on TMDB: a few requests in flight, never a burst of hundreds. */
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 10_000;

const url = process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const tmdbKey = process.env.TMDB_API_KEY;

if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env or the environment.");
  process.exit(1);
}
if (url.startsWith("libsql://") && !authToken) {
  console.error("DATABASE_URL points at Turso but TURSO_AUTH_TOKEN is not set.");
  process.exit(1);
}
if (!tmdbKey) {
  console.error("TMDB_API_KEY is not set. Add it to .env or the environment.");
  process.exit(1);
}

const client = createClient({ url, authToken });

/**
 * Same key handling as `buildRequest` in src/lib/tmdb.ts: a v4 read access
 * token (a JWT) goes in a header, a v3 key in the query string. The URL is
 * never printed — a v3 key rides in it.
 */
async function tmdb(path) {
  const target = new URL(`${TMDB_BASE}${path}`);
  const headers = { accept: "application/json" };

  if (tmdbKey.split(".").length === 3) {
    headers.Authorization = `Bearer ${tmdbKey}`;
  } else {
    target.searchParams.set("api_key", tmdbKey);
  }

  const response = await fetch(target, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TMDB answered ${response.status}`);
  return response.json();
}

async function fill(table, endpoint) {
  let rows;
  try {
    ({ rows } = await client.execute(
      `SELECT id FROM "${table}" WHERE "backdropPath" IS NULL`,
    ));
  } catch (error) {
    console.error(
      `Could not read ${table}: ${error instanceof Error ? error.message : error}\n` +
        "If this mentions a missing column, run 'npm run db:deploy' against the same DATABASE_URL first.",
    );
    process.exit(1);
  }

  let filled = 0;
  let missing = 0;
  let failed = 0;
  const queue = rows.map((row) => String(row.id));

  async function worker() {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      // Ids are TMDB's numeric ids; anything else is not ours to send.
      if (!/^\d+$/.test(id)) {
        failed++;
        continue;
      }
      try {
        const data = await tmdb(`/${endpoint}/${id}`);
        if (!data.backdrop_path) {
          missing++;
          continue;
        }
        await client.execute({
          sql: `UPDATE "${table}" SET "backdropPath" = ? WHERE id = ? AND "backdropPath" IS NULL`,
          args: [data.backdrop_path, id],
        });
        filled++;
      } catch (error) {
        failed++;
        console.error(
          `  ${table} ${id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(
    `${table}: ${rows.length} without a backdrop · ${filled} filled · ` +
      `${missing} TMDB has none for · ${failed} failed`,
  );
}

await fill("Show", "tv");
await fill("Movie", "movie");
