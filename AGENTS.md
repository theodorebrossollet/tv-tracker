<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# TV Tracker — orientation

A personal TV tracker replacing TV Time. Single user, no accounts. Next.js 16
App Router, Prisma 7 over SQLite (local file in dev, Turso in production), TMDB
for show data, deployed on Vercel.

Read `docs/technical-design.md` for the reasoning behind anything below, and
`docs/scope.md` for what's in v1 versus what Phase 2 owns.

## Commands

```bash
npm run dev        # local server (localhost:3000)
npm test           # vitest, ~100 tests, no network or server needed
npm run lint
npm run build      # runs prisma generate first
npm run db:migrate # create + apply a migration locally
npm run db:deploy  # apply migrations to whatever DATABASE_URL points at
```

`lint`, `test` and `build` also run on every pull request
(`.github/workflows/ci.yml`). Vercel's preview deploy is a separate check and
only tells you the app built.

## Where things are

```
src/app/          routes; actions.ts holds every write
src/components/   UI; search is an overlay here, NOT a route
src/lib/          prisma, tmdb (server-only), queries, shows, format, logger
src/proxy.ts      password gate (Next 16 renamed Middleware → Proxy)
prisma/           schema + migrations
scripts/          migrate + one-off backfills
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

**Migrations do not run on deploy.** `npm run build` only does `prisma
generate`. Apply migrations by hand with `npm run db:deploy` pointed at Turso —
deliberate, so a build can't mutate production data. Note `prisma migrate
deploy` cannot talk to Turso at all (it rejects `libsql://`), which is why
`scripts/migrate.mjs` exists.

**Anything importing `server-only` must never reach a client component.** That's
why poster URLs (`lib/images.ts`), shared types (`lib/types.ts`) and date
formatting (`lib/format.ts`) live apart from `lib/tmdb.ts`.

**Server actions are POST-able directly.** There is no auth in v1 — only the
shared password in `src/proxy.ts`, which covers action POSTs because it runs
before routing. When Phase 2 adds accounts, the session check belongs at the top
of *each action*, not only in page components.

**TMDB caching is in-process, not Next's.** These pages are
`dynamic = "force-dynamic"`, which forces `fetchCache: "force-no-store"` and
silently discards any `next: { revalidate }`. Setting `fetchCache` does not
override it — measured, not assumed. `lib/tmdb.ts` keeps its own TTL map.

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
