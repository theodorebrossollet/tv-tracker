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
npm test           # vitest, ~290 tests, no network or server needed
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
src/app/          routes; actions.ts holds every write
src/components/   UI; search is an overlay here, NOT a route
src/lib/          prisma, tmdb (server-only), auth, queries, shows, format, logger
prisma/           schema + migrations
scripts/          migrate, backup, one-off backfills, icon generation
public/sw.js      service worker: caches the app shell ONLY (see below)
tests/            vitest
```

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
watched. `getShowBuckets` in `src/lib/queries.ts` owns the precedence that puts
each show in exactly one place: `stopped → finished → paused → watchlist →
watching`. Adding a status means updating that function, not just the union type.

**Adding a column needs a backfill.** Both refresh paths key on *time*, not
completeness — the cron visits tracked shows on a schedule, and the on-view
refresh only fires once a row is 24h stale. Neither notices a new column is
empty on an otherwise fresh row, so existing rows render blanks until they age
out. Write a one-off script, as `scripts/backfill-air-dates.mjs` does.

**A relation that is a list is always truthy.** `Show.tracked` and
`Episode.watched` are lists (see below), so `if (row.tracked)` is taken for
every row, including the empty case. This killed the on-view staleness refresh
in `ensureShowCached` for the whole of v2 — every cached show looked tracked, so
the branch below it was unreachable and untracked shows never re-synced. It is
silent by construction: the wrong version compiles, type checks, and behaves
plausibly. Ask about `.length`.

**A stale untracked show is served from cache and refreshed afterwards.**
`ensureShowCached` returns the cached copy and re-syncs via `after()` from
`next/server`, because the refresh is a full multi-season TMDB walk and the data
is at most a day old. Only a show with nothing cached still blocks. Two
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

**Server actions are POST-able directly, and nothing sits in front of them.**
The shared `APP_PASSWORD` gate is gone; every action opens with
`requireOnboardedSession()` and scopes its Prisma calls by the userId it
returns. Both halves are required. The gate goes *above* each `try` block —
`redirect` throws, and `toResult` would swallow it into a generic error.

**Per-user data is scoped by hand, not by the schema.** `Show.tracked` and
`Episode.watched` are lists, one entry per user, so a read that forgets its
`userId` filter returns someone else's rows and still type-checks.
`tests/isolation.test.ts` covers this; add to it when adding a query.

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
`default-src 'self'; script-src 'self'` with a weaker policy — the response
still carried a `Content-Security-Policy`, just the wrong one, and different
keys (`Content-Type`, `Cache-Control`) survived, which is what makes it hard to
spot. The catch-all goes first and `/sw.js` restates the full policy it needs.
Check header changes against a built server (`npm run build && npx next start`,
then `curl -sI`), not by reading the config.

**The service worker must never cache a page.** Every route is
`force-dynamic` and renders per-account watch state, so a cached page is
served to whoever asks next — including a different signed-in user.
`public/sw.js` allow-lists `/_next/static/` and the icons and refuses anything
that isn't a clean same-origin 200. `tests/service-worker.test.ts` runs the
real file in a fake worker scope; extend it before widening what gets cached.

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

## Conventions

- Comments explain *why*, not what. Assume the reader can read the code.
- Errors surface as something the user can act on; unexpected ones go through
  `logger.error` with an event name.
- Log events are namespaced (`show.paused`, `cron.refresh.completed`) and emit
  one JSON object per line. Never log a TMDB URL — a v3 key rides in the query
  string.
