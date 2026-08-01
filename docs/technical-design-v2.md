# TV Tracker — Technical Design (v2)

Based on `docs/scope-v2.md`. Read that first, plus `docs/technical-design.md`
(v1) — this doc only covers the delta: accounts and the PWA.

## 1. Architecture Overview

No new services. Accounts add one new table and a `userId` column threaded
through the existing schema; the PWA adds a manifest, icons, and a service
worker on top of the existing Next.js app. Server Actions remain the only
write path — v2 does not introduce a REST/API layer, since nothing here needs
a client that isn't this Next.js app.

```
Browser (installed PWA or regular tab)
  │
  ▼
Next.js App Router (Vercel)
  │
  ├── proxy.ts ── APP_PASSWORD gate (kept until removal checklist is done)
  ├── requireSession() ── new: called at the top of every server action
  ├── Server Actions ── read/write via Prisma, now scoped by userId
  ├── TMDB API client ── unchanged, still global/shared cache
  │
  ▼
SQLite via Prisma (Turso in production) — User/Session tables added
```

## 2. Data Model Changes

```prisma
model User {
  id        String   @id @default(cuid())
  codeHash  String   @unique   // hash of the account code, never the code itself
  /// Chosen on first login, not at account creation — null until then. Required
  /// before the account can use anything else (see "Nickname setup" below).
  /// Displayed on a future profile page and used to find the account once
  /// social features exist; collected now so that feature never needs a
  /// backfill or a forced-rename migration on existing accounts.
  nickname  String?  @unique
  createdAt DateTime @default(now())

  trackedShows    TrackedShow[]
  watchedEpisodes WatchedEpisode[]
  settings        Settings?
  sessions        Session[]
}

model Session {
  id         String   @id            // hash of the opaque session token, not the token itself — same reasoning as codeHash
  userId     String
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model TrackedShow {
  id      String   @id @default(cuid())
  userId  String
  showId  String
  status  String
  addedAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  show Show @relation(fields: [showId], references: [id], onDelete: Cascade)

  @@unique([userId, showId])   // was: showId alone
}

model WatchedEpisode {
  id        String   @id @default(cuid())
  userId    String
  episodeId String
  watchedAt DateTime @default(now())

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  episode Episode @relation(fields: [episodeId], references: [id], onDelete: Cascade)

  @@unique([userId, episodeId])   // was: episodeId alone
}

model Settings {
  userId        String  @id       // was: fixed id=1 single row
  notifyEnabled Boolean @default(false)
  country       String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

`Show` and `Episode` are **unchanged** — they stay a global cache. Two users
tracking the same show should not fetch or store it twice; only the
*relationship* to a show (tracked/watched/settings) is per-user.

### Why `nickname` is nullable despite being required

It has to start `null` — a code exists before its owner has chosen a nickname,
and the admin-bootstrap script (see migration path below) creates a `User`
row with no nickname at all. "Required" is enforced by the application (no
route but the nickname-setup one is reachable while it's `null`), not by a
`NOT NULL` column. SQLite's unique index treats multiple `NULL`s as distinct
values by default, so several not-yet-onboarded accounts can coexist without
a temporary placeholder value or collision.

Case sensitivity is an open implementation decision: a plain `@unique` on
`nickname` is case-sensitive, so `"Theo"` and `"theo"` would currently be
allowed to coexist. If that's not wanted, the two options are SQLite's
`COLLATE NOCASE` on the column, or a second normalized (lowercased) column
that carries the actual unique constraint while `nickname` keeps the
user's chosen casing for display. Left for implementation time — see
Open Questions.

### Why a `Session` table instead of a stateless signed cookie

A stateless cookie (sign `userId` into a JWT/iron-session payload) needs no
extra table, but it can't be individually revoked — the only way to invalidate
one is to rotate the server secret, which logs out everyone at once. Given
codes have **no recovery path**, being able to kill one compromised session
(or all of one user's sessions) without affecting anyone else matters more
here than it would with a Google-login system that has its own recovery. A
`Session` row costs one indexed read per request, which is irrelevant at this
project's scale.

The cookie itself stores an opaque random token (not the DB row's id in
plaintext); the DB stores a hash of it, mirroring `codeHash`. A dump of the
database then reveals neither account codes nor live session tokens.

## 3. Migration Path (existing v1 data)

The deployed app already has real data under the "one implicit user" model.
This is the sharper version of the "adding a column needs a backfill" rule in
`AGENTS.md` — it's not just blank fields, it's establishing data ownership on
rows that already exist.

1. Write the schema migration (adds `User`, `Session`, and the new columns —
   initially nullable/unconstrained so existing rows don't break).
2. One-off script (`scripts/create-admin-user.mjs`, following the pattern of
   `scripts/backfill-air-dates.mjs`): creates a single `User` row for the
   existing account (`nickname` left `null`) and generates its code, and
   **prints it once to the terminal** — never logged via `logger.ts`, per the
   existing rule that nothing which might carry a secret gets logged. The
   admin picks a nickname the same way everyone else does: through the
   first-login flow in the UI, not the script.
3. Backfill script: sets `userId` on every existing `TrackedShow` and
   `WatchedEpisode` row, and on the single existing `Settings` row, to point at
   that new user.
4. Follow-up migration: tighten `userId` to `NOT NULL` and add the new unique
   constraints, now that every row has one.

Steps 2–3 must run before step 4 in production, in that order, the same way
`scripts/migrate.mjs` already separates "generate the migration" from "apply
it to Turso by hand."

## 4. Auth Flow

- `/login` — single code input, no username field. Posts to a `login(code)`
  server action.
- `login(code)`: hash the submitted code, look up `User` by `codeHash`
  (indexed, single lookup — this is why a deterministic hash was chosen over
  a per-row-comparison scheme like bcrypt: codes are high-entropy
  server-generated tokens, not low-entropy user passwords, so the usual
  slow-hash rationale doesn't apply, and a direct lookup scales better as more
  accounts are added). On match, create a `Session` row, set an HttpOnly,
  Secure, SameSite cookie holding the opaque token.
- `logout()`: delete the `Session` row, clear the cookie.
- `requireSession()`: a helper called at the **top of every server action**
  (per the existing rule in `AGENTS.md` and the removal checklist in
  `scope.md`) — reads the cookie, hashes the token, loads the `Session` +
  `User`, and throws/redirects if missing or expired. Page components also
  call it, for the redirect-to-`/login` UX, but the action-level check is the
  one that actually matters: actions are POST-able directly, bypassing pages
  entirely.
- No self-serve signup route exists. New accounts are created by running
  `scripts/create-user.mjs` (same shape as the admin-user script above)
  against production `DATABASE_URL`, which prints a new code once.

### Nickname setup (first login)

A valid session with `nickname === null` can reach exactly one place: a
`/welcome`-style page and its backing `setNickname(nickname)` action.
Everything else — every other page and every other server action — redirects
or rejects until the nickname is set. This is a second gate layered on top of
`requireSession()`, not a replacement for it: session validity and
"onboarding complete" are different checks, and both need to pass. In
practice this means a wrapper (e.g. `requireOnboardedSession()`) that calls
`requireSession()` and then checks `user.nickname !== null`, used by every
action except `setNickname` and `logout`.

`setNickname(nickname)`: requires a valid session, validates a reasonable
length and character set (exact bounds are an implementation call, not fixed
here), checks uniqueness per the case-sensitivity decision above, and sets
`User.nickname`. Whether it can be called again later to change an existing
nickname, or only while it's still `null`, is an open question — see below.

### `APP_PASSWORD` during the transition

Left in place, per `scope.md`'s existing "Last step of Phase 2" checklist,
until every route and action is session-checked and verified in production.
`/login` stays behind it too during rollout — removing the shared gate is the
*last* step, not something to anticipate early.

## 5. Query / Action Layer Changes

- `src/lib/queries.ts` — every function (`getShowBuckets` and everything it
  composes) takes/threads a `userId`.
- `src/app/actions.ts` — every action calls `requireOnboardedSession()` (or
  `requireSession()`, for the two actions exempt from the nickname gate) first
  and scopes its Prisma calls by the resulting `userId`. This is the
  highest-risk part of the migration: a forgotten `userId` filter on a read
  leaks another user's data, and on a write corrupts it. Worth a dedicated
  review pass action-by-action rather than trusting a find-and-replace.
- `setNickname(nickname)` — new action, see "Nickname setup" above.
- `clearAllData()` — scopes to the calling user's `TrackedShow` /
  `WatchedEpisode` / `Settings` rows only. Never touches `Show`/`Episode`,
  same as v1, but now the `userId` filter is the only thing preventing it from
  wiping everyone's data instead of just the caller's.

## 6. PWA

- Manifest: verify against `node_modules/next/dist/docs` at implementation
  time before choosing between a static `public/manifest.json` and the App
  Router's `app/manifest.ts` convention — Next 16 has already renamed
  Middleware to Proxy, per `AGENTS.md`, so don't assume the metadata API
  matches an older version's docs.
- Icons: 192×192, 512×512, a maskable variant, plus an `apple-touch-icon` —
  iOS ignores the web manifest's icons for the home-screen icon and wants its
  own tag.
- `display: "standalone"`, `theme_color`/`background_color` matching the
  existing Tailwind theme.
- Service worker scope is deliberately narrow: cache the static app shell
  (JS/CSS chunks, icons) only. **Do not** cache TMDB-backed page responses —
  those routes are `dynamic = "force-dynamic"` / `fetchCache:
  "force-no-store"` for a reason (`AGENTS.md`), and a service worker that
  caches them anyway would silently show stale watch state, which is worse
  than the honest "you're offline" the shell-only approach gives.
- iOS-specific meta tags (`apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`) — test on a real iPhone; iOS PWA
  behavior has historically diverged from spec and from Android Chrome.
- No push notifications in v2. Not precluded later by this groundwork, but
  out of scope now (see `docs/scope-v2.md`).

## 7. Tests

New coverage needed, following the existing pattern of building a throwaway
SQLite file from real migrations:

- Session creation/validation/expiry, code hashing and lookup
- **Per-user data isolation** — the sharpest regression risk here: a test that
  asserts user A's queries never return user B's `TrackedShow`/
  `WatchedEpisode`/`Settings` rows, and that `clearAllData()` only ever
  touches the calling user's rows
- Migration/backfill script correctness against a fixture DB seeded with
  "v1-shaped" data (no `userId` columns) to confirm it produces the expected
  post-migration state

Manual, not automated: install-to-homescreen on iOS Safari and Android Chrome,
verified on real devices before calling the PWA piece done.

## 8. Decisions Made

- **Session lifetime: sliding 90-day idle expiration** — extends on activity,
  expires after 90 days of inactivity.
- **Code format: `openssl rand -hex 16`** (32 hex chars / 128 bits of
  entropy). Deliberately shorter than `APP_PASSWORD`'s 64 chars: 128 bits is
  already far beyond brute-force feasibility at any request rate, so matching
  256 bits would cost usability (a longer string to copy/paste) for no
  practical security gain.
- **Nicknames are required (blocking) and unique**, chosen on first login —
  see "Nickname setup" above.

## 9. Open Questions (carry into exec plan)

- **Nickname case sensitivity.** Plain `@unique` is case-sensitive; decide
  between SQLite `COLLATE NOCASE` and a normalized shadow column before
  writing the migration — see "Why `nickname` is nullable despite being
  required" above.
- **Nickname length/character-set bounds** — not fixed here, needs a decision
  before `setNickname`'s validation is written.
- **Nickname editability.** Assumed changeable later via Settings, not locked
  to a one-time choice — confirm before deciding whether `setNickname` stays
  callable after onboarding or becomes onboarding-only.
