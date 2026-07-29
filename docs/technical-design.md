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
SQLite via Prisma — local file in dev, Turso in production
```

> **Updated during build (29 Jul 2026).** This doc originally planned a local
> SQLite file in production, accepting that data would reset on each redeploy.
> That turned out to be too optimistic: Vercel's filesystem is read-only outside
> `/tmp`, so writes fail entirely rather than merely being temporary — tracking
> a show would not work at all. Turso (planned for Phase 2) was pulled forward
> into v1. Sections 10 and 11 reflect the change; the data model is unaffected.

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
  tracked      TrackedShow?   // one-to-one: showId is unique on TrackedShow
}

model Episode {
  id            String   @id          // TMDB episode id
  showId        String
  seasonNumber  Int
  episodeNumber Int
  name          String?
  airDate       DateTime?
  runtime       Int?                  // minutes; free with the season fetch
  overview      String?

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
  country       String?                  // ISO 3166-1 alpha-2, e.g. "FR"
}
```

**Notes:**
- Show/Episode data is cached locally after first search/track, rather than hitting TMDB on every page load — faster, and keeps you under TMDB's free-tier rate limits.
- `lastSynced` lets you decide later how often to refresh episode/air-date data — resolved below (twice-daily cron).
- `Settings` is a single-row table (id always 1) since there's only one user — simplest way to store preferences without a full user system. `country` is the default region for streaming availability; null until set.
- `Show.tracked` is a **one-to-one** relation, not a list as originally drafted here — `TrackedShow.showId` is unique, so a show is on at most one list.
- **Phase 2 note:** when accounts are added, `TrackedShow` and `WatchedEpisode` will need a `userId` field added back (and their unique constraints changed from `showId`/`episodeId` alone to `[userId, showId]` / `[userId, episodeId]`), and `Settings` becomes per-user instead of a single row. Worth keeping this in mind so the v1 schema migrates cleanly rather than needing a rewrite.

## 3. Routes / Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — shows in progress + upcoming episodes list |
| `/watchlist` | Shows added but not started |
| `/show/[id]` | Show detail — synopsis, streaming availability, season/episode list, mark watched |
| `/settings` | Country, notification preferences, clear all data |
| `/api/cron/refresh-episodes` | Called by Vercel Cron twice daily — refreshes episode/air-date data for tracked shows |

There is no `/search` route. Search is an overlay (`components/search-overlay.tsx`)
opened from the magnifying glass in the nav, so you can search from anywhere
without losing the page you were on. It queries as you type, debounced 250ms.

`/show/[id]` works for **any** TMDB show id, not just tracked ones: if the show
isn't cached locally, it's fetched from TMDB on first view. That's what lets a
search result link straight through to a full show page.

Viewing a show also re-syncs it if the cache is more than 24h old **and** the
show isn't tracked. Tracked shows are left to the cron; untracked ones have no
other refresh path, so without this a show cached from a search result would
keep its first-seen data forever.

**Trailers are click-to-load.** A normal YouTube `<iframe>` would contact
YouTube and set its cookies on every show page view, which contradicts the
"no third-party trackers, no cookie banner" line in `scope.md`. So the page
shows a poster frame and only swaps in a `youtube-nocookie.com` player once you
press play.

The poster frame is YouTube's own thumbnail, which sounds like it breaks that —
it doesn't, because `next/image` fetches remote images **server-side**. The
browser only ever requests `/_next/image` from this app; YouTube sees the
server's address, not the visitor's, and sets no cookies in their browser.
Rendering the thumbnail as a plain `<img src="https://i.ytimg.com/…">` would
silently undo this.


## 4. Tracking Model

One button — "+" — puts a show on the **watchlist**. Nothing else adds a show
manually. A show moves to **watching** by itself the moment any episode is
marked watched, including when it wasn't on a list at all: marking an episode
watched is a clearer statement of intent than pressing a button, so it creates
the tracked row too.

Unmarking the **last** watched episode sends the show back to the watchlist.
That's the exact inverse of the promotion rule — "watching" means at least one
episode watched — and it's what makes a mistaken tap undoable. An earlier
version deliberately didn't demote, on the theory that an accidental click
shouldn't reorganise your lists; in practice that left a show stuck under
Watching with zero progress and no way back short of removing and re-adding it.

## 5. Marking Episodes Watched

Both paths — the per-episode control and a season's "Mark all watched" — act on
exactly the episodes that have **already aired**. Unaired episodes render with
their control disabled, since you can't have watched something that hasn't been
broadcast. Keeping the two paths on the same set is deliberate: they previously
disagreed, with individual rows allowing what the bulk action skipped.

`EpisodeRow` and `AddButton` derive their state from props via `useOptimistic`,
**not** `useState`. This matters: `useState` initialises once and then ignores
prop changes, so a revalidation could never correct the display. Two real bugs
came from this — "Mark all watched" updating the database and the season counter
while every row still showed unwatched, and the add button still reading "On
watchlist" after marking an episode had promoted the show to Watching. Any
component whose state the server can change behind its back must derive from
props.

### When an episode becomes markable

TMDB supplies an air **date**, never a time, so the date is stored as midnight
UTC and an episode unlocks the moment that passes. For an episode dated
30 July, that's 02:00 in Paris (UTC+2 in summer) — not local midnight, and not
the broadcaster's actual drop time, which TMDB doesn't publish. Anywhere east
of UTC unlocks part-way into its own local day.

This is deliberately the simple rule rather than a wrong-in-a-different-way one:
without a real air time, any choice is an approximation, and this one is
consistent and explainable.

## 6. Server Actions (core logic)

- `searchSuggestions(query)` — backs the overlay's typeahead; annotates results with their current list
- `addToWatchlist(tmdbShowId)` — upserts `Show` + `Episode` rows from TMDB, creates `TrackedShow` with status `watchlist`
- `removeShow(showId)` — removes `TrackedShow` (keeps global `Show`/`Episode` cache)
- `markEpisodeWatched(episodeId)` — records progress **and** promotes the show to `watching`
- `unmarkEpisodeWatched(episodeId)` — removes progress only
- `setSeasonWatched(showId, season, watched)` — bulk mark/unmark aired episodes of one season
- `updateNotificationPrefs(enabled)` / `updateCountry(code)` — updates the single `Settings` row
- `refreshShow(showId)` — manual re-sync from TMDB
- `clearAllData()` — wipes `TrackedShow`/`WatchedEpisode`/`Settings`, keeps global `Show`/`Episode` cache

No session/auth check needed in v1 — every action just operates on the single implicit user's data.

## 7. TMDB Integration

- Search: `GET /search/tv` — used by the search overlay
- Show details + episodes: `GET /tv/{id}` and `GET /tv/{id}/season/{season_number}` — populate `Episode` rows with air dates, runtime and per-episode synopsis (all three come in the same response, no extra requests)
- Trailers: `GET /tv/{id}/videos` and `GET /tv/{id}/season/{n}/videos` — the best YouTube trailer is picked by preferring official trailers over teasers, and anything that isn't a trailer or teaser (featurettes, recaps, opening credits — which dominate season video lists) is rejected rather than shown under a "Trailer" heading. Season coverage is patchy; only seasons that yield one appear in the picker.

**Caching these is done in-process, not by Next.** `lib/tmdb.ts` keeps a small
TTL map for the region list and video lists. Next's own fetch cache can't do it
here: these pages are `dynamic = "force-dynamic"`, which forces
`fetchCache: "force-no-store"` and discards any `next: { revalidate }` a fetch
asks for. Setting `export const fetchCache = "default-cache"` does *not*
override it — measured, not assumed. Before the in-process cache, one Game of
Thrones page view cost 11 TMDB requests every single time; it is now 11 cold
and 1 warm.
- Streaming availability: `GET /tv/{id}/watch/providers` — returns **every** country in one response, so the country dropdown on a show page switches instantly without further requests
- Country list: `GET /watch/providers/regions` — cached for 24h, it changes about never
- Rate limits: TMDB's free tier is generous for this scale, but cache aggressively (don't refetch on every page view)

Availability data is JustWatch's, supplied via TMDB. Their terms require
attribution, which is why the show page credits JustWatch under the provider
list — don't remove it.

## 8. Refresh Schedule

Vercel Cron Job configured in `vercel.json`, running **twice a day** (e.g., 6am and 6pm), hitting `/api/cron/refresh-episodes`. That route loops through tracked shows and re-fetches episode/air-date data from TMDB, updating `lastSynced`. No manual refresh button needed for v1.

```json
{
  "crons": [
    { "path": "/api/cron/refresh-episodes", "schedule": "0 6,18 * * *" }
  ]
}
```

## 9. Key Dependencies

- `next` — framework
- `@prisma/client`, `prisma` — database ORM
- `tailwindcss` — styling (chosen over plain CSS — see rationale below)

**Tailwind vs. plain CSS — decided: Tailwind.** Utility classes styled directly in components, with a built-in consistent spacing/color system. Normally more of a learning curve, but since Claude Code will be writing most of the styling code, that downside mostly disappears — and Tailwind is the dominant approach in the current Next.js ecosystem, so generated UI tends to come out more polished and consistent.

## 10. Environment Variables

```
TMDB_API_KEY=                        # TMDB v3 key or v4 read access token
DATABASE_URL=file:./dev.db           # local dev; libsql://… in production
TURSO_AUTH_TOKEN=                    # only needed when DATABASE_URL is libsql://
CRON_SECRET=                         # protects the refresh endpoint in production
```

See `.env.example` for the annotated version. `CRON_SECRET` was added during the
build: without it `/api/cron/refresh-episodes` would be a public endpoint anyone
could hit repeatedly, burning through the TMDB rate limit.

(Auth-related variables will be added in Phase 2 once the login method is decided.)

## 11. Deployment

- Vercel, connected to GitHub — push to `main` deploys automatically
- **Database: Turso** (hosted, SQLite-compatible, free tier). Not the original
  plan — see the note in section 1 for why a local SQLite file can't work on
  Vercel at all, not even temporarily.
- The app talks to both local files and Turso through one Prisma driver adapter
  (`@prisma/adapter-libsql`), so dev and production run identical code paths.

**Migrations are applied manually, not during the build.** `prisma migrate
deploy` only understands local SQLite file paths — it rejects `libsql://` URLs
with "P1013: the scheme is not recognized". So `scripts/migrate.mjs` applies
Prisma's generated migration SQL over the libSQL client instead, tracking what
it has already run in an `_applied_migrations` table:

```bash
# after changing the schema
npx prisma migrate dev                       # creates the migration locally
DATABASE_URL="libsql://…" npm run db:deploy  # applies it to Turso
```

Keeping this out of the Vercel build is deliberate: a build step that mutates
the production database is easy to trigger accidentally and hard to undo.

## 12. Open Technical Questions (carry into exec plan)

- Phase 2 login method: Google OAuth vs. anonymous account-code — still undecided, needs a decision before Phase 2 build starts
- Exact cron time (currently 6am/6pm — adjust if a different schedule fits your viewing habits better)
