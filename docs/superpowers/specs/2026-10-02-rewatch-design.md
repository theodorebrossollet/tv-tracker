# Rewatch — design

Follows the ratings spec (`2026-10-02-ratings-design.md`) in the movie roadmap.

## Why

A finished show or movie can be the thing you want to watch again, for example
with family from a list. Today progress is the set of episodes marked watched,
each markable once, and a movie has one status, so the first pass uses up every
mark and a rewatch cannot be tracked without erasing the first watch.

## Decisions

- Shows get real runs: starting over begins a fresh run with episode-by-episode
  progress, Up Next and ratings, and the old run is kept as a read-only past
  run.
- A show can be started over at any time it has watched episodes (finished,
  caught up, paused, stopped or in progress), with a confirmation. The current
  run, partial or complete, is archived; nothing is lost. A past run cannot be
  un-archived in this version.
- Ratings follow the current run. After starting over, episode ratings and the
  show average start empty, so the "★" disappears from the Library row until
  the new run is rated. The past run keeps its own ratings.
- Movies use the same model: "Watch again" on a watched movie archives the
  current watch (date and rating) as a past watch and begins a new one: watched
  today, rating cleared, status stays `watched`.
- Storage is archive-on-restart. `WatchedEpisode` keeps meaning the current run
  and `TrackedMovie` the current watch, so every existing progress, Up Next,
  finished/caught-up, ratings, Library and list rule is unchanged. The history
  lives in new tables.
- Starting over makes a show unfinished, so on a personal list it moves back to
  the to-watch section; the Library shows it in Watching at zero progress.

## Scope

In: the three history tables, `startShowOver` and `watchMovieAgain`, the "Start
over" and "Watch again" controls with confirmations, a run label, and read-only
"Past runs" and "Past watches" sections.

Out: un-archiving or deleting a past run, episode-level detail of a past run,
backdating a rewatch, a rewatch log without episode tracking, combining
ratings across runs, sorting or filtering by run.

## Data

One additive migration, three `CREATE TABLE` statements. No existing table
changes, so there is no table rebuild and no risk to existing watch history.
The owner applies it by hand after a backup and before the merge.

`ShowRun`
- `id` (cuid), `userId`, `showId`, `runNumber`, `archivedAt`
- `@@unique([userId, showId, runNumber])`; cascade from `User` and `Show`

`ArchivedEpisodeWatch`
- `id` (cuid), `runId`, `episodeId`, `watchedAt`, `rating Int?` (as it was)
- cascade from `ShowRun` and `Episode`; `@@index([runId])`

`PastMovieWatch`
- `id` (cuid), `userId`, `movieId`, `watchedAt`, `rating Int?`, `archivedAt`
- cascade from `User` and `Movie`; `@@index([userId, movieId])`

The current run number shown to the user is the number of past runs plus one.
Limits: at most 20 past runs per show and 20 past watches per movie.

"Clear all my data" also deletes the account's runs and past watches (inside its
existing transaction, scoped to the account).

## Server side

Writes in a new `src/app/rewatch-actions.ts`, governed by the rules in
`actions.ts`'s header (gate above each `try`, every argument validated, every
Prisma call scoped by user); AGENTS.md gets a line for it. Both actions run
their database work in one transaction and are atomic.

- `startShowOver(showId)`:
  - validates the id; refuses an untracked show, a show with no watched
    episodes ("Nothing to start over."), and one already at 20 past runs;
  - creates the `ShowRun` (number = highest existing + 1; the insert is
    conditional in SQL and guards the statements after it, so a concurrent
    double submit cannot create an empty run), copies the caller's
    `WatchedEpisode` rows for that show into `ArchivedEpisodeWatch` (episode,
    date, rating), deletes those `WatchedEpisode` rows, and sets the show's
    tracked status to `watching`.
- `watchMovieAgain(movieId)`:
  - validates the id; refuses a movie that is not `watched` or not the caller's,
    and one already at 20 past watches;
  - creates a `PastMovieWatch` from the current date and rating (a conditional
    insert in SQL that guards the update, for the same reason), then sets
    `watchedAt` to now and `rating` to null; status stays `watched`.

Reads in `queries.ts`, all filtered by `userId`:
- `getShowDetail` gains `runNumber` and `pastRuns` (run number, first and last
  watch, episode count, rating average). The average uses the same
  season-then-show rule as the current run, computed in TypeScript with
  `ratings.ts` over the archived rows joined to their episodes' seasons.
- `getMovieDetail` gains `pastWatches` (date, rating), newest first.
- These two reads fail softly when the new tables are missing (logged; the
  sections are hidden) so an unapplied migration cannot take down every title
  page. The Library, lists and dashboard read only current data and are
  unchanged.

## Screens

**Start over (show page).** The status menu (the pill in the header) gets a
"Start over" row, shown only when the show has watched episodes. It opens a
confirmation step inside the sheet: current progress is kept as Run N (as "a
past run" when the history is unavailable), the show goes back to the start, and
it cannot be undone in this version. Cancel and "Start over". `startOver` is
passed to both status pills (header and the one below it). After success the
page re-renders at zero progress with S1E1 next up. Once a show has past runs the header shows a quiet "Run N" by the progress.

**Past runs (show page).** A "Past runs" section under the episode list, only
when there are past runs. One read-only line per run, for example "Run 1 ·
3 Mar 2026 – 19 Apr 2026 · 20 episodes · ★ 8.1"; dates are the first and last
watch in that run, formatted in US Eastern like other watch dates; the "★" is left out when
the run had no ratings.

**Watch again (movie page).** A watched movie gets a "Watch again" button by the
rating section, with a confirmation (sheet title "Log a new watch?", the rest in the
paragraph): the previous watch and its rating are kept
in Past watches, and the movie shows as watched today with no rating. A "Past
watches" section lists archived watches newest first ("3 Mar 2026 · ★ 8"), only
when there are any.

## Testing

Real database, session gate and TMDB stubbed, as before.
- Schema: the three tables, cascades (account, show, movie, run, episode), run
  number uniqueness.
- `startShowOver`: archives exactly the caller's watched episodes with their
  dates and ratings and deletes only those (another account watching the same
  show is untouched); run numbers 1 then 2; status becomes `watching` from each
  starting state (watching, watchlist, paused, stopped, finished); refusals
  (untracked, nothing watched, foreign or malformed id, the 20-run limit);
  atomicity (a forced failure partway leaves the watched episodes exactly as
  they were); a second call right after the first is refused.
- `watchMovieAgain`: archives date and rating, sets the date to now, clears the
  rating, keeps status `watched`; refusals (not watched, untracked, foreign, the
  limit); atomic.
- Reads: `runNumber` and `pastRuns` including each run's rating average (equal to
  the season-then-show rule over archived rows); `pastWatches`; another
  account's runs never appear; the soft failure when the tables are missing.
- Regression: after a restart the show is in the Watching bucket at zero progress
  with no "★"; on a personal list it is back in to-watch.
- Screens: the "Start over" row only with watched episodes; the confirmation
  (cancel does nothing, confirm calls the action, an error stays visible after
  the action settles); the movie confirmation; "Past runs" and "Past watches"
  sections; no "NaN" or "undefined".
- "Clear all my data" removes only the caller's runs and past watches.
- Existing guards (route gates, client boundary) keep running.

## Risks

- A partial failure between archiving and clearing would lose or duplicate
  watch history; mitigated by a single transaction and an atomicity test.
- Every query that reads `WatchedEpisode` must keep meaning "current run";
  nothing may read the archive tables for progress or ratings of the current
  run.
- If the migration is unapplied when this deploys, the title pages' history
  reads fail softly, but the two actions and "Clear all my data" (which now
  deletes the new tables inside its transaction) fail until it is applied.
- Not checked on a real phone before release; the confirmation sheets and the
  new sections need a look on the preview deploy.
