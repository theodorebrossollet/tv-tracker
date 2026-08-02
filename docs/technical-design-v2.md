# TV Tracker — Technical Design (v2)

Based on `docs/scope-v2.md`. Read that first, plus `docs/technical-design.md`
(v1) — this doc only covers the delta: accounts and the PWA.

## 1. Architecture Overview

No new services. Accounts add two new tables and a `userId` column threaded
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
  ├── requireOnboardedSession() ── at the top of every page and server action
  │     (the APP_PASSWORD gate that used to sit in front of all this is gone)
  ├── Server Actions ── read/write via Prisma, now scoped by userId
  ├── TMDB API client ── unchanged, still global/shared cache
  ├── /api/cron/refresh-episodes ── stays deliberately user-agnostic (see §5)
  │
  ▼
SQLite via Prisma (Turso in production) — User/Session tables added
```

## 2. Data Model Changes

```prisma
model User {
  id        String   @id @default(cuid())
  /// SHA-256 of the account code. The code is an *invite* and the recovery
  /// route, not the everyday credential — see §4.
  codeHash  String   @unique
  /// scrypt, salted, parameters stored in the record. Hashed completely
  /// differently from codeHash, on purpose — see §4. Null until first login.
  passwordHash String?
  /// Chosen on first login, not at account creation — null until then. Required
  /// before the account can use anything else (see "Nickname setup" below).
  /// Permanent once set — no rename support in v2 (see roadmap). Unique,
  /// case-insensitively, via `nicknameKey` below.
  /// Displayed on a future profile page and used to find the account once
  /// social features exist; collected now so that feature never needs a
  /// backfill or a forced-rename migration on existing accounts.
  nickname  String?
  /// Lowercased copy of `nickname`, carrying the actual unique constraint.
  /// See "Case-insensitive uniqueness" below for why this rather than COLLATE.
  nicknameKey String? @unique
  createdAt DateTime @default(now())

  trackedShows    TrackedShow[]
  watchedEpisodes WatchedEpisode[]
  settings        Settings?
  sessions        Session[]
}

model Session {
  id         String   @id            // SHA-256 of the opaque session token, not the token itself — same reasoning as codeHash
  userId     String
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])   // for the daily expired-session sweep, see §4
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

`Show` and `Episode` keep every column they have — they stay a global cache.
Two users tracking the same show should not fetch or store it twice; only the
*relationship* to a show (tracked/watched/settings) is per-user.

### But `Show` and `Episode` do change: their back-relations become lists

This is the single most under-appreciated part of the migration, and it is not
a "thread a `userId` argument" job.

Today the unique constraint sits on `showId` / `episodeId` *alone*, which makes
both back-relations one-to-one:

```prisma
model Show    { tracked TrackedShow?    }
model Episode { watched WatchedEpisode? }
```

Moving those constraints to `@@unique([userId, showId])` /
`@@unique([userId, episodeId])` flips both to lists:

```prisma
model Show    { tracked TrackedShow[]    }
model Episode { watched WatchedEpisode[] }
```

Every existing query that reads through those relations changes *shape*, not
just filters. In `src/lib/queries.ts`:

- `getTrackedShows` selects `watched: { select: { watchedAt: true } }` and then
  tests `episode.watched !== null` three times (aired/next-unwatched/last-watched).
  All three now read an array.
- `getUpcomingEpisodes` filters `show: { tracked: { status: { in: [...] } } }` —
  a to-one filter that becomes `tracked: { some: { ... } }` — and then reads
  `episode.show.tracked!.status`.
- `getShowDetail` reads `show.tracked?.status` via `loadShow`.

Budget for rewriting those three functions, not for editing their `where`
clauses. §5 covers the correctness trap this creates.

### Why `nickname` is nullable despite being required

It has to start `null` — a code exists before its owner has chosen a nickname,
and the admin-bootstrap script (see migration path below) creates a `User`
row with no nickname at all. "Required" is enforced by the application (no
route but the nickname-setup one is reachable while it's `null`), not by a
`NOT NULL` column. SQLite's unique index treats multiple `NULL`s as distinct
values by default, so several not-yet-onboarded accounts can coexist without
a temporary placeholder value or collision.

### Case-insensitive uniqueness

Uniqueness is case-insensitive by decision — `"Theo"` and `"theo"` are the
same nickname. A plain `@unique` on `nickname` is case-*sensitive*, so this
needs either SQLite's `COLLATE NOCASE` on the column or a second normalized
(lowercased) column carrying the constraint.

**Use the normalized column** (`nicknameKey` above), for a reason specific to
how this project builds and tests migrations. Prisma's schema DSL has no
first-class way to declare `COLLATE NOCASE`, so it means hand-editing the SQL
that `prisma migrate dev` generates — and the *next* migration touching that
model regenerates it without the collation. Worse, `tests/helpers.ts` builds
its throwaway database from the real migration files, so a silently dropped
collation would still pass every test. `nicknameKey` is declarative, survives
regeneration, and fails loudly if it is ever left unset.

(Separately: SQLite's `NOCASE` folds ASCII only. Irrelevant given the charset
below, but it is not a real Unicode case fold, so it wouldn't have been the
"native" option it looks like anyway.)

### Nickname format

3–12 characters from `[A-Za-z0-9]` plus the special characters
`@ # $ & * ! _ . -`, and **at least one alphanumeric character**.

Two constraints shaped that list. Anything with meaning in a URL path is
excluded (`/ ? <space>` etc.), since a future profile page will very likely be
addressed as `/u/<nickname>`. `%` is excluded specifically — a character that
must be percent-encoded at every interpolation site is a double-decode bug
waiting to happen, and it buys nothing. `&` is allowed as *content* but must
still be percent-encoded wherever the nickname is interpolated into a URL,
same as any user-supplied path segment.

The "at least one alphanumeric" rule exists because length and charset alone
admit `...`, `---`, and `!!!`.

### Why a `Session` table instead of a stateless signed cookie

A stateless cookie (sign `userId` into a JWT/iron-session payload) needs no
extra table, but it can't be individually revoked — the only way to invalidate
one is to rotate the server secret, which logs out everyone at once. Given
codes have **no self-serve recovery path** (see §4's `reset-user-code.mjs`
note for the admin-assisted one), being able to kill one compromised session
(or all of one user's sessions) without affecting anyone else matters more
here than it would with a Google-login system that has its own recovery.

The cookie itself stores an opaque random token (not the DB row's id in
plaintext); the DB stores a SHA-256 hash of it, mirroring `codeHash`. A dump
of the database then reveals neither account codes nor live session tokens.

Cost is one indexed read per request — irrelevant at this scale. Note that
sliding expiration (§8) would make it a read *and a write* per request unless
throttled; §4 says how.

## 3. Migration Path (existing v1 data)

**Both phases have run.** Kept below as the record of how the migration was
actually planned and sequenced, not as a pending plan — see §9's "Next Steps"
for the current-state pointer.

The deployed app already has real data under the "one implicit user" model.
This is the sharper version of the "adding a column needs a backfill" rule in
`AGENTS.md` — it's not just blank fields, it's establishing data ownership on
rows that already exist.

The steps split into a part that is safe to run against the *currently
deployed* v1 build, and a part that is not. That split is the whole plan.

### Phase A — schema-compatible with the running v1 build

1. **Migration A.** Add `User` and `Session`. Add a **nullable** `userId` to
   `TrackedShow`, `WatchedEpisode`, *and* `Settings`. Leave every existing
   unique constraint alone. The running v1 build doesn't know these columns
   exist and keeps working against them.

   **Take the backup before this phase too, not just before Phase B.** This
   section previously called Phase A "additive, safe" and put the backup
   entirely in Phase B. The generated SQL says otherwise: SQLite cannot
   `ALTER TABLE ADD COLUMN` when the column carries a foreign key, so Prisma
   rebuilds `TrackedShow`, `WatchedEpisode` and `Settings` — create new table,
   copy rows, `DROP TABLE`, rename. Three tables holding real data get dropped
   and recreated, and `migrate.mjs` applies the file non-transactionally. The
   *schema* claim was right; the "no data at risk" one was not, and they are
   different claims.

   Run `npm run db:backup` before both phases. It is one command.

   Adding the nullable `userId` to `Settings` in this phase is what makes
   `Settings` migrate cleanly later. Its primary key changes from
   `id Int @id @default(1)` to `userId String @id`, which SQLite can only do by
   rebuilding the table — and Prisma's generated rebuild copies existing
   columns across. If `userId` is already present and populated when that
   rebuild happens, the row survives with no hand-edited SQL. If `userId` were
   introduced *as* the new primary key in one step, there would be nothing to
   copy from and the row's `notifyEnabled`/`country` would be lost.

2. **`scripts/create-admin-user.mjs`** (following the pattern of
   `scripts/backfill-air-dates.mjs`): creates a single `User` row for the
   existing account (`nickname` left `null`), generates its code, and **prints
   it once to the terminal** — never through `logger.ts`, per the existing rule
   that nothing which might carry a secret gets logged. The admin picks a
   nickname the same way everyone else does: through the first-login flow in
   the UI, not the script.

   **It must refuse to run if any `User` row already exists.** Re-running it
   otherwise mints a second account and a second code while the first still
   owns every backfilled row — recoverable, but discovered at the worst
   possible moment, since the code is printed once and the script runs by hand
   against production.

3. **`scripts/backfill-user-ownership.mjs`**: sets `userId` on every existing
   `TrackedShow` and `WatchedEpisode` row, and on the single existing
   `Settings` row, to point at that user. (`Settings` may legitimately have
   zero rows if neither preference was ever touched — handle that rather than
   asserting one row.)

### Phase B — breaking, needs a maintenance window

4. **Migration B, immediately followed by the code deploy.** Drops the old
   `showId` / `episodeId` unique constraints, adds the composite ones, tightens
   `userId` to `NOT NULL`, and rebuilds `Settings` around its new primary key.

   This step and the deploy have to be adjacent, and there is no ordering that
   avoids a gap. The deployed v1 client still issues
   `findUnique({ where: { showId } })` and `upsert({ where: { showId } })`
   (`addToWatchlist`, `markEpisodeWatched`, `setSeasonWatched`), which migration
   B invalidates; the v2 build's composite-key queries are equally invalid
   against the pre-B schema. Since `AGENTS.md` is explicit that **migrations do
   not run on deploy** — they're applied by hand with `npm run db:deploy`
   against Turso — the gap is however long it takes to run one command and
   click deploy.

   For a handful of users that is a short announced window, not an
   engineering problem. Run migration B first, then deploy: if B fails, v1 is
   still serving and nothing is half-migrated. Write B's revert migration
   before starting it.

   **Take a copy of the production database before Phase B**, and keep it until
   the deployment is verified. A revert migration undoes a schema change; it
   does not undo a table rebuild that dropped rows, and Phase B rebuilds three
   tables including the one holding every watch record. This is the only step
   in v2 that can lose data that TMDB cannot re-supply.

5. **Verify in production**, then work the `APP_PASSWORD` removal checklist in
   `scope.md`, then the PWA.

## 4. Auth Flow

**Revised during implementation.** The original design made the account code
*the* credential, entered on every login. Pasting 32 hex characters on a phone
every time was too much friction — and worse once installed to a home screen —
so the code became an invite and users now choose a password. The code stays
valid as the recovery route, which the original design had none of.

Two credentials, hashed two different ways, and that asymmetry is the point:
a 128-bit generated code justifies a fast indexed SHA-256 lookup, and a
user-chosen password does not.

- `/login` — asks which you have: an existing account, or a code. Sub-routes
  `/login/password` (nickname + password) and `/login/code`.
- Secrets render masked with a reveal toggle. Masking alone is wrong for a
  32-character pasted code — a row of dots gives no way to tell a truncated
  paste from a good one.
- `loginWithPassword(nickname, password)`: look up by `nicknameKey`, verify
  with scrypt. One message for every failure, and a scrypt-shaped delay even
  when the nickname is unknown, so the response time doesn't say which half was
  wrong.
- `completeOnboarding(nickname, password)`: writes both in a single update
  filtered on `nickname: <current>, passwordHash: null`. That filter is
  load-bearing — without it the action re-hashes the password of an already
  finished account, which is a password change that never had to know the
  current one, on an endpoint that is POST-able directly.
- Password rules: 8 characters minimum, 128 maximum, no composition rules
  (they push people towards predictable substitutions; length is the control
  that matters). scrypt at N=2^15, salted, parameters stored in the record so
  they can be raised later without invalidating existing passwords.
- `loginWithCode(code)`: SHA-256 the submitted code, look up `User` by `codeHash`
  (indexed, single lookup — this is why a deterministic hash was chosen over
  a per-row-comparison scheme like bcrypt: codes are high-entropy
  server-generated tokens, not low-entropy user passwords, so the usual
  slow-hash rationale doesn't apply, and a direct lookup scales better as more
  accounts are added). The hash is unsalted by necessity — the indexed lookup
  requires it, and there is no dictionary to precompute against 128 random
  bits. On match, create a `Session` row and set the cookie. If the account
  already has a password, that hash is cleared as part of the same update and
  the visitor is routed to `/welcome` to choose a new one — reaching this
  action with a password already set means recovering, not just signing in,
  and leaving the old (forgotten) hash live would mean landing back here next
  time. An account with no password yet (first login, or right after a
  `reset-user-code.mjs` run) already goes to `/welcome` regardless.
- **Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.** `Lax` rather
  than `Strict`: `Strict` would drop the cookie on any inbound link from
  another app, which for something launched from a phone home screen and
  shared by link is a logout that looks like a bug.
- `logout()`: delete the `Session` row, clear the cookie, redirect to `/login`.
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
- **Losing the code isn't self-serve recoverable, but it isn't a dead end.**
  `scripts/reset-user-code.mjs <nickname>` looks the account up by
  `nicknameKey`, overwrites `codeHash` with a fresh one, and prints the new
  code once — same handling as the other account scripts. It deliberately
  does not touch `passwordHash`: whether the visitor also needs a new
  password is `loginWithCode`'s call to make (see above), not this script's.
  Nothing about `TrackedShow`/`WatchedEpisode`/`Settings` changes, because
  none of them reference the code — they key off `User.id`, which this script
  never touches. Identifying the right account by nickname rather than by
  anything resembling PII is what keeps this consistent with the rest of the
  account model.

**No rate limiting on `loginWithCode`, deliberately.** At 128 bits of entropy
(§8) brute force is infeasible at any request rate, so the
`WRONG_PASSWORD_DELAY_MS` mitigation in `proxy.ts` has no analogue worth
building there.

**`loginWithPassword` needed one, and has one.** User-chosen passwords are
guessable in a way codes are not, and once the shared gate came off the form
became reachable by anyone with the URL — roughly 860k attempts a day at
scrypt's ~10/sec, which is thin against an 8-character minimum.

`src/lib/login-throttle.ts` applies per-account backoff: five failures cost
nothing, then the wait doubles from 30s to a 5-minute cap. Counted per account
rather than per IP for the reason the old `proxy.ts` already documented — an
in-process counter resets constantly across serverless instances and reads as
protection while providing none.

The cap and the escape hatch are what make locking safe. An uncapped doubling
would eventually lock someone out for weeks, and a lockout with no way around
it would let a stranger who knows your nickname deny you your own account.
Signing in with the account code clears the lockout, so the way back in never
depended on the password.

### Call the session gate *outside* each action's `try` block

Every action in `src/app/actions.ts` wraps its body in
`try { … } catch (error) { return toResult(error) }`, and `toResult` turns
anything it doesn't recognise into `logger.error("action.failed")` plus
`"Something went wrong. Please try again."`.

A `requireSession()` that throws or redirects from *inside* that block gets
swallowed: the user sees a generic error toast instead of a login redirect, and
every routine expired session pollutes `action.failed`. So the gate goes above
the `try`, uniformly, in every action.

This isn't a workaround — it's what Next 16 documents. Per
`next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`: *"`redirect`
throws an error so it should be called **outside** the `try` block when using
`try/catch` statements"*, called out twice, specifically for Server Actions and
Route Handlers. It throws `NEXT_REDIRECT` and, from a Server Action, serves a
303. Teaching `toResult` to re-throw it would also work, but there's no reason
to reach for the fragile version when the documented placement is free — and
above-the-`try` is equally correct for a plain `throw new Error("Unauthorized")`.

### Session lifetime and cleanup

Sliding 90-day idle expiration (§8) means extending `expiresAt` on activity.
Done naively that is a database *write* on every request, on Turso, for pages
that are all `force-dynamic` — which would quietly undo the "one indexed read
per request" argument in §2.

Throttle it: only extend when `expiresAt` is more than ~24h from the full
window (i.e. the session was last extended more than a day ago). That needs no
extra column and reduces the write to at most one per user per day, while
making no practical difference to a 90-day window.

Nothing removes expired rows on its own. Fold a
`session.deleteMany({ where: { expiresAt: { lt: new Date() } } })` into the
existing daily cron run — that's what the `@@index([expiresAt])` is for.

### Revocation — the reason §2 chose a `Session` table

§2 argues for a table over a stateless cookie because sessions can then be
killed individually. That capability went unused at first, and the gap was
sharper than it looked: sliding expiry means a session that gets exercised never
lapses, and sign-out only ends the session holding the cookie. So a stolen
cookie was effectively permanent, and the documented recovery story — "lost your
password? use your code" — didn't evict whoever prompted it. It just added a
second person to the account.

Both credential-change paths now revoke:

- **`changePassword`** deletes every session for the user *except* the one making
  the change. Signing someone out of the page they're standing on to tell them
  their password changed is a worse experience than the threat justifies.
- **`loginWithCode`**, on the recovery branch only, deletes all of them before
  minting the new session. An account with no password set yet is mid-onboarding
  rather than recovering, and has nothing worth evicting.

Both log `sessionsRevoked`. The user-visible consequence — changing your
password signs your other devices out — is stated in the settings copy, because
otherwise it reads as a bug.

**`signOutEverywhere` does the same job on its own.** Revoking only as a side
effect of a password change meant the answer to "I left myself signed in on a
borrowed laptop" was to pick a new password that was never the problem, and
then re-enter it everywhere. The action ends every session including the
caller's: keeping the current one would mean deciding it is the trustworthy
one, and someone reaching for this doesn't necessarily know which device
they're on. Signing back in is a cheap, unambiguous end state — which is also
why it needs no confirmation step. It clears the cookie as well as the rows,
or the browser keeps presenting a dead token and every request pays a lookup to
be told so.

There is still no *absolute* session lifetime; expiry remains sliding. With
revocation in place that's a much smaller gap, but a cheap backstop remains
available if it ever matters: refuse sessions whose `createdAt` is older than
some ceiling. The column already exists.

`scripts/reset-user-code.mjs` does not revoke on its own. It doesn't need to —
the code login that necessarily follows it does.

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

`setNickname(nickname)`: requires a valid session, validates length (3–12),
character set, and the at-least-one-alphanumeric rule per the format above,
writes `nicknameKey` as the lowercased form, and relies on that column's unique
constraint for the collision check. **Permanent by design** — the action itself
must reject if `user.nickname` is already non-null, not just rely on the
onboarding gate keeping the UI from reaching it. That matters because, per the
existing rule in `AGENTS.md`, server actions are POST-able directly: a missing
server-side check here would let a direct POST rename an account that's
supposed to be locked. There is no rename support in v2 — see the roadmap in
`docs/scope-v2.md`.

### `APP_PASSWORD` — removed

Kept through the rollout, per `scope.md`'s checklist, and deleted once every
page and action had been audited as session-checked. `src/proxy.ts` and
`tests/proxy.test.ts` are gone.

The audit is worth repeating whenever a route is added, because the gate that
used to catch an oversight no longer exists: a new page without
`requireOnboardedSession()`, or a route handler without its own auth, is simply
open.

## 5. Query / Action Layer Changes

- `src/lib/queries.ts` — every function (`getShowBuckets` and everything it
  composes) takes/threads a `userId`, **and** the three functions listed in §2
  change query shape because their relations became lists.
- `src/app/actions.ts` — every action calls `requireOnboardedSession()` (or
  `requireSession()`, for the two actions exempt from the nickname gate) above
  its `try` block, and scopes its Prisma calls by the resulting `userId`. This
  is the highest-risk part of the migration: a forgotten `userId` filter on a
  read leaks another user's data, and on a write corrupts it. Worth a dedicated
  review pass action-by-action rather than trusting a find-and-replace.
- `setNickname(nickname)` — new action, see "Nickname setup" above.
- `clearAllData()` — scopes to the calling user's `TrackedShow` /
  `WatchedEpisode` / `Settings` rows only. Never touches `Show`/`Episode`,
  same as v1, but now the `userId` filter is the only thing preventing it from
  wiping everyone's data instead of just the caller's.
- `removeShow()` is the same hazard in miniature: its
  `deleteMany({ where: { showId } })` currently means "the one tracked row for
  this show" and post-v2 means "every user's tracked row for this show". Two
  actions in this file call `deleteMany` with a filter that used to be
  incidentally unique — grep for every `deleteMany` before calling the review
  pass done.

### The one that will silently leak: `getUpcomingEpisodes`

Its relation filter is `show: { tracked: { status: { in: [...] } } }`. The
mechanical fix once `tracked` is a list is `tracked: { some: { status: {…} } }`
— which compiles, type-checks, and returns episodes for shows that *anyone*
tracks. The home page would show you upcoming episodes for a show only someone
else has added.

It needs `some: { userId, status: { in: [...] } }`, and the subsequent
`episode.show.tracked!.status` must select the caller's row rather than `[0]`.

This is called out by name because it is the one place where the wrong code
looks right. §7's isolation test is written to catch exactly it.

### The cron route stays user-agnostic — but needs `distinct`

`/api/cron/refresh-episodes` refreshes the global `Show`/`Episode` cache, so it
correctly has no user context and must not gain one. But it reads
`prisma.trackedShow.findMany({ select: { showId: true } })`, which post-v2
returns the union across all users **with duplicates** — N users tracking the
same show means N identical TMDB syncs inside the 60s `maxDuration`. Add
`distinct: ["showId"]`.

Related: the runtime-headroom figure in `docs/technical-design.md` was sized
against one user's show count. The correct denominator is now *distinct* shows
across all accounts, which grows as accounts are added. The `msPerShow` figure
already logged by each run stays the right thing to watch.

### Logging

`show.paused`, `show.resumed`, `show.demoted_to_watchlist` and friends
currently emit `{ showId }`. With more than one account those lines stop being
interpretable — add `userId`. Extend the existing "never log a TMDB URL" rule
explicitly to the account code and the session token, including `login()`'s
failure path, which is the natural place to be tempted to log the input.

## 6. PWA

Checked against this version's bundled docs
(`next/dist/docs/01-app/02-guides/progressive-web-apps.md` and
`.../03-api-reference/03-file-conventions/01-metadata/manifest.md`), so the
choices below are settled rather than deferred.

- **Manifest: a static `app/manifest.json`.** Next 16 wants it in the root of
  `app/`, not `public/`. The alternative, `app/manifest.ts`, is a generated
  Route Handler — useful when the manifest depends on request-time data, which
  ours doesn't. Nothing here varies per request, so the static file is the
  simpler of the two and skips the caching semantics the generated version
  carries.
- Icons live in `public/` and are referenced by absolute path from the
  manifest: 192×192, 512×512, a maskable variant, plus an `apple-touch-icon` —
  iOS ignores the web manifest's icons for the home-screen icon and wants its
  own tag.
- `display: "standalone"`, `theme_color`/`background_color` matching the
  existing Tailwind theme.
- **Service worker: a hand-written `public/sw.js`**, registered as
  `navigator.serviceWorker.register("/sw.js", { scope: "/" })`. The docs
  suggest Serwist for anyone wanting real offline support, but note it
  "currently requires webpack configuration" — and Next 16 builds with
  Turbopack. Since §6's whole point is that this project caches the shell and
  nothing else, taking on a webpack config to get a library we'd use a tenth of
  is the wrong trade. The guide hand-writes `public/sw.js` too.
- **Add a `headers()` block to `next.config.ts` for `/sw.js`** — it has none
  today. Specifically `Cache-Control: no-cache, no-store, must-revalidate`:
  without it, a cached service worker is how users get permanently stuck on an
  old one, which is the failure mode that makes people hate PWAs. The guide
  also suggests `Content-Type: application/javascript; charset=utf-8` and
  `Content-Security-Policy: default-src 'self'; script-src 'self'` on that
  path.
- **Install criteria are just a valid manifest plus HTTPS.** Confirmed in the
  guide: install prompts do not require offline support. That is what makes the
  shell-only decision below viable rather than a compromise.
- **Don't build a custom install button.** The guide explicitly recommends
  against `beforeinstallprompt` — it doesn't work on Safari iOS, which is half
  of `scope-v2.md`'s success criteria. iOS needs a short instructional message
  ("Share → Add to Home Screen") instead.
- Service worker scope is deliberately narrow: cache the static app shell
  (JS/CSS chunks, icons) only. **Do not** cache TMDB-backed page responses —
  those routes are `dynamic = "force-dynamic"` / `fetchCache:
  "force-no-store"` for a reason (`AGENTS.md`), and a service worker that
  caches them anyway would silently show stale watch state, which is worse
  than the honest "you're offline" the shell-only approach gives.
- **Never cache a 401 or a redirect to `/login`.** Building the PWA after the
  `APP_PASSWORD` removal (per `scope.md`'s ordering) avoids the worst of the
  Basic-auth interaction, but a shell cached during a logged-out moment, or a
  cached 401 response, reproduces exactly the silently-stale failure the point
  above is trying to avoid.
- iOS-specific meta tags (`apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`) — test on a real iPhone; iOS PWA
  behavior has historically diverged from spec and from Android Chrome.
- No push notifications in v2. Not precluded later by this groundwork, but
  out of scope now (see `docs/scope-v2.md`).

### Don't punch a hole in the proxy matcher to test the PWA early

`proxy.ts`'s matcher is `/((?!api/cron/|_next/static|favicon.ico).*)`, so
`/manifest.json`, `/sw.js` and the icons in `public/` all sit behind
`APP_PASSWORD`. Anyone trying the PWA before the gate comes off will hit 401s
on exactly those files and be tempted to add them to the exclusion list.

Don't. That list is documented in `proxy.ts` as "the password gate's only
hole", and widening it to cover the app shell during a rollout is a real
weakening for a temporary convenience. The ordering in `scope.md` already
solves this: the gate is removed *before* the PWA work starts. Build it in that
order and the problem never appears.

## 7. Tests

New coverage needed, following the existing pattern of building a throwaway
SQLite file from real migrations:

- Session creation/validation/expiry (including that the sliding extension is
  throttled rather than firing every request), code hashing and lookup
- **Per-user data isolation** — the sharpest regression risk here: a test that
  asserts user A's queries never return user B's `TrackedShow`/
  `WatchedEpisode`/`Settings` rows, and that `clearAllData()` only ever
  touches the calling user's rows
- Migration/backfill script correctness against a fixture DB seeded with
  "v1-shaped" data (no `userId` columns) to confirm it produces the expected
  post-migration state

Write the isolation test so it **fails against the naive migration**, per
`AGENTS.md`'s "check the test fails without the code" rule — the fixture that
does it is: seed a tracked show with a future episode owned by user B, then
assert user A's upcoming list is empty. That is a red test against
`tracked: { some: { status } }` and green against
`tracked: { some: { userId, status } }`, which is precisely the §5 trap.

Budget for the mechanical cost too: `tests/helpers.ts` (`resetDatabase`,
`seedShow`) needs a user parameter, which touches essentially every
database-backed test file — `queries`, `tracking`, `cron`, `search`.

Manual, not automated: install-to-homescreen on iOS Safari and Android Chrome,
verified on real devices before calling the PWA piece done.

## 8. Decisions Made

- **Session lifetime: sliding 90-day idle expiration** — extends on activity,
  expires after 90 days of inactivity. Extension is throttled to at most once
  per day per session; see §4.
- **Code format: `openssl rand -hex 16`** (32 hex chars / 128 bits of
  entropy). Deliberately shorter than `APP_PASSWORD`'s 64 chars: 128 bits is
  already far beyond brute-force feasibility at any request rate, so matching
  256 bits would cost usability (a longer string to copy/paste) for no
  practical security gain.
- **Hashing: SHA-256, unsalted**, for both `codeHash` and `Session.id` — see
  the reasoning in §4.
- **Nicknames are required (blocking) and unique**, chosen on first login —
  see "Nickname setup" above.
- **Nickname uniqueness is case-insensitive**, implemented via a normalized
  `nicknameKey` column rather than `COLLATE NOCASE` (see §2). Format is 3–12
  characters from `[A-Za-z0-9@#$&*!_.-]` with at least one alphanumeric.
- **Nicknames are permanent** — no edit/rename support in v2. Enforced
  server-side in `setNickname`, not just by hiding the UI. Renaming is
  deferred; see the roadmap in `docs/scope-v2.md`.
- **Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/`** — see §4 for
  why `Lax` rather than `Strict`.

## 9. Open Questions

None, and nothing is deferred to "check the docs at implementation time"
either — Next 16.2.12's bundled docs were read while writing this pass, and
both questions that depended on them (`redirect()`'s interaction with
`try/catch`, and the manifest convention) are answered in §4 and §6.

The two design calls previously left open are also decided: case-insensitive
uniqueness uses a `nicknameKey` column (§2), and `Settings` survives its
primary-key change by getting its nullable `userId` in Phase A so Prisma's
table rebuild carries the row across (§3).

What remains before building is not design work:

1. ~~**Schedule the Phase B window** and take the database copy (§3).~~ **Done.**
   Phase B has run against production — the composite unique constraints and
   `NOT NULL userId` described in §2 are live on the real database, not just in
   these tests' throwaway ones.
2. **Real devices for the PWA** — an iPhone and an Android handset. Per
   `scope-v2.md`'s success criteria, a desktop browser's device emulator
   doesn't count. Not yet confirmed done as of this writing.
