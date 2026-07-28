# TV Tracker — Technical Design (v1)

Based on `tv-tracker-scope.md`. Covers architecture, data model, routes, and integration details needed to start building.

## 1. Architecture Overview

Single Next.js app (App Router), deployed on Vercel, using Server Actions instead of a separate REST API layer where possible — simpler for a beginner to reason about since UI and backend logic live close together. No authentication in v1 — single user, not shared.

```
Browser
  │
  ▼
Next.js App Router (Vercel)
  │
  ├── Server Actions ── read/write via Prisma
  ├── TMDB API client ── fetches show/episode data (cached in DB)
  ├── Cron job (2x/day) ── refreshes episode/air-date data
  │
  ▼
SQLite database (via Prisma) — resets on redeploy (accepted for v1)
```

No separate backend service, no message queue, no external state, no auth layer — deliberately minimal for a single-user PoC.

## 2. Data Model (Prisma schema, simplified)

No `User` model in v1 — all data belongs to the single user implicitly (no `userId` fields needed).

```prisma
model Show {
  id          String   @id            // TMDB show id, stored as string
  name        String
  posterPath  String?
  overview    String?
  lastSynced  DateTime @default(now()) // last time we refreshed episode data from TMDB

  episodes     Episode[]
  tracked      TrackedShow[]
}

model Episode {
  id            String   @id          // TMDB episode id
  showId        String
  seasonNumber  Int
  episodeNumber Int
  name          String?
  airDate       DateTime?

  show          Show     @relation(fields: [showId], references: [id])
  watched       WatchedEpisode?
}

model TrackedShow {
  id        String   @id @default(cuid())
  showId    String   @unique
  status    String   // "watching" | "watchlist"
  addedAt   DateTime @default(now())

  show      Show     @relation(fields: [showId], references: [id])
}

model WatchedEpisode {
  id         String   @id @default(cuid())
  episodeId  String   @unique
  watchedAt  DateTime @default(now())

  episode    Episode  @relation(fields: [episodeId], references: [id])
}

model Settings {
  id            Int     @id @default(1)  // single row, always id=1
  notifyEnabled Boolean @default(false)
}
```

**Notes:**
- Show/Episode data is cached locally after first search/track, rather than hitting TMDB on every page load — faster, and keeps you under TMDB's free-tier rate limits.
- `lastSynced` lets you decide later how often to refresh episode/air-date data — resolved below (twice-daily cron).
- `Settings` is a single-row table (id always 1) since there's only one user — simplest way to store notification preference without a full user system.
- **Phase 2 note:** when accounts are added, `TrackedShow` and `WatchedEpisode` will need a `userId` field added back (and their unique constraints changed from `showId`/`episodeId` alone to `[userId, showId]` / `[userId, episodeId]`), and `Settings` becomes per-user instead of a single row. Worth keeping this in mind so the v1 schema migrates cleanly rather than needing a rewrite.

## 3. Routes / Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — shows you're watching + upcoming episodes list |
| `/search` | Search TMDB, add results to watching/watchlist |
| `/watchlist` | Shows marked "want to watch" |
| `/show/[id]` | Show detail — season/episode list, mark watched |
| `/settings` | Notification preferences, clear all data |
| `/api/cron/refresh-episodes` | Called by Vercel Cron twice daily — refreshes episode/air-date data for tracked shows |

## 4. Server Actions (core logic)

- `searchShows(query)` — calls TMDB search API, returns results (not yet cached in DB until tracked)
- `trackShow(tmdbShowId, status)` — upserts `Show` + `Episode` rows from TMDB, creates `TrackedShow`
- `untrackShow(showId)` — removes `TrackedShow` (keeps global `Show`/`Episode` cache)
- `markEpisodeWatched(episodeId)` / `unmarkEpisodeWatched(episodeId)`
- `getUpcomingEpisodes()` — queries `Episode` where `airDate > now` and show is tracked, sorted by date
- `updateNotificationPrefs(enabled)` — updates the single `Settings` row
- `clearAllData()` — wipes `TrackedShow`/`WatchedEpisode`/`Settings`, keeps global `Show`/`Episode` cache

No session/auth check needed in v1 — every action just operates on the single implicit user's data.

## 5. TMDB Integration

- Search endpoint: `GET /search/tv` — used on `/search`
- Show details + episodes: `GET /tv/{id}` and `GET /tv/{id}/season/{season_number}` — used when a show is tracked, to populate `Episode` rows with air dates
- Rate limits: TMDB's free tier is generous for this scale, but cache aggressively (don't refetch on every page view)

## 6. Refresh Schedule

Vercel Cron Job configured in `vercel.json`, running **twice a day** (e.g., 6am and 6pm), hitting `/api/cron/refresh-episodes`. That route loops through tracked shows and re-fetches episode/air-date data from TMDB, updating `lastSynced`. No manual refresh button needed for v1.

```json
{
  "crons": [
    { "path": "/api/cron/refresh-episodes", "schedule": "0 6,18 * * *" }
  ]
}
```

## 7. Key Dependencies

- `next` — framework
- `@prisma/client`, `prisma` — database ORM
- `tailwindcss` — styling (chosen over plain CSS — see rationale below)

**Tailwind vs. plain CSS — decided: Tailwind.** Utility classes styled directly in components, with a built-in consistent spacing/color system. Normally more of a learning curve, but since Claude Code will be writing most of the styling code, that downside mostly disappears — and Tailwind is the dominant approach in the current Next.js ecosystem, so generated UI tends to come out more polished and consistent.

## 8. Environment Variables

```
TMDB_API_KEY=
DATABASE_URL=file:./dev.db   # SQLite, local file
```

(Auth-related variables will be added in Phase 2 once the login method is decided.)

## 9. Deployment

- Vercel, connected to GitHub — push to `main` deploys automatically
- SQLite on Vercel note: Vercel's filesystem is ephemeral per deployment, so a local SQLite file **won't persist** across deploys/restarts in production
- **Decision:** for v1 (PoC), this is accepted — data resets on redeploy are fine at this stage
- **Deferred to Phase 2:** move to a hosted SQLite-compatible service (e.g., Turso) once the PoC has proven the concept and persistent data actually matters — minimal code change since it stays Prisma-compatible

## 10. Open Technical Questions (carry into exec plan)

- Phase 2 login method: Google OAuth vs. anonymous account-code — still undecided, needs a decision before Phase 2 build starts
- Exact cron time (currently 6am/6pm — adjust if a different schedule fits your viewing habits better)
