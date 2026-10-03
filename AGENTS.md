<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# TV Tracker — orientation

A personal TV tracker replacing TV Time. Invite-only accounts — a handful of
friends and family, no public sign-up. Next.js 16 App Router, Prisma 7 over
SQLite (local file in dev, Turso in production), TMDB for show data, deployed
on Vercel.

Read `docs/technical-design.md` for the reasoning behind anything below, and
`docs/scope.md` for what's in v1 versus what's deferred. v2 (accounts + a PWA,
nothing else) is scoped separately in `docs/scope-v2.md` and
`docs/technical-design-v2.md` — read those before touching auth, per-user data,
or the manifest/service worker.

## Commands

```bash
npm run dev        # local server (localhost:3000)
npm test           # vitest, ~450 tests, no network or server needed
npm run lint
npm run build      # runs prisma generate first
npm run db:migrate # create + apply a migration locally
npm run db:deploy  # apply migrations to whatever DATABASE_URL points at
npm run db:backup  # dump DATABASE_URL to a restorable .sql file
```

Run `db:backup` before any migration that rewrites a table holding real data.
`db:deploy` applies migration files non-transactionally, so a file that fails
halfway leaves a state it cannot repair — and watch history, unlike the
Show/Episode cache, exists nowhere else to re-fetch from.

`lint`, `test` and `build` also run on every pull request
(`.github/workflows/ci.yml`). Vercel's preview deploy is a separate check and
only tells you the app built.

**Nothing enforces a green run.** Branch protection isn't available on private
repositories on GitHub's free plan, so a red pull request can still be merged —
it has happened. Treat the check as a gate anyway: don't merge on red.

## Where things are

```
src/app/          routes; actions.ts holds the Library writes, account-actions.ts
                  the account ones, list-actions.ts the list ones and
                  rating-actions.ts the rating ones and rewatch-actions.ts
                  (startShowOver, watchMovieAgain, resetShowHistory,
                  resetMovieHistory) the rewatch ones (the fifth
                  module) — the rules in actions.ts's header govern all five;
                  discover-actions.ts holds the Discover ones (dismiss,
                  reset, card details) under the same rules, and
                  view-actions.ts sets the rows/posters cookie (see
                  "Rows or posters, in short")
src/components/   UI; search is an overlay here, NOT a route
src/lib/          prisma, tmdb (server-only), auth, queries, shows, format, logger,
                  search-params (the URL params any screen is allowed to read),
                  action-result (ActionResult + toResult, shared by all five
                  action modules; deliberately not "use server"),
                  up-next (what the show page says when nothing aired is left
                  to watch, and NEXT_UP_QUEUE — which lives here rather than
                  beside its card for the reason below),
                  movies (movie cache + NEW_MOVIES_PER_HOUR), movie-status
                  (movie status transitions), library-type (Library's `type`),
                  lists (list limits, name validation, isListItemWatched; the
                  list reads — getLists, getListDetail, getListsForTitle — are
                  in queries.ts),
                  ratings (rating rules: isRating, seasonAverage, showAverage,
                  formatRating, formatAverage, coverageText; pure, client-safe),
                  rewatch (MAX_PAST_RUNS, MAX_PAST_WATCHES; pure)
src/app/movie/    movie page, /movie/[id]
src/app/lists/    Lists index, /lists, and /lists/[id] (each with a loading.tsx)
prisma/           schema + migrations; 20261002031325_add_movies adds Movie and
                  TrackedMovie — additive, so apply it BEFORE merging;
                  20261002042557_add_lists adds List and ListItem — also
                  additive (two new tables), also apply BEFORE merging;
                  20261002142452_add_ratings adds WatchedEpisode.rating and
                  TrackedMovie.rating — additive (two `ALTER TABLE ... ADD
                  COLUMN`), also apply BEFORE merging — and verify it:
                  because it adds a column to two core tables and Prisma
                  selects every column by default, deploying the code first
                  breaks nearly every screen (dashboard, Library, show and
                  movie pages, marking things watched) for everyone, not just
                  ratings; after `npm run db:deploy`, check on Turso that
                  `SELECT rating FROM TrackedMovie LIMIT 1; SELECT rating FROM
                  WatchedEpisode LIMIT 1;` succeed BEFORE merging
                  20261002152206_add_rewatch adds ShowRun,
                  ArchivedEpisodeWatch and PastMovieWatch — additive (three
                  new tables, no change to existing ones), so apply it BEFORE
                  merging; unapplied, these fail: the rewatch
                  actions, Settings' "Clear all my data" (its transaction
                  also deletes runs and past watches), and the TMDB show
                  resync (daily cron, stale-show refresh, adding a new
                  show), which now reads ArchivedEpisodeWatch. The
                  title-page history reads still degrade softly;
                  20261003010941_add_discover adds DismissedSuggestion —
                  additive (one new table), apply it BEFORE merging;
                  unapplied, Settings' "Clear all my data" breaks (its
                  transaction also deletes dismissals), the Settings count
                  shows "Unavailable", and the deck's read of dismissed rows
                  fails
scripts/          migrate, backup, one-off backfills, icon generation,
                  inspect-show (read-only dump of one show's episode and watch
                  rows, for when the app and the database seem to disagree);
                  icons/ holds the outlined SVGs the icons are rendered from
public/sw.js      service worker: caches the app shell ONLY (see below)
tests/            vitest
```

Movies, in short: Library's `type` param (`?type=movies`, in KNOWN_PARAMS)
selects Shows or Movies. Movies have their own hourly new-title allowance
(60, `NEW_MOVIES_PER_HOUR`), separate from shows' 20. `searchSuggestions`
returns a union discriminated by `kind`; TMDB movie and TV ids overlap
numerically, so never look one up as the other — separate tables and routes
(`/movie/[id]` vs `/show/[id]`) keep them apart.

Lists, in short: private per-account lists of movies and shows, mixed.
Components: `list-form-sheet` (create/edit), `new-list-button`,
`list-item-row`, `list-menu`, `add-titles-button` (opens the search overlay in
"adding to a list" mode via `useSearch().openForList`), `list-add-button` (the
overlay's per-result control), `add-to-list-button` (on movie and show pages).
`searchSuggestions(query, listId?)` marks results `onList`. The fifth "Lists"
tab stays active for `/lists/...`. Rules:

- Writes live in `src/app/list-actions.ts`; its rules are the ones in
  `actions.ts`'s header (gate above each `try`, every call scoped by user,
  arguments validated).
- Limits: 50 lists per account, 500 items per list.
- Adding to a list never touches Library tracking (it does cache an uncached
  title).
- `trackSeparately` is per list. Off (personal): items show the title's real
  Library status. On ("together"): each item has its own tick on
  `ListItem.watchedAt`, which is ignored while the flag is off and kept if it is
  flipped back.
- A show counts as watched on a personal list only when finished by the
  Library's derived rule (`fullyWatched && hasSeriesEnded`, from
  `getTrackedShows`). `getListDetail` reuses it; never re-derive it.

Ratings, in short: 1–10 whole numbers on `TrackedMovie.rating` and
`WatchedEpisode.rating`. Components: `rating-strip` (ten steps; tap the chosen
one to clear), `rating-value` ("★ 8", averages "★ 7.4"), `season-rating-line`,
the rating UI in `episode-row`, and `show-header`'s `rating` prop. Rules:

- Writes live in `src/app/rating-actions.ts` (`rateMovie`, `rateEpisode`);
  rules are those in `actions.ts`'s header. Never creates a record: only
  something already watched can be rated.
- Season and show ratings are DERIVED, never stored. A show's rating is the
  mean of its season averages (each season counts equally; seasons with no
  rated episode are left out).
- That rule exists twice: SQL in `loadShowRatings` (`queries.ts`, many shows)
  and TypeScript in `getShowDetail` (one show page). Held together by the
  parity test in `tests/rating-queries.test.ts` — change both together.
- Show/Episode rows are shared between accounts, so every join to
  `WatchedEpisode` for ratings must carry `userId`.
- Un-watching clears the rating: a movie leaving `watched` writes
  `rating: null` in the same update; un-marking an episode deletes the
  `WatchedEpisode` row.

Rewatch, in short: "Start over" on a show and "Watch again" on a movie keep the
old run/watch as read-only history. Components: `past-runs`, `past-watches`,
`watch-again-button`, the "Start over" row and confirmation in `status-sheet`,
and `show-header`'s `runNumber`/`startOver` props. Rules:

- `WatchedEpisode` and `TrackedMovie` still mean the CURRENT run/watch. Nothing
  may read the archive tables (`ShowRun`, `ArchivedEpisodeWatch`,
  `PastMovieWatch`) for current progress, finished/caught-up, Up Next or
  ratings. Ratings follow the current run (a restart or watch-again clears them).
- Writes live in `src/app/rewatch-actions.ts`. Archive-and-clear is ONE
  array-form `$transaction` using `INSERT … SELECT` (not read-then-write). The
  `ShowRun`/`PastMovieWatch` insert is CONDITIONAL in SQL and guards the
  statements after it, so a concurrent double submit never creates an empty run.
- `resetShowHistory`/`resetMovieHistory` permanently delete the current AND
  archived history (ratings included) of one title, and work even when it is
  untracked. Each is one idempotent array-form `$transaction` scoped by
  `user.id` (a second call is refused "Nothing to reset."); `watching` →
  `watchlist` for a show, `watched` → `watchlist` (no date, no rating) for a
  movie, other statuses untouched. UI: the red "Reset history" row, last in
  both status sheets.
- Limits: 20 past runs per show, 20 past watches per movie (`lib/rewatch.ts`).
- The title-page reads (`pastRuns` in `getShowDetail`, `pastWatches` in
  `getMovieDetail`; types `PastRun`, `PastWatch`) fail softly: `null` means
  unavailable (e.g. migration unapplied), so the UI must not trust `runNumber`
  then.
- A just-restarted show is `watching` with zero watched, which
  `demoteIfNothingWatched` treats as wrong: marking then unmarking its only
  episode drops it to the Library watchlist (harmless; the next mark
  re-promotes it).
- The TMDB resync keeps any episode that has a watch, current or archived
  (`archivedWatches: { none: {} }` beside `watched`), so deleting a dropped
  episode never cascades past-run history away.

Discover, in short: `/discover` (the sparkle icon in the dashboard header) is a
swipe deck of suggestions seeded from what you've watched and rated. Code:
`lib/discover.ts` (deck building), `lib/discover-types.ts`, `lib/swipe.ts`,
`components/discover-*.tsx`, writes in `src/app/discover-actions.ts`. Rules:

- Seeds: titles you rated >= 8, the newest 10 by `watchedAt`. With fewer than
  3 there are no recommendations, but the deck still deals your own titles.
- `DismissedSuggestion` (a swipe-away) is separate from the movie
  `not_interested` status; the two never read each other. The only way to undo
  dismissals is "Show them again" in Settings (`resetDismissedSuggestions`).
- "Pick for tonight" (✓ on one of your own cards) draws from your watchlist
  (watchlist movies and shows) unless a list is picked. With a list picked it
  draws from that list's unwatched titles, minus movies set to
  `not_interested` and shows you've stopped, and recommendations are off.
- A card's streaming line is its flatrate services in the saved country, for
  shows and movies alike (`loadCardDetails`); a failed lookup drops the line, not
  the card.
- Swipe logic lives in `lib/swipe.ts` and is unit-tested; the touch listeners
  that feed it are the one part with no automated coverage, so changes there
  need a device.

## Rules that will bite you

Each of these has already caused a bug here. Check against them before writing
code; the design doc explains the reasoning.

**Components whose state the server can change must derive from props, not
`useState`.** Copying a prop into `useState` means it initialises once and then
ignores every later change, so a server revalidation can never correct the
display. This shipped twice — "Mark all watched" updating the database while
every row still read unwatched, and the add button still saying "On watchlist"
after a show had been promoted. Use `useOptimistic`.

**Air dates are anchored to midnight US Eastern, not UTC.** `parseAirDate` in
`src/lib/tmdb.ts` converts TMDB's bare `YYYY-MM-DD` accordingly. Because the
zone is behind UTC, the stored instant's *UTC calendar date* still equals the
broadcast date — which is what makes `formatAirDate` (which formats in UTC)
correct. Don't "simplify" this to `new Date(str)`.

**"Finished" is derived, never stored.** It means every aired episode is
watched, *and* TMDB says the series is over — otherwise the show is "caught up",
a separate bucket, because one is done and the other is between seasons.
`getShowBuckets` in `src/lib/queries.ts` owns the precedence that puts each show
in exactly one place: `stopped → caught up / finished → paused → watchlist →
watching`. Adding a status means updating that function, not just the union type.

**That ownership is literal: derive neither "aired" nor "finished" outside
`lib/queries.ts`.** The show page used to compute both itself, so `StatusMenu`
was handed `finished` from the query layer in a library row and from a local
loop on the show page — two implementations of one rule, agreeing only by
coincidence. `getShowDetail` now returns `aired` per episode plus the counts, so
a page consumes them instead. The rule still exists twice by necessity, once in
SQL for the lists and once in TypeScript for one show's detail, and neither can
call the other — so `tests/queries.test.ts` asserts the two answer the same
across a table of cases rather than trusting them to.
The ended/still-running test is `hasSeriesEnded` in `lib/format.ts`, shared with
`caughtUpLabel` and `showMetaLine` so the Archive and the show card can't
disagree about the same show.

**Adding a column needs a backfill.** Both refresh paths key on *time*, not
completeness — the cron visits tracked shows on a schedule, and the on-view
refresh only fires once a row is 6h stale. Neither notices a new column is
empty on an otherwise fresh row, so existing rows render blanks until they age
out. Write a one-off script, as `scripts/backfill-air-dates.mjs` does.

**A relation that is a list is always truthy.** `Show.tracked` and
`Episode.watched` are lists (see below), so `if (row.tracked)` is taken for
every row, including the empty case. This killed the on-view staleness refresh
in `ensureShowCached` for the whole of v2 — every cached show looked tracked, so
the branch below it was unreachable and untracked shows never re-synced. It is
silent by construction: the wrong version compiles, type checks, and behaves
plausibly. Ask about `.length`.

**A stale show is served from cache and refreshed afterwards.** Tracked or
not: once a cached show is more than `STALE_AFTER_MS` (6h) old, viewing it
queues a re-sync. Tracked shows used to be left to the cron, which only runs
daily on the Hobby plan, so an episode TMDB added after 06:00 UTC stayed hidden
until the next morning. `ensureShowCached` returns the cached copy and re-syncs
via `after()` from `next/server`, because the refresh is a full multi-season
TMDB walk and the data is at most a few hours old. Only a show with nothing cached still blocks. Two
consequences: the `after()` callback must not touch request-time APIs
(`cookies`, `headers`) — it throws in a Server Component — and refreshes are
deduplicated by show id, because `lastSynced` only moves when a sync *finishes*
and two concurrent syncs collide on the episode primary key.

**Migrations do not run on deploy.** `npm run build` only does `prisma
generate`. Apply migrations by hand with `npm run db:deploy` pointed at Turso —
deliberate, so a build can't mutate production data. Note `prisma migrate
deploy` cannot talk to Turso at all (it rejects `libsql://`), which is why
`scripts/migrate.mjs` exists.

**A schema change is two steps, and the order is not a detail.** Merging *is*
deploying — Vercel ships `main` automatically — and the migration never rides
along with it.

- **Additive** (new column or table): run it *before* merging. The deployed
  code doesn't know the new column exists and ignores it, so there is no
  window where anything is broken.
- **Breaking** (drop, rename, tighten to `NOT NULL`): run it *adjacent* to the
  merge. The old build stops working the moment it lands, and the new build
  doesn't work until it does, so some downtime is unavoidable — keep it short
  and deliberate rather than discovering it.

Getting this backwards took the app down twice in one afternoon, both times
because code shipped first. `npm run db:backup` before either, and note that
SQLite rebuilds a whole table for changes that look additive — adding a column
with a foreign key, or one with `NOT NULL DEFAULT`, both drop and recreate.
Read the generated SQL rather than assuming.

**A stale database now says so — on writes *and* reads.**
`lib/schema-error.ts` recognises the "database is behind the code" failure and
surfaces "The app is being updated" instead of the generic error, because the
generic one sent debugging in the wrong direction for half an hour. The signal
is the *driver's* message, not Prisma's error code: the libSQL adapter reports
these as P2039/P2010, not the documented P2021/P2022.

This used to cover only server actions, via `toResult` — so a *page* that read
a missing column threw during render, landed in `app/error.tsx`, and told the
user "This is usually TMDB being unreachable". That is exactly the
wrong-direction debugging the check exists to prevent, and it happened for real
the day `Settings.providerIds` shipped ahead of its migration: every page
reading Settings blamed TMDB. The Prisma client in `lib/prisma.ts` now tags
these errors with a `SCHEMA_MISMATCH` digest and logs `db.schema_mismatch`
naming the missing column, and `error.tsx` reads the digest. It has to be the
digest: Next scrubs the message before it reaches a client component in
production builds, so the boundary cannot re-run the check itself. A custom
digest *is* forwarded rather than replaced by Next's generated hash — measured
against a production build on Next 16.2.12, and worth re-measuring on a major
upgrade, because if it ever stops being true the copy silently reverts to
blaming TMDB and nothing fails.

**"Show more" is a URL, not `useState`.** The lists (`ShowList`,
`UpcomingList`) and the availability panel are server components; revealing more
rows or switching country is a navigation to `?<list>=<n>` / `?country=XX`, so
the server renders only what was asked for instead of shipping everything and
hiding most of it. Reaching for client state here is the instinct to resist —
it's what these were before, and it put every row of every list into the
payload. Each list owns its own param and the expand link copies the others
across, or expanding one section collapses its neighbour. Bound anything read
off a param with `limitFrom`: it's as attacker-supplied as any other input.

**Anything importing `server-only` must never reach a client component.** That's
why poster URLs (`lib/images.ts`), shared types (`lib/types.ts`) and date
formatting (`lib/format.ts`) live apart from `lib/tmdb.ts`.

**And the mirror of that: a server component may *render* a client component,
but must never read a plain value out of a `"use client"` module.** The bundler
replaces such a module with client references — stand-ins that throw when
called. A component survives, because it is only ever rendered. A constant does
not: what arrives is an object where a number was expected, and what happens
next is whatever the server does with it.

`NEXT_UP_QUEUE = 8` lived in `components/next-up-card.tsx`, and the show page
capped its queue with `.slice(0, NEXT_UP_QUEUE)`. The reference coerced to
`NaN`, `slice(0, NaN)` returns `[]`, and so the Next-up card never rendered —
for any show, for anyone, for as long as the export existed. What showed
instead was the caught-up card, which is a plausible thing for a show page to
say, so it was reported and twice half-fixed as a copy problem.

Nothing catches this on its own. `npm run build` succeeds — the substitution is
a supported transformation, not an error. The types stay correct, because it
happens in the bundler, after type checking; TypeScript goes on believing the
export is a `number`. And no test renders a bundled page, so reproducing the
data in vitest gives a *correct* queue and argues the code is fine. The defect
exists only in `.next/server`, which is where it was eventually read.

The one signal it gave was two derivations of the same fact disagreeing on
screen: the season pills said five episodes were unwatched while the card said
the season was complete. `show.progress_mismatch` logs any render where the
queue is empty but the counts disagree, and it named the bug on the first
request after it shipped. `tests/client-boundary.test.ts` is the actual guard —
it walks `src/` for a server module importing a non-component value from a
client one. Note its component test needs an initial capital *and* a lowercase
letter: `SCREAMING_SNAKE_CASE` also starts with a capital, which is exactly how
this shape slips past a first look.

**`<dialog>` does not inherit the app's text colour, and the palette does not
own every colour on screen.** The UA stylesheet gives `<dialog>` its own
`color: CanvasText` — a system colour, resolved against the element's *used*
`color-scheme` rather than against `prefers-color-scheme`. Nothing declared one,
so it was light: every string in the status sheet rendered pure black on the
dark panel, while any child that named a token (the row hints, `text-muted`)
stayed correct. What that looks like is a heading dimmer than its own subtitle,
which reads as a grading mistake rather than a missing declaration.
`SearchOverlay` set `text-foreground` on its dialog from the start and looked
right throughout, which is what kept it from being one bug in one place.

`color-scheme: light dark` on `:root` is the fix — that declaration, not the
`@media (prefers-color-scheme: dark)` block, is what a system colour resolves
against. The sheet also names `text-foreground` itself, so it no longer depends
on a system colour at all. Form controls were never part of this: Tailwind's
preflight already gives them `color: inherit`, and they measured correct both
before and after.

jsdom cannot see this — it has no system colours, so a rendered sheet reports an
empty `color` in both schemes and the fixed version is indistinguishable from
the broken one. `tests/system-colours.test.ts` reads source instead: the
stylesheet declares a scheme, and every `<dialog>` names a text colour. Note
that `tests/contrast.ts` is no help here either — it only parses hex tokens, so
`accent-tint`, `accent-border` and `scrim` are outside what it measures.

**The icon SVGs in `scripts/icons/` contain no text, and must not grow any.**
The mark is the wordmark "tv", and it arrived from design as a `<text>` element
in Geist. Text in an SVG is resolved by whatever rasterises it, and every way
that goes wrong is quiet: a machine without Geist substitutes a fallback and
draws a plausible, wrong wordmark; librsvg — which is what `sharp` uses, and
what the handoff's own pipeline recommended — draws it wrong *with* the font
installed, because it leaves the trailing letter-spacing out of the advance
width it centres on, putting the mark 15px left of centre on a 1024 canvas.
Neither fails, and the icon is not something anyone looks at twice after the
first day. The committed SVGs are outlined paths, which measured identical
across rasterisers to within antialiasing. `tests/icons.test.ts` fails on a
reintroduced `<text>` or `font-family`, because nothing else would.

**Server actions are POST-able directly, and nothing sits in front of them.**
The shared `APP_PASSWORD` gate is gone; every action opens with
`requireOnboardedSession()` and scopes its Prisma calls by the userId it
returns. Both halves are required. The gate goes *above* each `try` block —
`redirect` throws, and `toResult` would swallow it into a generic error.

**Per-user data is scoped by hand, not by the schema.** `Show.tracked` and
`Episode.watched` are lists, one entry per user, so a read that forgets its
`userId` filter returns someone else's rows and still type-checks.
`tests/isolation.test.ts` covers this; add to it when adding a query.

Sharper in the two raw queries in `lib/queries.ts`: `userId` is a join
condition there, not a `where` clause, so there is no field to omit — only
`AND w."userId" = ${userId}` to drop, which reads like a formatting change and
turns one account's progress into the household's. Raw SQL also gives up the
one guardrail Prisma still offered, since a bad `where` at least had to
type-check against the model. Bind dates as `Date`, never as epoch
milliseconds: `DateTime` is stored as ISO text, so an integer comparison matches
nothing and silently reports every show as having nothing aired.

**Route protection is per-file convention, with one backstop.** Nothing
enforces that a new page or route handler calls a gate — there is no middleware,
and the `APP_PASSWORD` net that used to catch the omission is gone, so a
forgotten gate is silently public and looks entirely normal in review.
`tests/route-gates.test.ts` walks `src/app/**/{page.tsx,route.ts}` and fails on
any file that doesn't name a gate, with an allow-list for the login flow and the
cron route. It checks the gate is *named*, not called — treat a green run as
"nobody forgot entirely", not as proof the route is protected.

**Changing a password or recovering with a code signs out every other session.**
`changePassword` keeps only the session making the change; `loginWithCode`'s
recovery branch clears all of them before minting the new one. Without this the
recovery story didn't work: expiry slides forward on every visit, so a stolen
session that gets used never lapses, and nothing else in the app ends a session
it isn't holding the cookie for. The settings copy says so — keep them in step
if either changes.

**Header entries in `next.config.ts` do not stack per key.** Two matching
`headers()` entries that set the *same* key don't merge; the last one wins.
A catch-all listed after the `/sw.js` entry silently replaced the worker's
own policy with a weaker one — the response still carried a
`Content-Security-Policy`, just the wrong one, and different keys
(`Content-Type`, `Cache-Control`) survived, which is what makes it hard to spot.
The catch-all goes first and `/sw.js` restates the full policy it needs.

The consequence to remember when editing either: **anything added to the
catch-all has to be repeated in the `/sw.js` entry**, or the worker silently
loses it. The two have drifted apart once already. Check header changes against
a built server (`npm run build && npx next start`, then `curl -sI`), not by
reading the config.

**The service worker must never cache a page.** Every route is
`force-dynamic` and renders per-account watch state, so a cached page is
served to whoever asks next — including a different signed-in user.
`public/sw.js` allow-lists `/_next/static/` and the icons and refuses anything
that isn't a clean same-origin 200. `tests/service-worker.test.ts` runs the
real file in a fake worker scope; extend it before widening what gets cached.

Note the worker never updates itself: this file is byte-identical between
builds, so the browser has nothing to install after the first visit and
`activate` — the only thing that deletes anything — never runs again. Anything
you add to the cache is therefore added forever, which is why `MAX_ENTRIES`
exists. Don't reach for a versioned cache name; a file served verbatim from
`public/` has no build id to version with.

**A counter kept in the database must be incremented by the database.**
`failedLogins` was read into Node, had 1 added to it, and was written back, so
a batch of parallel sign-in attempts all read the same value and all wrote the
same successor — the throttle counted N guesses as one. Instances here are
short-lived and scale out per request, which is *why* the counter is in a shared
table at all; doing its arithmetic in process gives back exactly what that
bought. Use `{ increment: 1 }`, and be careful what else the same write clears.

**`revalidatePath(path, "layout")` names a real `layout.tsx`, not a URL
prefix.** `revalidatePath("/show", "layout")` looks like "everything under
/show" and is nothing at all: there is no `app/show/layout.tsx`, the route is
`/show/[id]`, and Next's docs require a dynamic segment be written as the
pattern. A call that matches nothing throws no error and logs nothing — the
symptom surfaces navigations later as a stale client router cache. Prefer
`revalidateShowViews()`, which is the `/` layout and documented to cover
everything beneath it.

**TMDB caching is in-process, not Next's.** These pages are
`dynamic = "force-dynamic"`, which forces `fetchCache: "force-no-store"` and
silently discards any `next: { revalidate }`. Setting `fetchCache` does not
override it — measured, not assumed. `lib/tmdb.ts` keeps its own TTL map, and it
stores the in-flight *promise* rather than the resolved value, so concurrent
misses share one request instead of each firing their own. Rejections evict
themselves; a cached failure would otherwise be served for the whole TTL.

**Values TMDB supplies are validated where the response is mapped.** Provider
links must be https (React only *warns* about a `javascript:` href — it renders
it anyway) and YouTube ids are charset-checked, which is what makes them safe to
interpolate into the thumbnail and embed URLs. Both live in `lib/tmdb.ts` rather
than the components, so a new consumer inherits the guarantee. The id check is
deliberately not length-pinned: `{11}` would add no safety and would silently
drop a trailer, which renders identically to a show that has none.

## Testing

`npm test` needs no network and no dev server: TMDB is mocked at `fetch`, and
the database tests build a throwaway SQLite file from the real migration files.

When adding tests for ordering or filtering, **check the test fails without the
code**. Three sorting tests here originally passed either way, because the
fixtures happened to agree with the behaviour being replaced. Reintroduce the
bug, confirm red, then restore.

**Nothing here runs a bundled page**, and a green suite is not a claim that the
built app behaves the same way. Vitest imports modules directly, so the
server/client transformations Next applies at build time simply don't happen —
which is how a page could render wrongly in production while a test
reconstructing its exact data proved it correct. Three tests stand in for what
the suite can't see, each by reading source rather than behaviour:
`route-gates` (every page names a gate), `icons` (no `<text>` in the mark), and
`client-boundary` (no value crossing out of a `"use client"` module). When a
rule can only be broken at build time, that is the shape a test for it takes.

## Conventions

- Comments explain *why*, not what. Assume the reader can read the code.
- Errors surface as something the user can act on; unexpected ones go through
  `logger.error` with an event name.
- Log events are namespaced (`show.paused`, `cron.refresh.completed`) and emit
  one JSON object per line. Never log a TMDB URL — a v3 key rides in the query
  string.

## Rows or posters, in short

Every list of titles (a list's page, the Library's Shows and Movies sections)
can be shown one per row or as a grid of posters. The choice is a cookie,
`view` = `rows` | `posters` (`lib/view-mode.ts`; anything else means rows), set
by `setViewMode` in `app/view-actions.ts` and read per request by
`getViewMode()` (`lib/get-view-mode.ts`) in the three pages that need it. It is
per browser on purpose: no column, no migration. `PosterGrid` renders a title
as a link plus overlays (kind badge on lists, a corner check for seen, a
rating); every row-only action (a together list's tick, "mark watched", status
menus, "remove from list") lives on the title page instead. The components take
an optional `view` prop that defaults to rows, so a new list of titles gets the
grid by passing `view` and mapping its items to `PosterGridItem`.
