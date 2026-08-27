// Read-only diagnostic: prints the rows behind one show's progress.
//
// Written for a state the app should not be able to render — a show whose
// header and season strip agreed five aired episodes were unwatched while the
// up-next card said the season was complete. Those two answers come from one
// predicate over one array, so no database state produces them; reading the
// actual rows is the only way past that.
//
// Reports per season: how many rows exist, how many have aired, how many are
// watched, and whether anything is duplicated — then names the aired-unwatched
// episodes, which are exactly what the Next-up queue is built from.
//
// Touches nothing. Safe against production.
//
// Usage:
//   node scripts/inspect-show.mjs <showId> [nickname]
//   DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" node scripts/inspect-show.mjs 202411

import { createClient } from "@libsql/client";

import "dotenv/config";

const [showId, nickname] = process.argv.slice(2);

if (!showId) {
  console.error("Usage: node scripts/inspect-show.mjs <showId> [nickname]");
  process.exit(1);
}

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const one = async (sql, args = []) => (await client.execute({ sql, args })).rows;

const show = (await one(`SELECT id, name, status, lastSynced FROM Show WHERE id = ?`, [showId]))[0];

if (!show) {
  console.error(`No Show row with id ${showId}.`);
  process.exit(1);
}

// Whose watch marks to read. Per-user by construction: a watch row belongs to
// one account, so "unwatched" is meaningless without naming one.
const users = await one(
  nickname
    ? `SELECT id, nickname FROM User WHERE nicknameKey = ?`
    : `SELECT id, nickname FROM User`,
  nickname ? [nickname.toLowerCase()] : [],
);

console.log(`\n${show.name}  (id ${show.id}, TMDB status ${show.status ?? "null"})`);
console.log(`last synced ${show.lastSynced}`);

const episodes = await one(
  `SELECT id, seasonNumber, episodeNumber, name, airDate
     FROM Episode WHERE showId = ?
    ORDER BY seasonNumber, episodeNumber`,
  [showId],
);

console.log(`\n${episodes.length} episode rows`);

// A re-sync that changed episode ids would leave two rows for one episode —
// which inflates the aired count while only one of them carries the watch mark.
const seen = new Map();
for (const episode of episodes) {
  const key = `${episode.seasonNumber}x${episode.episodeNumber}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
}
const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
console.log(
  duplicates.length > 0
    ? `DUPLICATE episode rows: ${duplicates.map(([k, n]) => `${k}×${n}`).join(", ")}`
    : "no duplicate season/episode numbers",
);

const now = Date.now();
// Matches `isAired` in lib/queries.ts: a null air date is not aired.
const aired = (episode) =>
  episode.airDate !== null && Date.parse(episode.airDate) <= now;

for (const user of users) {
  const watched = new Set(
    (
      await one(
        `SELECT w.episodeId FROM WatchedEpisode w
           JOIN Episode e ON e.id = w.episodeId
          WHERE w.userId = ? AND e.showId = ?`,
        [user.id, showId],
      )
    ).map((row) => row.episodeId),
  );

  // Watch marks whose episode row no longer exists: the other way a re-sync
  // loses progress, and invisible from inside the app.
  const orphans = (
    await one(
      `SELECT COUNT(*) AS n FROM WatchedEpisode w
        WHERE w.userId = ? AND w.episodeId NOT IN (SELECT id FROM Episode)`,
      [user.id],
    )
  )[0].n;

  console.log(`\n--- ${user.nickname} (${user.id}) ---`);
  if (orphans > 0) console.log(`${orphans} watch marks point at episodes that no longer exist`);

  const seasons = new Map();
  for (const episode of episodes) {
    const bucket = seasons.get(episode.seasonNumber) ?? [];
    bucket.push(episode);
    seasons.set(episode.seasonNumber, bucket);
  }

  let totalAired = 0;
  let totalWatched = 0;
  const queue = [];

  for (const [seasonNumber, rows] of [...seasons.entries()].sort(([a], [b]) => a - b)) {
    const airedRows = rows.filter(aired);
    const watchedRows = airedRows.filter((episode) => watched.has(episode.id));

    totalAired += airedRows.length;
    totalWatched += watchedRows.length;
    queue.push(...airedRows.filter((episode) => !watched.has(episode.id)));

    console.log(
      `  S${seasonNumber}  rows=${rows.length}  aired=${airedRows.length}` +
        `  watched=${watchedRows.length}  pill=${airedRows.length - watchedRows.length}`,
    );
  }

  const percent = totalAired > 0 ? Math.round((totalWatched / totalAired) * 100) : 0;
  console.log(`  TOTAL aired=${totalAired} watched=${totalWatched} → header ${percent}%`);
  console.log(`  next-up queue: ${queue.length} episode(s)`);
  for (const episode of queue.slice(0, 10)) {
    console.log(
      `    S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")}` +
        `  ${episode.airDate}  ${episode.name ?? "(untitled)"}`,
    );
  }

  // The contradiction, restated as an assertion: the pill total and the queue
  // are the same set counted two ways.
  if (queue.length !== totalAired - totalWatched) {
    console.log(`  MISMATCH: queue ${queue.length} vs pills ${totalAired - totalWatched}`);
  }
}

console.log();
