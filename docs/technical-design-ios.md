# TV Tracker — Technical design: iOS app (v3)

Based on `docs/scope-ios.md`; read that first. This covers what the iOS app
needs from the server, how the app is put together, and how push works. It is
a plan, not a description of code: nothing here exists yet.

## 1. Architecture

```
SwiftUI app (iPhone, TestFlight)            Browser / installed PWA
  │  Authorization: Bearer <token>             │  tvt_session cookie
  ▼                                            ▼
Next.js on Vercel ─────────────────────────────────────────────
  ├── /api/v1/*  route handlers (NEW) ─┐
  ├── pages + server actions ──────────┤── src/lib/services/* (NEW, shared)
  │                                    └── src/lib/queries.ts (unchanged rules)
  ├── /api/cron/refresh-episodes (existing)
  └── /api/cron/notify (NEW) ── APNs (HTTP/2, token auth)
                │
            Turso (same database, three additive migrations)
```

The iOS app never talks to TMDB or Turso directly. It is a client of the same
deployment the web uses, so every rule in `AGENTS.md` (finished vs caught up,
Eastern air dates, ratings derived, rewatch archives, per-user scoping) is
enforced in one place.

## 2. The API

### One implementation of each write

Today each write lives in a server action: gate, validation, Prisma calls,
`revalidatePath`, all in one function. A route handler that copied that body
would be the "two derivations of one rule" problem `AGENTS.md` warns about,
applied to every write.

So the first server step is a refactor with no behaviour change: move each
action's body below the gate into `src/lib/services/<area>.ts` as a function
that takes `userId` plus validated arguments and returns a result. Then:

- the server action keeps its gate (above the `try`), calls the service, and
  revalidates
- the `/api/v1` handler does its own gate, calls the same service, and returns
  JSON

The services import `server-only`. They never call `revalidatePath` (a
request from the API has no page cache to invalidate on the phone; the web's
cache is revalidated by the handler calling `revalidateShowViews()` after a
write, so the PWA isn't stale after a write from the phone; that helper is
private to `actions.ts` today and moves to a shared module for this).

The 38 exported actions across the six action modules map onto it (the
seventh, `view-actions.ts`, is a web-only cookie). This can land one module at
a time, each a reviewable pull request, before any iOS code exists.

### Authentication: bearer sessions in the existing table

- `POST /api/v1/auth/login` takes `{ nickname, password }` and runs the same
  checks as `loginWithPassword`, including `lib/login-throttle.ts` (counter
  incremented in the database, as the rule requires). On success it creates a
  `Session` row exactly like the web does (SHA-256 of a random token as the
  id, 90-day sliding expiry) and returns the raw token once.
- Every other `/api/v1` route reads `Authorization: Bearer <token>`, hashes
  it, and looks it up: `requireApiSession(request)` in `lib/auth.ts`, the
  header twin of `requireOnboardedSession()`. A session for an account that
  hasn't finished onboarding is refused (the app sends that person to the
  web's `/welcome`).
- The API never reads the cookie, and the web never reads the header. Bearer
  tokens are not sent automatically by a browser, so the API needs no CSRF
  defence; that only stays true if the cookie is never accepted there.
- Revocation is free: `changePassword`, code recovery and Sign out everywhere
  already delete every `Session` row for the account, so they sign the phone
  out too, which is what the settings copy promises.
- Additive migration: `Session.client` (`"web"` | `"ios"`, nullable), so a
  future "signed-in devices" list can say which is which, and so the cron can
  drop device tokens whose session is gone.

Gates on `route.ts` files are what `tests/route-gates.test.ts` checks;
`requireApiSession` joins its list of gate names. Every new query also gets a
case in `tests/isolation.test.ts`.

### Shape: screen-shaped reads, resource-shaped writes

Reads return what one screen needs in one request, built from the query
functions the pages already use, so derived fields (`aired`, finished,
caught up, averages, `runNumber`) are computed on the server and never in
Swift:

| Endpoint | Built from |
|---|---|
| `GET /api/v1/watching` | `getShowBuckets`, `splitHero`, upcoming episodes, `lib/upcoming-movies.ts` |
| `GET /api/v1/library?type=&section=` | `getTrackedShows` and the movie equivalent |
| `GET /api/v1/shows/:id` | `ensureShowCached`, `getShowDetail` |
| `GET /api/v1/movies/:id` | `getMovieDetail` |
| `GET /api/v1/search?q=` | `searchSuggestions` |
| `GET /api/v1/discover?shuffle=&list=` | `lib/discover.ts` (same seeded pick) |
| `GET /api/v1/lists`, `GET /api/v1/lists/:id` | `getLists`, `getListDetail` |
| `GET /api/v1/me` | user, `getProfileStats`, settings |

Writes are small verbs on resources: `PUT`/`DELETE
/api/v1/episodes/:id/watched`, `PUT /api/v1/shows/:id/seasons/:n/watched`,
`PUT /api/v1/shows/:id/status`, `PUT /api/v1/episodes/:id/rating`, and so on,
each returning the fresh state of what it changed so the app can reconcile its
optimistic update.

Rules carried over:

- **Images**: full URLs built by `lib/images.ts`, so the app never hard-codes
  TMDB's image host or sizes.
- **Dates**: ISO 8601 strings exactly as stored. Air dates keep the Eastern
  midnight anchor, so Swift formats the *UTC calendar date* (the same trick
  `formatAirDate` relies on) and never converts to local time.
- **Validation**: every argument is validated in the service, not the handler,
  so both entry points get it. Paging params are bounded with `limitFrom` (today in
  `components/show-more-link.tsx`, a server module; it moves to `lib/` so a
  route handler doesn't import from `components/`).
- **Errors**: `{ error: { code, message } }` with an HTTP status. The
  `SCHEMA_MISMATCH` digest maps to `503` + `code: "updating"`, and the app
  shows "The app is being updated" rather than a generic failure.
- **Versioning**: `/api/v1`. TestFlight builds linger up to 90 days, so a
  breaking change gets `/v2` beside `/v1`, not an edit to `/v1`.
- **Logging**: `api.<area>.<verb>` events, one JSON line, never a TMDB URL,
  never a token.

The contract is typed once in TypeScript (`src/lib/api/types.ts`), with
fixture JSON files under `tests/api-fixtures/` that a vitest test checks the
handlers against. The Swift tests decode the same fixtures, so a field renamed
on one side fails a test on the other.

## 3. Push notifications

### Data (two additive migrations, applied before merging)

- `DeviceToken`: `id`, `userId`, `token` (APNs hex, unique), `environment`
  (`sandbox` | `production`), `sessionId` (nullable, cascades), `createdAt`,
  `lastSeenAt`. Registered with `PUT /api/v1/devices`, removed on sign-out and
  when APNs answers `410 Unregistered`.
- Notification preferences on `Settings`, next to `notifyEnabled`:
  `notifyEpisodes`, `notifyMovies`, `notifyPremieresOnly`, `notifyMode`
  (`release` | `digest`), `notifyHour` (0–23, the person's local hour) and
  `timeZone` (IANA name, sent by the app). Additive `ADD COLUMN`s with
  defaults: read the generated SQL, since `NOT NULL DEFAULT` can rebuild the
  table in SQLite (back up first either way).
- `NotificationLog`: `userId`, `kind`, `refKey` (e.g. `show:1396:2026-11-20`),
  `sentAt`, unique on (`userId`, `kind`, `refKey`). Inserting the row *is* the
  claim to send it: a retry or a second cron run hits the unique constraint
  and sends nothing. Exactly-once per show per day falls out of this.

### What counts as "came out today"

Owned by `lib/queries.ts`, like every other "aired" rule: episodes whose
stored `airDate` falls on today's US Eastern date, for shows the user is
`watching` (not paused or stopped; optionally also watchlist), grouped per show.
Movies use `getMovieReleaseDates` (digital type) in the user's Settings
country. Like the Library query, the episode join carries
`AND w."userId" = ${userId}`, and dates are bound as `Date`, never as epoch
milliseconds.

### Scheduling

Today's only cron runs at 06:00 UTC, once a day, which is all the Hobby plan
guarantees. That is enough for "release" mode if the notify job runs right
after the refresh (so newly added episodes are in the cache), but not for a
digest at a chosen hour.

Recommended: an hourly GitHub Actions scheduled workflow that `POST`s to
`/api/cron/notify` with `CRON_SECRET` (the same allow-listed shape as the
refresh route). It is free for a public repository, and each run sends what is
due at that hour for each user's `timeZone`. GitHub's schedules can lag by
minutes, which doesn't matter here. The alternative is Vercel Pro's
sub-daily crons.

### Sending

- APNs token-based auth: a `.p8` key, its key id and the team id sign a short
  ES256 JWT, which is reused for up to an hour. HTTP/2 via `node:http2`, with no
  new dependency. Secrets live in Vercel env vars (`APNS_KEY`, `APNS_KEY_ID`,
  `APNS_TEAM_ID`, `APNS_TOPIC` = bundle id) and are never in the repository
  or a log line.
- **TestFlight builds use the production APNs host; Xcode debug builds use
  sandbox.** The app reports which it is, and each token is sent to its own
  host. Getting this wrong fails silently: APNs accepts nothing and the phone
  stays quiet.
- Payload: `thread-id` per show (iOS groups a show's notifications), category
  `EPISODE` with actions `MARK_WATCHED` (background) and `OPEN` (foreground),
  and the episode id in `userInfo`. No spoilers: the episode title is shown,
  not the synopsis.
- "Mark watched" from the lock screen runs in the app's background handler,
  which calls `PUT /api/v1/episodes/:id/watched` with the Keychain token. So
  the token is stored as `AfterFirstUnlockThisDeviceOnly`, or the handler can't
  read it while the phone is locked.

## 4. The iOS app

- **Targets**: iOS 26+ (Liquid Glass, current SwiftUI). iPhone only, portrait
  first. Dark appearance forced.
- **Structure**: one Xcode project under `ios/` in this repository, so a pull
  request can change an endpoint and its client together. CI keeps running
  web checks only. iOS builds and TestFlight uploads happen from Xcode on the
  owner's Mac (Xcode Cloud later, if uploading by hand gets old). The
  repository is public: no team ids in plain sight beyond what Xcode requires,
  and no keys.
- **Layers**: `APIClient` (async/await `URLSession`, `Codable`, bearer header,
  maps `401` to signed-out and `503 updating` to the update message),
  `@Observable` stores per screen, SwiftUI views. No third-party packages to
  start with.
- **State the server can change**: the same lesson as the web's
  `useOptimistic` rule. Views render the store's copy of server state. An
  optimistic change is applied, then replaced by what the write returns, and
  rolled back with a visible error if it fails. Never a separate local flag
  that a refresh can't correct.
- **Caching**: the last good response per screen is kept on disk and shown on
  launch while a fresh one loads. Reads only, never queued writes.
- **Design**: Marquee tokens as a Swift `Color`/`Font` extension generated
  from the design system's `tokens.json`, Inter Tight bundled (OFL), SF
  Symbols for icons. The app icon is rendered from
  `scripts/icons/icon-app.svg` (outlined paths, still no `<text>`).
- **Accessibility**: Dynamic Type through `Font.custom(_:size:relativeTo:)`,
  VoiceOver labels on every icon button, and the check button stays the
  accessible alternative to swipe-to-mark, as on the web.

## 5. Apple-side setup (the owner, before building)

1. Enrol in the Apple Developer Program.
2. Register an App ID (bundle id) with the Push Notifications capability.
3. Create an APNs auth key (`.p8`). It is downloadable once: store it in a
   password manager, and put it in Vercel env vars only when step 3's server
   work lands.
4. Create the app record in App Store Connect (needed for TestFlight) and add
   yourself as an internal tester.
5. In the app: `ITSAppUsesNonExemptEncryption = NO` (HTTPS only), a privacy
   manifest (`PrivacyInfo.xcprivacy`), and TMDB attribution on the About
   screen, matching the web.

## 6. Phases

Each phase ends with something usable. Schema changes follow `AGENTS.md`:
additive, migrated on Turso before the merge that uses them.

0. **Prep (now)**: this doc and the scope, design decided on the canvas,
   Apple setup.
1. **Services refactor**: action bodies into `lib/services`, no behaviour
   change. The web suite must stay green throughout.
2. **API, read side + auth**: `requireApiSession`, login/logout/me, the read
   endpoints, fixtures, gate and isolation tests. `Session.client` migration.
3. **iOS skeleton to TestFlight**: project, sign-in, Watching read-only, an
   internal TestFlight build. This proves signing and upload early, before
   there is much to lose.
4. **Parity**: write endpoints and the screens in the scope's list.
5. **Push**: migrations, the notify query, sender, hourly schedule,
   notification actions, preferences UI.
6. **Polish**: haptics, empty states, accessibility pass, app icon. A week of
   daily use against the success criteria.

## 7. Security read (to repeat on each pull request in phases 2 and 5)

- Every `/api/v1` handler names `requireApiSession` and scopes every query by
  the `userId` it returns. Raw SQL keeps `userId` in the join.
- Tokens: 256-bit random, stored hashed, returned once, never logged, sent
  only over HTTPS, kept in the Keychain on the phone.
- Login over the API is throttled exactly like the web form (the source is
  public: assume the attacker has read it).
- Device tokens are per user and deleted with the session. A push to a token
  belonging to another account is impossible by construction, because the
  notify query starts from the user.
- The APNs key is a Vercel secret. The cron route keeps its `CRON_SECRET`
  check and stays on the route-gates allow-list.
- No `next.config.ts` header changes are needed for a JSON API. If one is made
  anyway, it goes in both the catch-all and the `/sw.js` entry.
