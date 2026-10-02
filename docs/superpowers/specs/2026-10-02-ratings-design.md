# Ratings — design

Sub-project 2 of the movie roadmap in `2026-10-01-movies-core-design.md`.

## Why

The owner wants to rate what they watch: movies, and shows episode by episode,
with season and show ratings that follow from the episodes. Ratings will later
feed recommendations. Rating must be quick and optional, and must never
interrupt marking things watched.

## Decisions

- Whole-number ratings from 1 to 10 (matches TMDB's own scale). One rating per
  movie and one per watched episode.
- Season and show ratings are derived and never stored:
  - season rating = mean of its rated episodes;
  - show rating = mean of its season ratings, leaving out seasons with no rated
    episode (each season counts equally).
- Only watched things can be rated. A rating lives on the existing record
  (`TrackedMovie`, `WatchedEpisode`), so un-watching clears it: a movie leaving
  `watched` has its rating cleared in the same update; un-marking an episode or
  a season deletes the record and the rating with it.
- Rating is optional and never prompts:
  - Episodes: rate from the episode row; "Mark all watched" never asks.
  - Movies: after "Mark watched" the page re-renders in the watched state and the
    rating strip appears inline (no pop-up); it can be ignored.
- Control: a row of ten numbered steps; the chosen one is filled; tapping the
  chosen step again clears the rating.
- Display: your own rating as a whole number ("★ 8"); averages always to one
  decimal ("★ 7.4", "★ 8.0"). Whenever fewer than all watched episodes are
  rated, say so ("6 of 20 watched episodes rated").
- Ratings also show on Library and list rows (small "★", only when rated). No
  sorting or filtering by rating yet.
- The Library/list show averages are computed in SQL, the show page's in
  TypeScript; one rule, two implementations, held together by a parity test (the
  same pattern as the derived "finished" rule in AGENTS.md).

## Roadmap after this

Rewatch tracking (runs for shows and movies, history kept; rating a rewatch is
part of that design), then recommendations and pick-for-tonight, then streaming
availability and release tracking.

## Scope

In: the two columns, the rules module, `rateMovie` and `rateEpisode`, the rating
strip, ratings and averages on the movie page, episode rows, season and show
headers, Library and list rows.

Out: sorting/filtering by rating, ratings in search results, ratings on
unwatched things, rating history, rewatch, recommendations.

## Data

One additive migration: two `ALTER TABLE ... ADD COLUMN` statements. No existing
column changes; the old code ignores the columns. The owner applies it by hand
after a backup and before the merge. The generated SQL must be read to confirm
there is no table rebuild.

- `TrackedMovie.rating Int?`
- `WatchedEpisode.rating Int?`

Null means unrated. SQLite cannot check the range, so the actions enforce 1–10
and a test pins it. No backfill is needed. "Clear all my data" already deletes
both tables' rows.

## Rules (`src/lib/ratings.ts`, pure and client-safe)

- `isRating(value)`: a whole number from 1 to 10.
- Season average: mean of the rated episodes' ratings, or none if there are none.
- Show average: mean of the season averages that exist, or none if none exist.
- Formatting: own ratings as a whole number; averages with one decimal, always.
- Coverage text: "N of M watched episodes rated" (show) / "N of M rated"
  (season), where M is the watched episodes in scope and N those with a rating.
  Shown only when 1 <= N < M; with N = 0 there is no rating to qualify, and with
  N = M the number needs no caveat.

## Screens

**Rating strip.** Ten numbered, generously sized buttons ("Rate 7 out of 10"),
the current one pressed. Derives from the server rating via `useOptimistic`;
any error message is held in `useState` so it persists after the action settles.

**Movie page.** A watched movie always shows "Your rating" with the strip; a
movie that is not watched shows none.

**Episode rows.** A watched episode shows "★ 8" when rated or a quiet "Rate"
affordance when not; tapping opens the strip inline under the row. Unwatched
episodes show nothing.

**Show page.** A season's header shows its average with its coverage once at
least one episode in it is rated; the show header shows the show average with
its coverage.

**Library and list rows.** A small "★ 8" for a rated movie, "★ 7.4" for a show
with at least one rated episode, in the row's detail line; nothing when unrated.

## Server side

Writes in a new `src/app/rating-actions.ts`, governed by the rules in
`actions.ts`'s header (gate above each `try`, every argument validated, every
Prisma call scoped by user); AGENTS.md gets a line for it.

- `rateMovie(movieId, rating)`: `rating` is `1..10` or `null` (clear). Validates
  the id (`isTmdbMovieId`) and rating; finds the caller's `TrackedMovie`; refuses
  unless its status is `watched`; never creates a record.
- `rateEpisode(episodeId, rating)`: the same against the caller's
  `WatchedEpisode`; the episode id is an opaque TMDB id, so it is validated by
  type and length (non-empty string, at most 64 characters), not as digits;
  refuses an episode that is not watched; never creates one.
- `setMovieStatus` writes `rating: null` on any move away from `watched`, in the
  same update.

Reads in `queries.ts`, all filtered by `userId`:
- `getShowDetail`: per-episode `rating`; per-season average with rated and
  watched counts; the show average and the show-level `ratedCount` and
  `watchedEpisodeCount` (TypeScript, using `ratings.ts`; the page passes them to
  the coverage text).
- `getTrackedShows` summaries gain `ratingAverage`, computed in SQL for all the
  account's tracked shows (mean of per-season means) in one extra query
  (`loadShowRatings`).
- `getMovieBuckets`, `getMovieDetail` and `getListDetail` items carry `rating`
  (a movie's own rating, a show's SQL average).

## Testing

Real database, session gate and TMDB stubbed, as before.
- Rules: `isRating` boundaries (0, 1, 10, 11, 5.5, "7", NaN, null); season and
  show averages from a table (a season with nothing rated left out, nothing
  rated, one rated episode); formatting.
- Schema: columns exist, default null.
- Actions: happy paths; refusals (unwatched episode, non-watched movie,
  out-of-range / non-integer / non-number ratings, another account's ids);
  `null` clears; `setMovieStatus` clears the rating when leaving `watched` and
  does not touch it otherwise; un-marking an episode or a season removes its
  rating; isolation per action.
- Queries: season/show averages and coverage; parity between the SQL and
  TypeScript averages across a table of cases; Library show rows, movie rows and
  list rows; isolation (another account's ratings never reach your averages,
  with the SQL filter shown to matter by removing it).
- Screens: strip (ten named buttons, pressed state, tapping the chosen one sends
  `null`, error persists after settle, optimistic revert); movie page strip only
  when watched; episode row chip, "Rate" and the inline expand; season and show
  headers; Library and list rows ("★" only when rated, formats).
- Existing guards (route gates, client boundary) keep running.

## Risks

- The SQL and TypeScript averages drifting apart; mitigated by the parity test.
- Show and episode rows are shared between accounts: every rating read must
  filter by the caller or one account's ratings reach another's averages
  (AGENTS.md: a relation that is a list is always truthy).
- Not checked on a real phone before release (the owner has a large-screen
  iPhone); the strip and headers need a look on the preview deploy.
