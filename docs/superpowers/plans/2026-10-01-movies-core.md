# Movies Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an account track movies (watchlist / watched / not interested) next to its shows, via mixed search, a Shows/Movies switch in Library, and a movie page.

**Architecture:** Two new tables (`Movie`, `TrackedMovie`) mirror `Show`/`TrackedShow` without episodes; existing show tables, queries and the cron are untouched. Movie status rules live in a pure module. The Library keeps its two routes and reads a `type` search param; search moves to TMDB `/search/multi`.

**Tech Stack:** Next.js 16 App Router (server components, server actions), Prisma 7 on SQLite/libSQL, TMDB, vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-movies-core-design.md`

**Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/`** (AGENTS.md: this is not the Next.js you know). Also read AGENTS.md "Rules that will bite you"; the ones that apply here are called out per task.

## Global Constraints

- Statuses are exactly `watchlist` | `watched` | `not_interested`. `watchedAt` is set when moving to `watched` and cleared when moving away.
- Transitions: none → `watchlist` or `watched` (logging a film you've already seen); `watchlist` → `watched`, `not_interested`; `watched` → `watchlist`, `not_interested`; `not_interested` → `watchlist`, `watched`; any tracked state → remove.
- Caching a new movie counts against its own allowance of 60 new movies per hour per account (`NEW_MOVIES_PER_HOUR = 60`, counting only `Movie` rows the account added). The show allowance (20 per hour, shows only) is unchanged. Movies already cached by anyone never count.
- The Shows/Movies choice is the `type` search param (`?type=movies`); no param means shows; it is never remembered.
- No existing table changes. Migration is additive, so it is applied by hand *before* merge (AGENTS.md); this plan never touches production.
- No rating, list, availability, trailer or recommendation code.
- Every action starts with `requireOnboardedSession` above its `try` and scopes every Prisma call by `user.id`. Every route calls its own session gate in `page.tsx`.
- Components whose state the server can change derive from props with `useOptimistic`, never `useState` copies of props.
- Anything importing `server-only` never reaches a client component; a server component never reads a plain value out of a `"use client"` module.
- Ids from routes and action arguments are validated with a digits-only check before reaching a TMDB path.
- Existing show behaviour and tests must keep passing.

## Review Focus

- TMDB movie and TV ids overlap numerically: two search results with the same id but different kinds must both render, and each add/open must hit the right table and route. (Task 6)
- A double-click on add races the unique constraint; it must still report success. (Task 4)
- `/movie/abc`, `/movie/1/season/2` and an id TMDB doesn't know must 404 without a TMDB call for the malformed ones. (Task 8)
- A movie with no poster, no release date, or runtime `0` must render without "NaN", "0 min" or "undefined". (Tasks 2, 7, 8)
- "Clear all my data" must remove the account's tracked movies and nobody else's; two accounts tracking one movie stay independent. (Tasks 1, 5)

---

### Task 1: Movie tables and migration

**Files:**
- Modify: `prisma/schema.prisma`; add `trackedMovies TrackedMovie[]` to `User`
- Create: `prisma/migrations/<timestamp>_add_movies/migration.sql` (generated)
- Modify: `tests/helpers.ts` (`resetDatabase`), `src/app/actions.ts` (`clearAllData`)
- Test: `tests/movies-schema.test.ts`

**Interfaces:**
- Produces: Prisma models `Movie` and `TrackedMovie` exactly as in the spec's Data section (`Movie.id` string TMDB id; `Movie` fields `title`, `posterPath?`, `overview?`, `releaseDate?`, `runtime?`, `genres?`, `status?`, `lastSynced @default(now())`, `addedById?`, `createdAt?`, `@@index([addedById, createdAt])`; `TrackedMovie` fields `id @default(cuid())`, `movieId`, `userId`, `status`, `addedAt @default(now())`, `watchedAt?`, `@@unique([userId, movieId])`, `@@index([movieId])`, cascade from `Movie` and `User`). Doc-comment both models in the style of `Show`/`TrackedShow`.
- Produces: `resetDatabase()` also clears `trackedMovie` then `movie`.

- [ ] **Step 1: Write failing test** `tests/movies-schema.test.ts`: (a) a second `trackedMovie.create` for the same user+movie rejects with a unique-constraint error (`isUniqueConstraintError`); (b) two users may track the same movie; (c) deleting the `Movie` deletes its `TrackedMovie` rows; (d) deleting the `User` deletes theirs. Run `npx vitest run tests/movies-schema.test.ts`; expect FAIL (`prisma.movie` undefined).
- [ ] **Step 2:** Edit the schema, then `npm run db:migrate -- --name add_movies` locally. Read the generated SQL: it must be two `CREATE TABLE`s and their indexes, no table rebuilds.
- [ ] **Step 3:** Extend `resetDatabase` (children first) and add `prisma.trackedMovie.deleteMany({ where: { userId: user.id } })` to `clearAllData`'s transaction.
- [ ] **Step 4:** Run the new test plus `npx vitest run tests/tracking.test.ts`; expect PASS. Add a case to the schema test that `clearAllData` leaves another user's `TrackedMovie` rows (mock the gate as `tests/tracking.test.ts` does).
- [ ] **Step 5: Commit** `feat: add Movie and TrackedMovie tables`

---

### Task 2: Movie status rules

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/movie-status.ts`
- Test: `tests/movie-status.test.ts`

**Interfaces:**
- Produces in `types.ts`: `type MovieStatus = "watchlist" | "watched" | "not_interested"`; `isMovieStatus(value: unknown): value is MovieStatus`.
- Produces in `movie-status.ts` (pure, no `server-only`): `type MovieStatusTarget = MovieStatus | "remove"`; `movieStatusTargets(status: MovieStatus | null): MovieStatus[]` (`null` → `["watchlist", "watched"]`) returning the Global Constraints transitions in the order listed, never including the current status; `watchedAtFor(next: MovieStatus, now: Date): Date | null`.

- [ ] **Step 1: Write failing tests:** a table over all four inputs (`null` → `["watchlist", "watched"]`, etc.) for `movieStatusTargets`; "never contains its own input" over every status; `watchedAtFor("watched", now)` returns `now`, the other two return `null`; `isMovieStatus` accepts the three values and rejects `"watching"`, `""`, `undefined`.
- [ ] **Step 2:** Run `npx vitest run tests/movie-status.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Implement the two modules.
- [ ] **Step 4:** Re-run; expect PASS.
- [ ] **Step 5: Commit** `feat: movie status rules`

---

### Task 3: TMDB movie search and details

**Files:**
- Modify: `src/lib/tmdb.ts`, `src/lib/show-id.ts`, `tests/tmdb.test.ts`, `tests/search.test.ts`
- Test: `tests/tmdb.test.ts`

**Interfaces:**
- Produces in `show-id.ts`: `isTmdbMovieId(value: string): boolean` (same digits-only rule; separate name so call sites say which kind they hold).
- Produces in `tmdb.ts`: `interface TmdbMultiSearchResult { kind: "tv" | "movie"; id: number; name: string; posterPath: string | null; overview: string | null; year: string | null }`; `searchMulti(query: string): Promise<TmdbMultiSearchResult[]>` using `/search/multi`, dropping `person` results, same trimming, `include_adult: "false"` and 60 s cache (key `search-multi:${trimmed}`) as `searchTvShows`; movie `name` comes from `title`, `year` from `release_date`; tv results map exactly as `searchTvShows` did. `interface TmdbMovieDetails { id: number; title: string; posterPath: string | null; overview: string | null; releaseDate: Date | null; runtime: number | null; status: string | null; genres: string | null }`; `getMovieDetails(tmdbMovieId: string | number): Promise<TmdbMovieDetails>` (`/movie/{id}`; `releaseDate` via `parseAirDate`; runtime `0` or missing → `null`; genres joined with `", "`).
- Removes: `searchTvShows` and `TmdbSearchResult` (replaced). Migrate their tests to `searchMulti`; `tests/search.test.ts` mocks `searchMulti` instead.

- [ ] **Step 1: Write failing tests** in `tests/tmdb.test.ts` using the existing `mockFetch`: multi results with one of each `media_type` plus a `person` → only tv/movie returned with correct `kind`/`name`/`year`; a movie with empty `release_date` → `year: null`; `getMovieDetails` maps runtime `0` to `null`, empty genres to `null`, and `release_date: "2026-07-30"` to the same instant `parseAirDate` gives; `isTmdbMovieId("12")` true, `"12/x"`, `"1?x"`, `""` false.
- [ ] **Step 2:** Run `npx vitest run tests/tmdb.test.ts`; expect FAIL.
- [ ] **Step 3:** Implement. Raw response interfaces beside the existing ones; follow `getShowDetails` for the fetch pattern. Port the existing `searchTvShows` tests unchanged in intent.
- [ ] **Step 4:** Run `npx vitest run tests/tmdb.test.ts tests/search.test.ts`; `search.test.ts` still fails until Task 5 renames the call there, so do the one-line rename in this task to keep the suite green. Expect PASS.
- [ ] **Step 5: Commit** `feat: TMDB movie details and multi search`

---

### Task 4: Caching movies and their hourly allowance

**Files:**
- Create: `src/lib/movies.ts`
- Test: `tests/movies.test.ts`

**Interfaces:**
- Consumes: `getMovieDetails`, `TmdbMovieDetails` (Task 3); `Movie` model (Task 1).
- Produces in `movies.ts` (`server-only`): `NEW_MOVIES_PER_HOUR = 60`; `class NewMovieLimitError extends TmdbError` (status 429, message "You've added a lot of new movies. Please try again in a bit."), modelled on `NewShowLimitError`; `syncMovieFromTmdb(tmdbMovieId: string, addedById?: string): Promise<{ title: string }>` upserting the `Movie` row (sets `addedById`/`createdAt` only on create, bumps `lastSynced` on update); `cacheNewMovie(tmdbMovieId: string, userId: string): Promise<{ title: string }>` throwing `NewMovieLimitError` when the account has added `NEW_MOVIES_PER_HOUR` movies in the last hour, else syncing. `src/lib/shows.ts` is not modified.

- [ ] **Step 1: Write failing tests:** `tests/movies.test.ts` (mock `@/lib/tmdb`'s `getMovieDetails`): sync creates a row with mapped fields and `addedById`; syncing again keeps the original `addedById`/`createdAt`; `cacheNewMovie` rejects with `NewMovieLimitError` once the account has 60 recent movie rows and succeeds at 59; recent *show* rows by the same account do not count toward it; a movie cached by another account does not count; rows older than an hour do not count.
- [ ] **Step 2:** Run the file; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run `npx vitest run tests/movies.test.ts tests/shows.test.ts`; expect PASS.
- [ ] **Step 5: Commit** `feat: cache movies under their own hourly allowance`

---

### Task 5: Movie actions and mixed search suggestions

**Files:**
- Modify: `src/app/actions.ts`
- Test: `tests/movie-actions.test.ts`, `tests/search.test.ts`

**Interfaces:**
- Consumes: `isTmdbMovieId`, `cacheNewMovie`, `syncMovieFromTmdb`, `movieStatusTargets`, `watchedAtFor`, `isMovieStatus`, `searchMulti`.
- Produces: `addMovieToWatchlist(tmdbMovieId: string): Promise<ActionResult>` (mirrors `addToWatchlist`: validate id, no-op if already tracked, sync a cached movie / `cacheNewMovie` an absent one, create `status: "watchlist"`, treat a unique-constraint loss as `{ ok: true }`); `setMovieStatus(movieId: string, status: MovieStatus): Promise<ActionResult>` (validates both args; refuses a status not in `movieStatusTargets(current)` with `{ ok: false, error: "That change isn't available." }`; sets `watchedAt` via `watchedAtFor`; for a movie the user doesn't track yet it caches the movie exactly as `addMovieToWatchlist` does and creates the row with the requested status, so "Mark watched" works straight from an unadded movie, with the same double-click handling); `removeMovie(movieId: string): Promise<ActionResult>` (`deleteMany` scoped by user). All call `revalidateShowViews()` on success. The spec's separate "mark watched" action is `setMovieStatus(id, "watched")`; amend the spec's Server side bullet accordingly in this commit.
- Produces: `type SearchSuggestion = { kind: "tv"; id: string; name: string; posterPath: string | null; year: string | null; status: TrackStatus | null } | { kind: "movie"; …same; status: MovieStatus | null }`. `searchSuggestions` calls `searchMulti`, looks up `trackedShow` for the tv ids and `trackedMovie` for the movie ids (two scoped queries), caps at 12, and keeps the 200-character query cap and empty-query short circuit.

- [ ] **Step 1: Write failing tests** in `tests/movie-actions.test.ts` (same three doubles as `tests/status-transitions.test.ts`): add creates a `watchlist` row and caches the movie; adding twice leaves one row; `setMovieStatus(id, "watched")` on an untracked, uncached movie caches it and creates a `watched` row with `watchedAt` set, and `setMovieStatus(id, "not_interested")` on an untracked movie is refused; adding a movie when a show with the same id is tracked still works (ids overlap); `"12/x"` is refused without calling TMDB; `setMovieStatus` walks every allowed transition and asserts `watchedAt` set/cleared; refuses a same-status call and `"watching"`; `removeMovie` deletes only the caller's row; two users track one movie and one removing leaves the other's. In `tests/search.test.ts` update to `searchMulti` and add: a tv and a movie sharing an id both come back with their own `kind` and the right tracked status.
- [ ] **Step 2:** Run both files; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run tests/movie-actions.test.ts tests/search.test.ts tests/tracking.test.ts`; expect PASS.
- [ ] **Step 5: Commit** `feat: movie tracking actions and mixed search results`

---

### Task 6: Search overlay for shows and movies

**Files:**
- Modify: `src/components/search-overlay.tsx`, `src/components/status-badge.tsx`, `tests/search-overlay.test.tsx`
- Create: `src/components/movie-add-button.tsx`
- Test: `tests/search-overlay.test.tsx`, `tests/components.test.tsx` if `StatusBadge` is covered there

**Interfaces:**
- Consumes: `SearchSuggestion` (Task 5), `addMovieToWatchlist`, `removeMovie`, `MovieStatus`.
- Produces: `MovieAddButton({ movieId, status, variant }: { movieId: string; status: MovieStatus | null; variant?: "icon" | "full" })`, a client component built like `AddButton` (`useOptimistic`; tracked → `removeMovie`, untracked → `addMovieToWatchlist`; label "On watchlist" / "Watched" / "Not interested" when tracked). `StatusBadge` accepts `TrackStatus | MovieStatus | null` with labels "Watched" and "Not interested" added.

- [ ] **Step 1: Write failing tests** in `tests/search-overlay.test.tsx`: results show a "Movie" or "TV" tag per row; a tv and a movie with the same id both render (no duplicate-key warning; assert two rows); clicking a movie pushes `/movie/<id>`, a tv pushes `/show/<id>`; the movie row's button is the movie add button. Update the existing queries for the renamed input label, placeholder ("Search for a show or movie…") and empty copy ("No results for “…”.").
- [ ] **Step 2:** Run `npx vitest run tests/search-overlay.test.tsx`; expect FAIL.
- [ ] **Step 3:** Implement. Row `key` is `${kind}-${id}`; rename the dialog/input labels; empty-state line reads "Search TMDB for any show or movie, then add it to your lists."; unknown year shows "Year unknown". Keep `text-base` on the input (an existing test pins it).
- [ ] **Step 4:** Run `npx vitest run tests/search-overlay.test.tsx tests/components.test.tsx`; expect PASS.
- [ ] **Step 5: Commit** `feat: search shows and movies from one overlay`

---

### Task 7: Library Shows/Movies switch and movie lists

**Files:**
- Modify: `src/lib/search-params.ts` (add `"type"` and the movie list params `"movieWatchlist"`, `"movieWatched"`, `"movieNotInterested"` to `KNOWN_PARAMS`), `src/lib/queries.ts`, `src/components/library-screen.tsx`, `src/app/watchlist/page.tsx`, `src/app/archive/page.tsx`
- Create: `src/lib/library-type.ts`, `src/components/movie-list.tsx`, `src/components/movie-status-menu.tsx`
- Test: `tests/movie-queries.test.ts`, `tests/library-type.test.ts`, `tests/movie-library.test.tsx`, `tests/isolation.test.ts`

**Interfaces:**
- Produces in `queries.ts`: `interface MovieSummary { movieId: string; title: string; posterPath: string | null; releaseDate: Date | null; runtime: number | null; status: MovieStatus; watchedAt: Date | null; addedAt: Date }`; `interface MovieBuckets { watchlist: MovieSummary[]; watched: MovieSummary[]; notInterested: MovieSummary[] }`; `getMovieBuckets(userId: string): Promise<MovieBuckets>` (watchlist and notInterested newest `addedAt` first; watched newest `watchedAt` first; every read scoped by `userId`).
- Produces in `library-type.ts` (client-safe): `type LibraryType = "shows" | "movies"`; `typeFrom(params: SearchParams): LibraryType` (`"movies"` only when the last `type` value is exactly `movies`).
- Produces: `LibraryScreen` props become `{ segment: LibrarySegment; searchParams: SearchParams; data: { type: "shows"; buckets: ShowBuckets } | { type: "movies"; buckets: MovieBuckets } }`. A Shows/Movies control (links, like `Segments`) sits between the heading and the segments; the segment links carry `?type=movies` and drop every other param. Movies/Watchlist = one section; Movies/Archive = "Watched" then "Not interested" (sunken tone); each with its own empty state. Both pages fetch only the half they render.
- Produces: `MovieList({ movies, tone?, detail, param, searchParams, limit })` (server; `detail: "released" | "watched"` picks year · runtime vs "Watched <date>" via `formatAirDate`) and `MovieStatusMenu({ movieId, title, status, variant? })` (client; `Sheet` listing `movieStatusTargets(status)` plus "Remove", each calling `setMovieStatus`/`removeMovie`; `variant` `"menu"` is the row "…", `"pill"` the page control).

- [ ] **Step 1: Write failing tests:** `getMovieBuckets` sorting and bucketing, and isolation (another user's rows never appear) added to `tests/isolation.test.ts`; `typeFrom` for missing, `movies`, `shows`, `MOVIES`, repeated values and junk; a render test for `LibraryScreen` movies data: switch links point at `/watchlist` and `/watchlist?type=movies`, segment links keep `type=movies`, watched rows show the watched date, empty states appear; a movie with `releaseDate`/`runtime` null renders no "NaN", "0 min" or "undefined". Existing shows tests of the screen must still pass with the new `data` prop.
- [ ] **Step 2:** Run those files; expect FAIL.
- [ ] **Step 3:** Implement. `MovieStatusMenu` derives its current status from props (`useOptimistic`).
- [ ] **Step 4:** Run `npx vitest run tests/movie-queries.test.ts tests/library-type.test.ts tests/movie-library.test.tsx tests/isolation.test.ts tests/queries.test.ts tests/route-gates.test.ts tests/client-boundary.test.ts`; expect PASS.
- [ ] **Step 5: Commit** `feat: movies in the Library behind a Shows/Movies switch`

---

### Task 8: Movie page

**Files:**
- Create: `src/app/movie/[id]/page.tsx`, `src/app/movie/[id]/loading.tsx`, `src/components/mark-movie-watched-button.tsx`
- Modify: `src/lib/queries.ts`
- Test: `tests/movie-queries.test.ts`, `tests/movie-page.test.tsx`; `tests/route-gates.test.ts` and `tests/loading-states.test.ts` pick the route up by themselves

**Interfaces:**
- Consumes: `MovieStatusMenu`, `MovieAddButton`, `getMovieDetails`, `isTmdbMovieId`.
- Produces in `queries.ts`: `interface MovieDetail { id: string; title: string; posterPath: string | null; overview: string | null; releaseDate: Date | null; runtime: number | null; genres: string | null; status: MovieStatus | null; watchedAt: Date | null }`; `getMovieDetail(userId: string, movieId: string): Promise<MovieDetail | null>` wrapped in React `cache` like `getShowDetail`: reads the cached `Movie` row with the user's tracked row, else fetches `getMovieDetails` without writing anything; a `TmdbError` with status 404 returns `null`, other errors propagate.
- Produces: `MarkMovieWatchedButton({ movieId }: { movieId: string })`, client, calls `setMovieStatus(movieId, "watched")` in a transition and shows an error line on failure.
- The page: `requireOnboardedSession()` first; non-digit id → `notFound()`; `null` detail → `notFound()`; poster, title, meta line (year · runtime · genres, skipping absent parts), synopsis; status `null` → `MovieAddButton` full plus `MarkMovieWatchedButton`; `watchlist` → `MarkMovieWatchedButton`; tracked → `MovieStatusMenu` pill. `generateMetadata` mirrors the show page (also gated). `loading.tsx` uses the existing skeleton components.

- [ ] **Step 1: Write failing tests:** `getMovieDetail` returns the cached row with this user's status, ignores another user's tracked row, falls back to TMDB for an uncached id without creating a `Movie` row, and returns `null` on a TMDB 404; a render test that the actions follow status (`null` shows both Add to watchlist and Mark watched; `watchlist` shows Mark watched; `watched` shows neither) and that missing poster/date/runtime renders cleanly.
- [ ] **Step 2:** Run those files; expect FAIL.
- [ ] **Step 3:** Implement. Reuse `Poster`, `formatRuntime`, `formatAirDate`.
- [ ] **Step 4:** Run `npx vitest run tests/movie-queries.test.ts tests/movie-page.test.tsx tests/route-gates.test.ts tests/loading-states.test.ts`; expect PASS.
- [ ] **Step 5: Commit** `feat: movie page`

---

### Task 9: Docs and full verification

**Files:**
- Modify: `AGENTS.md` (where-things-are: `movies.ts`, `movie-status.ts`, `library-type.ts`; add a short note that Library's `type` param selects Shows/Movies, and that movies have their own hourly allowance, separate from shows), `docs/roadmap.md` if it lists movies
- Modify: spec (the Server side bullet from Task 5, if not already done)

- [ ] **Step 1:** Make the doc edits.
- [ ] **Step 2:** Run `npm run lint`, `npm test`, `npm run build`; all three must pass with no new warnings. Fix anything red before continuing.
- [ ] **Step 3:** Start `npm run dev` against a local database that has the new migration, and drive it once in the browser: search for a title that exists as both a movie and a show, add the movie, find it under Library → Movies → Watchlist, mark it watched, see it under Archive → Watched, set Not interested, remove it, and confirm Shows view is unchanged. Report anything that doesn't behave as the spec says.
- [ ] **Step 4: Commit** `docs: describe movie tracking`
- [ ] **Step 5: Hand off, do not run:** tell the owner the deploy order is back up (`npm run db:backup -- <path>`), then `npm run db:deploy` against Turso with the new migration, *then* merge. Production migrations are the owner's to apply.
