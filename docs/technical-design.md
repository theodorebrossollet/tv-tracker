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
  ├── Cron job (daily)  ── refreshes episode/air-date data
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
  firstAirDate DateTime?               // all five arrive in the same /tv/{id}
  lastAirDate  DateTime?               // response, so they cost no extra request
  status       String?                 // "Ended" | "Returning Series" | "In Production"
  network      String?
  genres       String?                 // comma-separated

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
  status    String   // "watching" | "watchlist" | "paused" | "stopped"
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
- `lastSynced` lets you decide later how often to refresh episode/air-date data — resolved below (daily cron; Vercel's free plan won't allow more).
- `Settings` is a single-row table (id always 1) since there's only one user — simplest way to store preferences without a full user system. `country` is the default region for streaming availability; null until set.
- `Show.tracked` is a **one-to-one** relation, not a list as originally drafted here — `TrackedShow.showId` is unique, so a show is on at most one list.
- **Phase 2 note:** when accounts are added, `TrackedShow` and `WatchedEpisode` will need a `userId` field added back (and their unique constraints changed from `showId`/`episodeId` alone to `[userId, showId]` / `[userId, episodeId]`), and `Settings` becomes per-user instead of a single row. Worth keeping this in mind so the v1 schema migrates cleanly rather than needing a rewrite.

## 3. Routes / Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — shows in progress + upcoming episodes list |
| `/watchlist` | Shows added but not started, plus a Paused section |
| `/archive` | Finished and Stopped shows |
| `/show/[id]` | Show detail — synopsis, streaming availability, season/episode list, mark watched |
| `/settings` | Country, notification preferences, clear all data |
| `/api/cron/refresh-episodes` | Called by Vercel Cron daily — refreshes episode/air-date data for tracked shows |

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

**Gap worth knowing when adding a column to `Show` or `Episode`.** Both refresh
paths key on *time*, not on completeness: the cron visits tracked shows on a
schedule, and the on-view refresh only fires once a row is 24h stale. Neither
notices that a newly added column is empty on an otherwise fresh row. So after a
migration that adds fields, previously-cached rows keep rendering blanks until
they happen to age out — for untracked shows, up to a day.

Fix by running a one-off backfill after the migration rather than waiting, as
was done for `runtime`/`overview`, for the air-date rezoning
(`scripts/backfill-air-dates.mjs`), and for the show metadata columns.

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

Two further statuses cover shows you started and set aside: **paused** (you
mean to come back) and **stopped** (you don't). They behave identically in the
data model — the difference is intent, which is what makes the two lists worth
scanning separately months later. Either can be switched to the other directly,
without passing through Watching.

The rest of this section describes both.

A set-aside show It keeps the
watch history but stays out of Watching and out of Upcoming episodes — if you've
stopped, the next episode isn't something you're waiting for. Pausing is only
possible from `watching`: pausing something never started is what the watchlist
already means.

Resuming works two ways. Marking any episode watched un-pauses automatically —
the same rule that promotes a watchlist show — and there's an explicit Resume
button too, because picking up a show you're *behind* on shouldn't require
pretending you watched something.

Demotion is scoped to `watching` so it can't silently undo an explicit pause.

**Neither is "finished".** Finished isn't a status at all: it's derived from
having watched every aired episode. That's deliberate — a show you finished
returns to Watching by itself when a new season airs, which a stored status
would not do.

### Where a show appears

The categories overlap (a stopped show can also be fully watched), so
`getShowBuckets` applies one precedence order and every show lands in exactly
one place:

    stopped → finished → paused → watchlist → watching

Stopped beats finished because abandoning a show is a decision you made, while
finishing it is a fact about episode counts — the decision is the more useful
label. Finished beats paused for the same reason in reverse: a show you
completed doesn't belong in the list of things you mean to get back to.

| Bucket | Page |
|---|---|
| watching | `/` |
| watchlist, paused | `/watchlist` |
| finished, stopped | `/archive` |

Moving finished shows off the Watching page is what removed the old "hide
finished shows" toggle: the page can now only contain work in progress, so
there is nothing to filter.

Unmarking the **last** watched episode sends the show back to the watchlist.
That's the exact inverse of the promotion rule — "watching" means at least one
episode watched — and it's what makes a mistaken tap undoable. An earlier
version deliberately didn't demote, on the theory that an accidental click
shouldn't reorganise your lists; in practice that left a show stuck under
Watching with zero progress and no way back short of removing and re-adding it.

### Ordering the Watching list

Sorted by what you could act on, not by when you added it: shows with an
unwatched aired episode, then shows you're caught up on, then finished ones.
Within a band, most recent watch activity first, falling back to when the show
was added.

Add-order alone buried a show with three unwatched episodes underneath one
finished months earlier.

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

TMDB supplies an air **date**, never a time, so "when does this become
watchable" needs a convention. Air dates are stored as **midnight US Eastern**
(`America/New_York`), converted to the equivalent UTC instant by `parseAirDate`
in `src/lib/tmdb.ts`. An episode dated 30 July unlocks at 04:00 UTC — midnight
in New York, 06:00 in Paris.

The zone name is used rather than a fixed `-05:00` so daylight saving is
handled: EST in winter, EDT in summer. Verified across both switchovers.

This replaced an earlier rule of midnight **UTC**, which unlocked episodes
before the broadcast date had started anywhere in the Americas. It's still an
approximation — TMDB doesn't publish the broadcaster's actual release time —
but most tracked shows premiere on a US schedule, so it errs much closer.

Two properties worth preserving if this is ever changed:

- Because the zone is behind UTC, the stored instant's **UTC calendar date
  still equals the broadcast date**. `formatAirDate` formats in UTC, so the
  displayed day is unaffected by the conversion.
- Every `airDate <= now` comparison in queries, the show page and
  `setSeasonWatched` needs no special casing — the shift lives entirely in
  parsing.

`scripts/backfill-air-dates.mjs` converts rows cached under the old rule. It's
idempotent: it only touches rows sitting at exactly 00:00 UTC, which converted
rows never are.

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

Vercel Cron Job configured in `vercel.json`, hitting
`/api/cron/refresh-episodes`. That route loops through tracked shows and
re-fetches episode/air-date data from TMDB, updating `lastSynced`. No manual
refresh button needed for v1.

**Once daily, not the twice-daily schedule originally specified.** Vercel's
Hobby plan rejects any cron running more than once a day — deploying
`0 6,18 * * *` fails outright with "Hobby accounts are limited to daily cron
jobs".

06:00 UTC is deliberate: air dates are anchored to midnight US Eastern
(04:00–05:00 UTC), so an episode airing that day has already unlocked before
the refresh runs. The cost is latency rather than correctness — an air date TMDB
corrects during the day is picked up the next morning instead of that evening.

Twice daily without paying is still possible: point any external scheduler at
the same endpoint with the `CRON_SECRET` bearer token. The route has no Vercel
dependency.

**Runtime headroom.** Measured on the first unattended run (31 Jul 2026): 28
tracked shows took ~32s, about 1.1s each, because `getAllEpisodes` fetches
seasons sequentially to stay inside TMDB's rate limits. The route sets
`maxDuration = 60`, so the schedule starts timing out somewhere near 50 shows.

When that gets close, fetch a show's seasons in parallel — they're independent
requests and the sequential loop was chosen for politeness, not correctness.
A timeout here fails quietly: the cron just stops refreshing air dates, and
nothing in the UI says so.

```json
{
  "crons": [
    { "path": "/api/cron/refresh-episodes", "schedule": "0 6 * * *" }
  ]
}
```

Keep `vercel.json` free of extra keys — Vercel validates it against a schema and
rejects unknown properties, so explanatory comments belong here, not there.

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

### Long lists

`ShowList` (Watchlist, Archive) renders 10 rows and offers the rest behind a
button; `UpcomingList` does the same with 15. Every row is already on the page,
so expanding costs no request — the server-side cap is what bounds the payload.

Each list instance holds its own count rather than sharing one, so a long
Finished section can't bury the Stopped section beneath it. That falls out of
`useState` being per-instance; the test exists to document the intent.

The Archive is the list that needed this: Watching and Watchlist churn, but
finished shows accumulate forever.

## 12. Tests

`npm test` (Vitest). 59 tests, no network and no dev server needed — TMDB is
mocked at `fetch`, and the database tests build a throwaway SQLite file under
`tests/.tmp` from the real migration files, so they exercise the same schema
production gets.

Covered:

- **Tracking rules** — promotion on marking, demotion when the last watched
  episode is undone, aired-only season marking, no double counting.
- **Air date anchoring** — midnight US Eastern in summer and winter, and across
  the spring switchover.
- **TMDB client** — v3-key vs v4-token auth, error mapping, trailer ranking
  (rejects featurettes and recaps), provider grouping, the in-process cache.
- **Query aggregation** — aired vs upcoming counts, "fully watched", next-up,
  upcoming across both lists.
- **Formatting** — timezone-stable dates, relative air dates.
- **Components** (jsdom) — status badge covers all four statuses, list
  pagination including the partial final page.

These exist because the same class of bug shipped twice: state copied into
`useState` instead of derived from props. Both instances were found by hand, in
the browser, after release. The suite was verified by reintroducing three real
regressions and confirming each one fails a test.

## 13. Access Control

`src/proxy.ts` (Next 16 renamed Middleware to Proxy) gates the whole app behind
one shared password from `APP_PASSWORD`, sent as HTTP Basic auth.

This is not authentication — Phase 2 still owns that. It exists because v1 has
no accounts *and* server actions are reachable by direct POST, `clearAllData`
included. A public URL would therefore let anyone erase the data. Running
before routing means the gate covers action POSTs, not just pages.

Two details that matter if this is ever edited:

- `/api/cron/*` is excluded from the matcher. Vercel Cron sends its own
  `Authorization: Bearer $CRON_SECRET`, which Basic auth would reject — the
  twice-daily refresh would silently stop. That route authenticates itself.
- With no `APP_PASSWORD` set, the app serves normally in development but
  returns **503** in production rather than sitting open. It deliberately sends
  no `WWW-Authenticate` in that case, since no password could satisfy it.

## 14. Logging

`src/lib/logger.ts` emits one JSON object per line — `level`, `event`, `time`,
plus context. Structure is the point: Vercel's runtime logs can then be filtered
by event name or show id, which free-text messages can't be.

Events are namespaced by area (`cron.refresh.completed`,
`show.refresh_failed_serving_stale`, `action.failed`). Errors and warnings go to
stderr so they can be separated by stream alone.

`describeError` deliberately keeps only the error name and message. Stacks are
noise in aggregated logs, and — more importantly — a thrown TMDB URL can carry a
v3 API key as a query parameter, so nothing that might contain one is logged.

There is no log retention beyond whatever the host keeps. If that matters later,
point a drain at the same stream rather than changing call sites.

## 15. Open Technical Questions (carry into exec plan)

- Phase 2 login method: Google OAuth vs. anonymous account-code — still undecided, needs a decision before Phase 2 build starts
- Exact cron time (currently 6am/6pm — adjust if a different schedule fits your viewing habits better)
