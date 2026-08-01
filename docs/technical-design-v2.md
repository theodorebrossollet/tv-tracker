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
  name      String?            // optional label for telling accounts apart in logs/admin use — not used at login
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
   existing account, generates its code, and **prints it once to the
   terminal** — never logged via `logger.ts`, per the existing rule that
   nothing which might carry a secret gets logged.
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

### `APP_PASSWORD` during the transition

Left in place, per `scope.md`'s existing "Last step of Phase 2" checklist,
until every route and action is session-checked and verified in production.
`/login` stays behind it too during rollout — removing the shared gate is the
*last* step, not something to anticipate early.

## 5. Query / Action Layer Changes

- `src/lib/queries.ts` — every function (`getShowBuckets` and everything it
  composes) takes/threads a `userId`.
- `src/app/actions.ts` — every action calls `requireSession()` first and
  scopes its Prisma calls by the resulting `userId`. This is the highest-risk
  part of the migration: a forgotten `userId` filter on a read leaks another
  user's data, and on a write corrupts it. Worth a dedicated review pass
  action-by-action rather than trusting a find-and-replace.
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

## 8. Open Questions (carry into exec plan)

- **Session lifetime.** No default has been chosen yet — balance "don't make
  people re-enter a long code often" against "a stolen device stays logged in
  forever." A sliding expiration (extend on activity, e.g. 90 days idle
  timeout) is a reasonable default to propose, not a locked decision.
- **Code format/length.** Proposing `openssl rand -hex 16` (32 hex chars),
  matching `APP_PASSWORD`'s existing generation method — confirm before
  building the generation script.
- Whether `User.name` is worth adding now (useful for telling accounts apart
  in logs) or can wait until it's actually needed.
