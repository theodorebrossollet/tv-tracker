# Discover (recommendations and pick for tonight) — design

Sub-project 4 of the movie roadmap in `2026-10-01-movies-core-design.md`.

## Why

Deciding what to watch is the hard part once the to-watch list is long. The
app already knows what the owner rated highly, so it can suggest new titles and
help choose among the ones already on the list. One screen serves both: a deck
of cards, one title at a time, swiped yes or no.

## Decisions

- One deck, one entry point: a sparkle icon in the Watching header, left of the
  existing search icon, opens a full-screen Discover page.
- The deck mixes the owner's to-watch titles with recommendations. Each card is
  tagged "On your watchlist" or "Recommended · because you rated *X* ★9".
- Recommendations come from TMDB's per-title recommendation lists, seeded by the
  owner's highly rated titles. There is no taste profile (genre, cast weights);
  that stays a possible later addition.
- Seeds: tracked titles rated 8 or higher (a show counts by its show average),
  the 10 most recently rated. Fewer than 3 seeds means no recommendations; the
  deck then holds only the owner's own titles and says "Rate a few more titles
  to get recommendations".
- Ranking: a candidate that appears in several seeds' lists ranks higher,
  weighted by the seeds' ratings; TMDB's score breaks ties; candidates with
  fewer than 100 votes are dropped.
- Left out of recommendations: any title the owner tracks in any status, any
  title on one of the owner's lists, and any dismissed suggestion.
- The pool of "own titles": movies and shows whose status is `watchlist`. When
  the owner picks a list, the pool is instead that list's unwatched titles
  whatever their Library status (list items need not be on the watchlist),
  except movies marked not interested and shows stopped for good; the card then
  reads "On this list" instead of "On your watchlist".
- Swipe right: a recommendation is added to the watchlist and the next card
  appears. A card already on the owner's list shows "Tonight: *X*" with an
  "Open" button, so the pick has an actual result.
- Swipe left: a recommendation is hidden permanently (`DismissedSuggestion`);
  one of the owner's own titles is skipped for this visit only and the list is
  not touched. Swiping left never changes a title's real status; the movie
  "not interested" status is not reused.
- ✕ and ✓ buttons under the card do the same as the swipes (accessibility, and
  iOS's edge back-gesture can swallow a swipe).
- The card: the poster fills the card; scrolling down shows overview, cast,
  trailer, runtime and where it streams, using the existing TMDB helpers.
- Filters: chips for Any / Movie / Show, "Under 2h" (movies under 120 minutes
  only; shows are left out while it is on, since a show has no single length),
  and a list picker. They apply to both kinds of card.
- Settings gets a "Hidden suggestions" row: the count and a "Show them again"
  button with an in-sheet confirmation. It deletes only the caller's dismissed
  rows.

## Scope

In: the `DismissedSuggestion` table, the recommendation engine, the deck page,
the swipe logic, the actions, the Settings reset, "Clear all my data" covering
the new table.

Out: a taste profile, notifications, sharing a pick, undoing a swipe (the
Settings reset is the escape hatch), streaming-availability filtering (the next
roadmap item), sorting the deck by anything but the ranking above.

## Data

One additive migration, one `CREATE TABLE`. No existing table changes. The owner
applies it by hand after a backup and before the merge.

`DismissedSuggestion`
- `id` (cuid), `userId`, `kind` (`movie` | `show`), `tmdbId`, `createdAt`
- `@@unique([userId, kind, tmdbId])`, cascade from `User`
- Limit: at most 2000 rows per account.

"Clear all my data" deletes the account's dismissed suggestions inside its
existing transaction.

## Server side

Reads in a new `src/lib/discover.ts`, every query filtered by `userId`:
- `getSeeds(userId)`: tracked titles rated >= 8, newest first, at most 10.
- `getDeck(userId, filters)`: seeds, then recommendations, then the owner's own
  to-watch titles, merged and tagged; never throws on a TMDB failure (the deck
  falls back to own titles and reports `recommendationsUnavailable`).
- TMDB: new `getRecommendations(kind, id)` in `lib/tmdb.ts` through the existing
  `cached()` helper with a 24h TTL and the existing request timeout.

Writes in a new `src/app/discover-actions.ts`, governed by the rules in
`actions.ts`'s header (gate above each `try`, every argument validated, every
Prisma call scoped by user); AGENTS.md gets a line for it:
- `dismissSuggestion(kind, tmdbId)`: validates both, enforces the 2000 limit,
  idempotent on the unique key.
- `resetDismissedSuggestions()`: deletes the caller's rows; returns the count.
- Swipe right on a recommendation reuses `addToWatchlist` /
  `addMovieToWatchlist` (and their new-title allowances).
- A rate limit on deck loads per account bounds TMDB use.

## Screens

**Entry.** Sparkle icon beside the search icon in the Watching header, same size
and shape.

**Deck page.** Full-screen, one card at a time with the next card peeking,
filter chips at the top, ✕ and ✓ under the card. A finished deck says so and
offers a refresh. Loading shows a skeleton card.

**Swipe logic.** Lives in a plain module (`lib/swipe.ts`), apart from the touch
listeners, like `lib/pull-to-refresh.ts`: a threshold decides commit versus
snap-back, and a mostly-vertical drag is scrolling, never a swipe. The
listener half needs a real device.

**Settings.** A "Hidden suggestions" row, count plus "Show them again".

## Testing

Real database, session gate and TMDB stubbed, as before.
- Schema: the table, the unique key, cascade from the account.
- Seeds: threshold boundary (7, 8), shows by average, newest first, the limit
  of 10, another account's ratings never included.
- Ranking: multi-seed beats single-seed, rating weight, the vote floor, tie
  break; exclusions (tracked in every status, on a list, dismissed).
- Deck: fewer than 3 seeds gives own titles only and the note; TMDB failure
  falls back softly; chips (Movie, Show, Under 2h excludes shows, list picker);
  own titles are only `watchlist`.
- Actions: dismiss (validation, idempotent, limit, isolation), reset (only the
  caller's rows), swipe-right add reuses the add actions.
- Swipe logic: threshold, vertical drag is not a swipe, edge cases.
- Screens: cards render with the right tag, buttons act like swipes, "Tonight"
  screen, empty and finished states, Settings row with confirmation, no "NaN"
  or "undefined".
- "Clear all my data" removes only the caller's dismissed rows.
- Existing guards (route gates, client boundary) keep running.

## Risks

- TMDB cost: up to 10 recommendation calls per cold deck. Mitigated by the 24h
  cache, parallel calls with the request timeout, and the per-account limit.
  The cache is per server instance, so it helps less on short-lived instances.
- The swipe listeners have no automated coverage; the owner checks them on a
  phone, and the buttons are the fallback.
- Recommendations quality depends on how many titles are rated 8 or higher; with
  few, the deck is mostly the owner's own list by design.
- If the migration is unapplied when this deploys, the deck's dismissed-rows
  read and "Clear all my data" fail until it is applied.
