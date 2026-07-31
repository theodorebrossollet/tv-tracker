# Code review — vulnerabilities and inefficiencies

Full-codebase review, 31 July 2026. Every source file, the Prisma schema, the
proxy/auth layer, the cron route, the scripts, and the docs were read.

Overall the codebase is in good shape: the threat model is written down, the
password gate fails closed, Prisma parameterizes every query, and the TMDB key
never leaves the server. The findings below are what remains, ordered by
severity within each section. Nothing in this document has been fixed yet.

## Security findings

### 1. TMDB show IDs are never validated (path/query injection)

`src/app/actions.ts:100`, `src/lib/tmdb.ts:259`

`addToWatchlist`, `getShowDetail`, and every function downstream accept an
arbitrary string and interpolate it into
`new URL(`${TMDB_BASE}/tv/${tmdbShowId}`)`. A value like `1399/season/1` or
`1399?append_to_response=...` redirects the server's request to a different
TMDB endpoint. Both entry points are reachable: server actions accept direct
POSTs, and Next decodes route params, so `/show/1399%2Fseason%2F1` yields the
id `1399/season/1`.

The origin can't be changed — this is not full SSRF — but the response gets
cached as a `Show` row keyed by the raw string, and the string also flows into
`revalidatePath`.

**Fix:** validate `/^\d+$/` once at the entry points (the actions and the show
page) and reject anything else.

### 2. The password-gate comparison is not what its comment claims

`src/proxy.ts:26`

`matches` early-returns on length mismatch, so it leaks the password's
*length* through timing despite the "length-independent" comment. Practically
minor, but the intent was a constant-time compare.

**Fix:** hash both sides with SHA-256 (Web Crypto is available in the proxy
runtime) and compare the digests — constant length, constant time.
Related: the cron route compares its bearer token with plain `===`
(`src/app/api/cron/refresh-episodes/route.ts:25`); give it the same treatment.

### 3. No brute-force throttling on the password gate

`src/proxy.ts`

Basic auth with a single shared password and no rate limiting means anyone who
finds the URL can hammer it, and `clearAllData` sits behind that one password.
Vercel's platform limits help a little.

**Fix:** a per-IP fixed-window counter in the proxy (in-memory is fine for one
instance), or at minimum a short constant delay on failure. Worth doing before
Phase 2.

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

- **Copy drift.** The dashboard says air dates "refresh twice a day"
  (`src/app/page.tsx:43`) and the cron route's header comment says the same
  (`route.ts:6`), but `vercel.json` runs daily at 06:00. The docs explain the
  Hobby-plan downgrade; the UI and route comment didn't get the memo.
- **`settings-client.tsx` copies props into `useState`** (`enabled`,
  `selectedCountry`) — the exact pattern AGENTS.md says shipped bugs twice
  here. It is mostly masked by manual resets in `confirmClear`, but a
  server-side change won't be reflected. Migrate to `useOptimistic` like
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
3. **#2, #4, #5** — a hardening pass.
4. The smaller notes, opportunistically.
