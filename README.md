# TV Tracker

A personal web app for tracking TV shows — what you're watching, how far
through you are, and what's airing next. A replacement for TV Time.

**v1 is a single-user proof of concept.** There are no accounts. A deployed
instance is protected by one shared password (`APP_PASSWORD`, HTTP Basic auth),
which covers pages *and* server-action POSTs — without it anyone with the URL
could erase the data. Real per-user login is Phase 2.

- [Project scope](docs/scope.md) — features, phases, what's out of scope
- [Technical design](docs/technical-design.md) — architecture, data model, routes

## Stack

| Piece | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Actions) |
| Database | SQLite via Prisma 7 — local file in dev, [Turso](https://turso.tech/) in production |
| Show data | [TMDB API](https://www.themoviedb.org/) |
| Styling | Tailwind CSS v4 |
| Hosting | Vercel — free plan, so cron runs once daily |

## Getting started

**1. Install dependencies**

```bash
npm install
```

**2. Get a TMDB API key**

Create a free account at [themoviedb.org](https://www.themoviedb.org/), then go
to Settings → API. Either the v3 API key or the v4 Read Access Token works —
the app detects which one you've given it.

**3. Set up your environment file**

```bash
cp .env.example .env
```

Open `.env` and paste your key into `TMDB_API_KEY`. This file is gitignored;
never commit it.

**4. Create the database**

```bash
npx prisma migrate dev
```

**5. Run it**

```bash
npm run dev
```

Open http://localhost:3000, go to **Search**, and add your first show.

## How it works

Show and episode data is fetched from TMDB once, when you first track a show,
and cached in the local database. Pages read from that cache rather than
calling TMDB on every load — faster, and it keeps you well inside TMDB's free
tier rate limits.

Air dates change (episodes get delayed, new ones get announced), so a Vercel
Cron job hits `/api/cron/refresh-episodes` once a day (06:00 UTC) to re-sync
every tracked show. Once rather than twice because Vercel's free plan rejects
any cron that runs more than daily. Locally you can trigger the same refresh by hand:

```bash
curl http://localhost:3000/api/cron/refresh-episodes
```

In production that endpoint requires `Authorization: Bearer $CRON_SECRET`.
Set `CRON_SECRET` in your Vercel environment variables — Vercel Cron sends it
automatically. Without it the endpoint refuses to run in production, so that a
misconfigured deploy fails closed rather than exposing a public endpoint that
burns your TMDB quota.

## Useful commands

```bash
npm run dev          # development server
npm run build        # production build (runs prisma generate first)
npm run lint         # eslint
npm run db:studio    # browse the database in Prisma Studio
npm run db:migrate   # create and apply a new migration locally
npm run db:deploy    # apply pending migrations to whatever DATABASE_URL points at
npm test             # vitest suite
```

## Deploying

Local development uses a plain SQLite file. Production uses
[Turso](https://turso.tech/) — hosted, SQLite-compatible, free tier. Both go
through the same Prisma driver adapter, so the code is identical either way;
only `DATABASE_URL` changes.

Turso is required rather than a nice-to-have: Vercel's filesystem is read-only
outside `/tmp`, so a local SQLite file there can be read but never written.
Tracking a show or marking an episode watched would fail outright.

**1. Create the database**

Do this at [app.turso.tech](https://app.turso.tech) — sign up, create a database,
then copy its `libsql://` URL and generate a token from the database page.

No CLI needed. (Note: Homebrew's `turso` formula installs `tursodb`, the local
database engine — *not* the Turso Cloud CLI. Don't reach for it.)

**2. Create the schema in it**

Migrations are applied by hand, not during the Vercel build — a build step that
writes to your production database is easy to trigger by accident and hard to
undo. From your machine:

```bash
DATABASE_URL="libsql://…" TURSO_AUTH_TOKEN="…" npm run db:deploy
```

Re-run that same command after any future `npx prisma migrate dev`. It only
applies migrations that haven't run yet, so running it twice is harmless.

**3. Deploy**

Import the repo at [vercel.com/new](https://vercel.com/new) and set five
environment variables:

| Variable | Value |
|---|---|
| `TMDB_API_KEY` | your TMDB key or token |
| `DATABASE_URL` | the **`libsql://`** URL — not the local file path |
| `TURSO_AUTH_TOKEN` | the Turso token |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `APP_PASSWORD` | `openssl rand -hex 32` — generate it, don't invent it |

`DATABASE_URL` is the one to get right: locally it's `file:./dev.db`, in
production it must be the Turso URL. Vercel's env var box accepts a pasted
`.env`, so preparing a block with the production values avoids transcribing five
secrets by hand.

Without `APP_PASSWORD` the deployment returns **503** rather than serving
unprotected — deliberate, so a forgotten variable fails closed.

You type that password once and let the browser remember it, so length costs
you nothing — and with a single shared secret and no lockout, length is what
actually stops it being guessed. Changing it later takes effect only after a
redeploy; editing the variable leaves the running deployment on the old value.

**4. Add a rate limit** (optional, but cheap)

Vercel dashboard → the project → Firewall → Custom Rules → Add Rule: match
`Request Path` `Starts with` `/`, rate limit to 100 requests per 10 seconds
keyed by IP address, action Deny (403). It applies without a redeploy. See
"Access Control" in the design doc for why the threshold is generous and why
this can't live in the repo.

**Migrating existing local data.** If you've been using the app locally, the
production database starts empty. Copy the tables across in dependency order
(Show → Episode → TrackedShow → WatchedEpisode → Settings) before first use;
air dates carry over already anchored, so `scripts/backfill-air-dates.mjs` will
correctly report zero conversions against Turso.

## About `npm audit`

`npm audit` reports 9 high-severity issues. All of them are in eslint's
dependency chain, which only ever runs on your own machine — none of it is
served to anyone visiting the app. They all trace back to a single package
(`brace-expansion`), and the only fix is a major eslint upgrade that would
likely break the config, so they're left alone for now.

The three that *did* affect the running app — outdated `sharp` and `postcss`,
both pinned to old versions by Next.js — are fixed via the `overrides` block in
`package.json`. `npm audit --omit=dev` reports zero vulnerabilities.

Re-check with `npm audit --omit=dev` after a monthly `npm update`; that's the
number that actually matters.

## Project layout

```
src/
  app/
    actions.ts              server actions (all writes go through here)
    page.tsx                dashboard — watching list + upcoming episodes
    watchlist/              shows added but not started
    show/[id]/              availability, trailer, episodes, mark watched
    settings/               country, notifications, clear all data
    api/cron/               daily episode refresh
    error.tsx               catches an unreachable TMDB
  components/               shared UI (search is an overlay, not a route)
  proxy.ts                  password gate (Next 16 renamed Middleware)
  lib/
    prisma.ts               database client
    tmdb.ts                 TMDB API wrapper (server-only)
    shows.ts                show syncing logic
    queries.ts              read queries used by pages
    logger.ts               structured JSON logging
    types.ts, format.ts,    client-safe helpers
    images.ts
prisma/schema.prisma        data model
scripts/                    migrate + one-off air-date backfill
tests/                      vitest suite (npm test)
```

Anything under `src/lib` that imports `server-only` must never be imported by a
client component — that's why poster URLs, shared types, and date formatting
live in their own modules.
