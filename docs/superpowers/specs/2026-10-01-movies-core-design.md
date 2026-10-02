# Movies core — design

Sub-project 1 of 5 for tracking movies in tv-tracker.

## Why

The owner keeps a "want to watch" list of movies in Letterboxd and finds it
poor: cluttered UI, ads, features pushed forward that they don't use, and
their own lists buried in the profile. The goal is to move that job into
tv-tracker so that Letterboxd is no longer opened to decide what to watch.
Same stack, TMDB as the data source, same per-account model.

## Roadmap (context, not part of this spec)

Each item gets its own spec, plan and PR.

1. **Movies core** (this spec).
2. **Ratings.** Whole-number 1–10 rating per movie and per watched episode.
   Season and show ratings are derived averages and are never stored.
   Episode ratings live as a nullable column on `WatchedEpisode`, so only a
   watched episode can be rated.
3. **Lists.** Private named lists holding movies and shows, each item with its
   own watched/unwatched state, with a first-class "Lists" entry in navigation.
4. **Recommendations and pick-for-tonight.** TMDB `/recommendations` merged and
   ranked by how many highly rated titles point at each candidate, minus what is
   already watched or listed; filters by runtime, genre and mood. Movies and
   shows.
5. **Streaming availability and release tracking.** Watch providers per country
   for movies, and unreleased films surfaced when they come out.

Order: 1, 3, 2, 4, 5. A Letterboxd import was considered and rejected.

## Scope of this spec

In: `Movie` and `TrackedMovie` tables, mixed search, a Shows/Movies switch in
the Library screen, a movie detail page, the server actions behind them.

Out: ratings, lists, streaming availability, trailers, recommendations, release
date refresh, a remembered Shows/Movies choice.

## Data

New migration with two new tables. No existing table changes, so it can be
applied before the deploy with the usual backup then `db:deploy` steps.

`Movie`
- `id` — TMDB movie id as a string (own table, so no clash with show ids)
- `title`, `posterPath?`, `overview?`
- `releaseDate?`, `runtime?` (minutes), `genres?` (comma-separated, as on `Show`)
- `status?` — TMDB release status
- `lastSynced`
- `addedById?`, `createdAt?` — feeds the per-account hourly movie allowance

`TrackedMovie`
- `id` (cuid), `movieId`, `userId`
- `status` — `watchlist` | `watched` | `not_interested`
- `addedAt`, `watchedAt?`
- `@@unique([userId, movieId])`, `@@index([movieId])`
- Cascade deletes from both `Movie` and `User`, as on `TrackedShow`

The cron is unchanged: movies have no episodes to sync.

New-title cap: caching a new movie counts against its own allowance of 60 per
hour per account, separate from the 20 per hour for new shows. A movie is one
cheap request, and entering a backlog by hand must not hit the show limit.

## Status rules

Kept in a pure module beside `status-transitions.ts`, so they test without
React.

- From none: add as `watchlist`, or log straight as `watched` (a film already seen).
- From `watchlist`: `watched` or `not_interested`.
- From `watched`: `watchlist` or `not_interested`.
- From `not_interested`: `watchlist` or `watched`.
- Any state: remove.
- Moving to `watched` sets `watchedAt` to now; moving away clears it.
- Rewatching is not modelled. No rewatch history.

## Screens

**Search.** The overlay uses TMDB `/search/multi`, drops `person` results, and
labels each result "Movie" or "TV". A result opens `/show/[id]` or
`/movie/[id]`. Adding a movie from the overlay puts it on the watchlist.

**Library switch.** A Shows/Movies control sits under the "Library" heading,
above the Watchlist/Archive segments. The choice is the `type` query param
(`/watchlist?type=movies`), consistent with segments being routes. No param
means shows, so existing links are unchanged, and the choice is not remembered.
- Movies / Watchlist: movies with status `watchlist`, using the existing grid
  and list components.
- Movies / Archive: "Watched" (most recent `watchedAt` first) and
  "Not interested".
- Shows view unchanged. Watching and Up Next stay shows-only.

**Movie page `/movie/[id]`.** Poster, title, year, runtime, genres, synopsis.
Actions by state: untracked offers "Add to watchlist" and "Mark watched"; on the watchlist, "Mark watched". A status
sheet offers the remaining transitions and "Remove".

## Server side

- `tmdb.ts`: movie multi-search and `getMovieDetails`, mapped the way show
  details are.
- Server actions beside the show actions: add to watchlist, set status (which
  also covers mark watched, including from an unadded movie), remove. Same session gate; adding an uncached movie counts against the
  movie allowance (60/hour, separate from shows' 20). Mark watched is
  `setMovieStatus(id, "watched")`.
- `queries.ts`: movie buckets for a user (watchlist, watched, not interested).

## Testing

- Unit tests for the status rules.
- Mapping tests for the TMDB movie and multi-search responses.
- `tests/route-gates.test.ts` extended so `/movie/[id]` is covered.
- Existing show tests must pass unchanged.

## Risks

- Multi-search changes what the overlay returns for everyone; the Show path
  must keep behaving exactly as before (covered by existing tests).
- TMDB movie and TV ids overlap numerically. Separate tables and separate
  routes keep them apart; any code taking an id must know which kind it has.
