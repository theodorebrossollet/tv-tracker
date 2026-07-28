# TV Tracker

A personal web app for tracking TV shows — what you're watching, how far
through you are, and what's airing next. A replacement for TV Time.

**v1 is a single-user proof of concept.** There are no accounts and no login:
whoever can reach the app can see and change the data. Keep the deployment
private until Phase 2 adds accounts.

- [Project scope](docs/scope.md) — features, phases, what's out of scope
- [Technical design](docs/technical-design.md) — architecture, data model, routes

## Stack

| Piece | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Actions) |
| Database | SQLite via Prisma 7 |
| Show data | [TMDB API](https://www.themoviedb.org/) |
| Styling | Tailwind CSS v4 |
| Hosting | Vercel (see the caveat below) |

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
Cron job hits `/api/cron/refresh-episodes` twice a day to re-sync every tracked
show. Locally you can trigger the same refresh by hand:

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
npm run build        # production build (runs prisma generate + migrate deploy)
npm run lint         # eslint
npm run db:studio    # browse the database in Prisma Studio
npm run db:migrate   # create and apply a new migration after schema changes
```

## Deploying — read this first

The app builds and runs, but **SQLite does not work on Vercel**. Vercel's
filesystem is read-only apart from `/tmp`, so any write — tracking a show,
marking an episode watched — will fail in production. This is a stronger
limitation than the "data resets on redeploy" note in the technical design doc,
which assumed writes would at least succeed until the next deploy.

Two ways forward:

1. **Run it locally** (`npm run dev`) for now. Everything works, data persists
   in `dev.db`, and nothing needs to change.
2. **Switch to [Turso](https://turso.tech/)** (hosted, SQLite-compatible, free
   tier) before deploying. This was already planned for Phase 2. It's a small
   change: swap `@prisma/adapter-better-sqlite3` for `@prisma/adapter-libsql`
   in `src/lib/prisma.ts` and point `DATABASE_URL` at your Turso database. The
   schema and every query stay exactly the same.

## Project layout

```
src/
  app/
    actions.ts              server actions (all writes go through here)
    page.tsx                dashboard — watching list + upcoming episodes
    search/                 TMDB search
    watchlist/              "want to watch" list
    show/[id]/              season/episode list, mark watched
    settings/               notification preference, clear all data
    api/cron/               twice-daily episode refresh
  components/               shared UI
  lib/
    prisma.ts               database client
    tmdb.ts                 TMDB API wrapper (server-only)
    shows.ts                show syncing logic
    queries.ts              read queries used by pages
    types.ts, format.ts,    client-safe helpers
    images.ts
prisma/schema.prisma        data model
```

Anything under `src/lib` that imports `server-only` must never be imported by a
client component — that's why poster URLs, shared types, and date formatting
live in their own modules.
