# Code review — vulnerabilities and inefficiencies

Full-codebase review, 31 July 2026. Every source file, the Prisma schema, the
proxy/auth layer, the cron route, the scripts, and the docs were read.
Revised the same day after review feedback: #2/#3 swapped and reworked, the
brute-force remedy corrected for Vercel's execution model, the encoded-slash
claim downgraded to unverified, copy drift extended to four sites, and a note
added on the CSRF posture.

Overall the codebase is in good shape: the threat model is written down, the
password gate fails closed, Prisma parameterizes every query, and the TMDB key
never leaves the server. The findings below are what remains, ordered by
severity within each section.

**Status:** step 1 of the work order below (#1 and #6) is fixed. Everything
else is outstanding.

## Security findings

### 1. TMDB show IDs are never validated (path/query injection)

`src/app/actions.ts:100`, `src/lib/tmdb.ts:259`

`addToWatchlist`, `getShowDetail`, and every function downstream accept an
arbitrary string and interpolate it into
`new URL(`${TMDB_BASE}/tv/${tmdbShowId}`)`. A value like `1399/season/1` or
`1399?append_to_response=...` redirects the server's request to a different
TMDB endpoint. Server actions accept direct POSTs, so that vector is
sufficient on its own. Encoded slashes in the route param
(`/show/1399%2Fseason%2F1`) are plausibly a second vector, but that depends on
version-specific path normalization and has not been verified against a
running server — the fix is identical either way.

The origin can't be changed — this is not full SSRF — but the response gets
cached as a `Show` row keyed by the raw string, and the string also flows into
`revalidatePath`.

**Fix:** validate `/^\d+$/` once at the entry points (the actions and the show
page) and reject anything else.

### 2. No brute-force throttling on the password gate

`src/proxy.ts`

Basic auth with a single shared password and no rate limiting means anyone who
finds the URL can hammer it, and `clearAllData` sits behind that one password.

Note what does **not** work here: an in-memory per-IP counter in the proxy.
On Vercel the proxy runs across many short-lived instances, so an in-memory
counter resets constantly and an attacker gets a fresh window per instance for
free — it would read as protection without being any. The honest options are:

- **Vercel's own firewall / rate-limiting** at the platform edge — the right
  tool, no code.
- **A durable store** (a Turso table, or a hosted counter like Upstash) if
  enforcement must live in code — heavier than v1 probably wants.
- **A constant delay on failure** as a fallback. Caveat, written down on
  purpose: a delay only slows a *serial* attacker; parallel requests sidestep
  it. It is a mitigation, not a control.

Worth doing before Phase 2.

### 3. The password-gate comparison's comment is false

`src/proxy.ts:23-26`

`matches` early-returns on length mismatch, so the "length-independent"
comment above it is not true — the compare is constant-time only for
equal-length inputs and leaks the password's *length* through timing.

This is a comment-accuracy bug dressed as a crypto bug: the password is a
single shared secret, and hiding its length from a network-timing attacker is
worth approximately nothing. A digest-then-compare rewrite is possible (the
proxy may be async, so `crypto.subtle.digest` would work) but the threat
doesn't justify it.

**Fix:** rewrite the comment to say what the code does — constant-time for
equal lengths, leaks only the length. Related: the cron route compares its
bearer token with plain `===`
(`src/app/api/cron/refresh-episodes/route.ts:25`); same reasoning applies.

### 4. The proxy matcher excludes by prefix

`src/proxy.ts:90`

`api/cron` in the negative lookahead is a prefix match: any future route under
`/api/cron*` (e.g. `/api/cron-debug`) silently bypasses the password gate.
Today only the one self-authenticating route exists, so this is a landmine
rather than a hole.

**Fix:** tighten the pattern to `api/cron/` (with the slash) and note in a
comment that anything placed under that path must authenticate itself.

### 5. `clearAllData` deletes three tables outside a transaction

`src/app/actions.ts:437`

If the second or third `deleteMany` fails, watch history is gone but tracked
shows remain (or settings are orphaned).

**Fix:** wrap the three deletes in `prisma.$transaction`.

Same note, lower stakes, for `scripts/migrate.mjs:109`: `executeMultiple` is
not transactional, so a migration failing mid-file leaves the schema
half-applied with no `_prisma_migrations` record. At minimum, log that this
state needs manual repair.

### A load-bearing control worth documenting: CSRF posture

Not a defect — an invisible dependency. The password gate is Basic auth, which
browsers replay automatically on cross-site requests, and `clearAllData` is a
server action. The only thing standing between a malicious page and that
action is Next's built-in Origin/Host check on server-action POSTs. That
control is load-bearing and appears nowhere in this codebase's own comments,
which otherwise reason carefully about the action-POST surface.

Two concrete implications:

- `serverActions.allowedOrigins` in `next.config.ts` must never be widened
  casually — it is the knob that weakens this exact protection.
- Plain route handlers get **no** such protection. The cron route is safe
  because it does its own bearer-token check; any future route handler must
  bring its own auth, per finding #4.

**Fix:** state this in the threat-model comment at the top of
`src/app/actions.ts` (or `src/proxy.ts`), so Phase 2 doesn't delete the
password gate without knowing what else was holding.

## Inefficiencies

### 6. Every show page view does the whole detail load twice

`src/app/show/[id]/page.tsx:28-38`

Both `generateMetadata` and the page component call `getShowDetail(id)`, which
runs `ensureShowCached` plus a full show + episodes + watched load. That is
double the database work on every view — and if the show is stale or uncached,
both calls can race into `syncShowFromTmdb` concurrently, doubling a
multi-request TMDB sync and interleaving hundreds of upserts.

**Fix:** wrap `getShowDetail` in React's `cache()` so the two calls share one
result per request.

### 7. `getTrackedShows` pulls every episode's full row for every tracked show

`src/lib/queries.ts:42-55`

The home, watchlist, and archive pages all call this via `getShowBuckets`, and
it `include`s complete episode rows — `overview` text, `name`, `runtime` — for
every episode of every tracked show, just to compute counts and find the next
unwatched episode. Over Turso's network protocol this is the single heaviest
query in the app, and it grows with tracked shows × episodes.

**Fix:** replace the `include` with a `select` of only `seasonNumber`,
`episodeNumber`, `name`, `airDate`, and
`watched: { select: { watchedAt: true } }`. That cuts the payload by an order
of magnitude; SQL-side aggregation can wait until it actually hurts.

### 8. The cron writes one Turso round trip per episode

`src/lib/shows.ts:46-70`

`syncShowFromTmdb` upserts episodes one at a time, sequentially. A 300-episode
show is 300 network round trips, on every nightly run. The measured
~1.1s/show budget (docs/technical-design.md puts the timeout near 50 shows) is
mostly this, not TMDB politeness.

**Fix:** fetch the show's existing episode rows in one query, `createMany` the
new episodes, batch the updates in a single `$transaction`, and skip updates
entirely when nothing changed (diff against the fetched rows). This buys far
more headroom than parallelizing season fetches, without touching TMDB
rate-limit behaviour.

### 9. Watch providers are the only per-show-page TMDB call with no cache

`src/lib/tmdb.ts:400`

Trailers and regions go through the in-process `cached()` helper with a 1-day
TTL, but `getWatchProviders` is fetched fresh on every show page view.
Availability data changes on the order of days.

**Fix:** route it through `cached()` with an hour-plus TTL.

While there: `responseCache` (`src/lib/tmdb.ts:95`) never evicts expired
entries, so it grows unboundedly on a long-lived process. Sweep expired keys
on insert, or cap the map size.

## Smaller notes

- **Copy drift, in four places.** The daily-at-06:00 schedule in `vercel.json`
  is still described as twice-daily by the dashboard (`src/app/page.tsx:43`),
  the cron route's header comment (`route.ts:6`), the proxy's matcher comment
  (`src/proxy.ts:85`), and the design doc's proxy section
  (`docs/technical-design.md:445`). Only `docs/technical-design.md:310`
  documents the actual schedule — a few hundred lines above one of the stale
  mentions.
- **`src/app/settings/settings-client.tsx` copies props into `useState`**
  (`enabled`, `selectedCountry`) — the exact pattern AGENTS.md says shipped
  bugs twice here. It is mostly masked by manual resets in `confirmClear`, but
  a server-side change won't be reflected. Migrate to `useOptimistic` like
  `AddButton`.
- **`addToWatchlist` has a check-then-create race**
  (`src/app/actions.ts:106-118`): a double-click can hit the unique constraint
  and surface "Something went wrong" for an add that effectively succeeded.
  Catch P2002 and return `{ ok: true }`, matching the existing
  "already tracked" intent. The same pattern exists in `setSeasonWatched`'s
  findMany-then-createMany.
- **Episodes deleted upstream are never deleted locally.**
  `syncShowFromTmdb` only upserts, so an episode TMDB removes (it happens
  after schedule reshuffles) lingers and inflates aired counts. Cheap fix:
  delete local episodes for the show whose IDs aren't in the fetched set *and*
  have no `WatchedEpisode` row.
- **`searchSuggestions` has no query length cap** (`src/app/actions.ts:56`) —
  cosmetic, but a `slice(0, 200)` keeps a pasted wall of text from going to
  TMDB verbatim.

## Suggested order of work

1. **#1 and #6** — small diffs, real payoff.
2. **#7 and #8** — the two scaling costs; #8 is also the cron-timeout fix the
   design doc is already tracking.
3. **#2, #4, #5** — a hardening pass, plus writing down the CSRF note while
   in those files.
4. **#3 and the smaller notes**, opportunistically.
