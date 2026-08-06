# TV Tracker — Roadmap

A running list of feature ideas beyond what's already planned in
[scope.md](scope.md). Nothing here is scheduled or committed — it's a place to
capture ideas as they come up, to revisit once the current phase is done.

## Ideas

- **Shared watchlists** — let another user (friend/family) see or contribute to
  a watchlist, not just their own private one
- **Rewatching** — mark a show/episode as watched again without losing the
  original watch history (currently, watched state doesn't distinguish "first
  watch" from "rewatch")
- **Mobile app** — native app rather than the responsive web view (currently
  listed as explicitly out of scope in [scope.md](scope.md); revisit that if
  this gets prioritized)
- **Calendar view** — a calendar showing upcoming episode releases across
  tracked shows, as an alternative to the existing upcoming-episodes list
- **Export personal data as CSV** — download your own tracked shows/watched
  episodes from Settings

## Shipped from the phone redesign (Aug 2026)

The redesign shipped as a presentation-layer change across seven pull requests,
then pull-to-refresh in two: the server action with a tappable strip, and the
gesture over the same action.

Kept here because the reasoning outlives the work, and governs anything else
that re-syncs on demand:

- `refreshShowDeduped` (`lib/shows.ts`) dedupes by show id and returns the
  shared promise, so awaiting it *is* a foreground refresh. It never rejects —
  it catches and logs — which is why `refreshShow` decides success by re-reading
  `lastSynced` rather than by catching anything. A sync that lost the
  primary-key race against another instance still moved the timestamp, and
  reporting that as a failure would be wrong.
- The TMDB in-process cache is not in the way: `getShowDetails` and
  `getSeasonEpisodes` go through `tmdbFetch` with `cache: "no-store"`. Only
  providers, regions and trailers go through `cached()`.
- The five-minute cooldown on `lastSynced` is the rate limit *and* the honest
  answer, so no throttling table was needed. `syncShowFromTmdb` is the most
  expensive operation in the app and a server action is POST-able directly, so
  something had to bound it. Note `lastSynced` is global rather than per-user:
  if someone else refreshed the same show two minutes ago, the answer is "up to
  date" without a fetch. Correct, not a bug.
- `getAllEpisodes` walks seasons **sequentially** — eleven round trips for a
  ten-season show — hence `maxDuration = 60` on the show page against a 10s
  default.

The gesture's deciding logic lives in `lib/pull-to-refresh.ts`, apart from the
listeners in `components/use-pull-to-refresh.ts`, because jsdom has neither real
touch nor real scroll: the split is what makes any of it testable. The listener
half remains the one part of this app with no automated coverage at all, and
changes to it need a device — Chrome on Android and an installed iOS PWA both
have their own pull-to-refresh, suppressed by `overscroll-behavior-y: contain`
on `body`.

## Shipped from the second review (5 Aug 2026)

Kept for the reasoning, which outlives the diffs:

- **The login throttle counted a parallel batch as one attempt.** See
  `docs/technical-design-v2.md` §4. The lesson generalises past this counter:
  putting state in the database because instances are short-lived buys nothing
  if the arithmetic on it still happens in Node.
- **Nothing bounded a TMDB request.** Node's fetch defaults to a 300s timeout,
  five times the 60s `maxDuration` on the cron route and the show page, so an
  unresponsive TMDB didn't fail — it took the function down. The cron's
  `DEADLINE_MS` couldn't help: it checks *between* shows, and a show is a
  sequential walk of every season, so one slow show is one unbounded iteration
  and the run dies mid-loop without its completion log or the session sweep.
  `REQUEST_TIMEOUT_MS` in `lib/tmdb.ts` is what makes the deadline real.
- **The service worker's shell cache had no upper bound.** `activate` is the
  only thing that deletes anything and it never runs again, because `sw.js` is
  byte-identical between builds and the browser sees no update to install —
  while every deploy renames every chunk it stores. It grew until the browser
  evicted the origin wholesale. Capped at `MAX_ENTRIES`, anchored to the ~35
  files one build produces.
- **`revalidatePath("/show", "layout")` named a layout that doesn't exist.**
  `app/show/` has no `layout.tsx` and the route is `/show/[id]`; per Next's own
  docs a dynamic segment has to be spelled out as the pattern. A call matching
  no layout fails silently. Both callers use `revalidateShowViews()` now.
- **`msPerShow` divided by shows the deadline never visited** — understating
  the headroom figure on precisely the runs it exists to describe.
- **Search was the one TMDB path a signed-in caller could drive without a
  bound.** Every other expensive path has one; `searchTvShows` now goes through
  the same `cached()` helper as regions and trailers.
- **Links copied the whole URL forward.** Every "show more" and tab link
  reflected every param a visitor arrived with, so a crafted link cost
  params × links of render. `lib/search-params.ts` names the set instead, which
  also documents in one place what a URL here is allowed to say.
- **Isolation coverage had three gaps** — `demoteIfNothingWatched`,
  `searchSuggestions` and `setAside`/`resumeShow`. The first is the one that
  mattered: a `count` through a relation, the exact shape this file exists for.

Not done, and deliberately: the session cookie has no `__Host-` prefix.
Renaming it signs everyone out, which is a real cost against a marginal gain
given `secure` already has to vary by environment for localhost.

## Deferred performance work

Carried over from the security & efficiency review (2 Aug 2026), whose other
findings all shipped. Not a bug — the app is correct and fast enough today.
This is the thing that gets worse as the library grows.

- ~~**Compute bucket counts in SQL.**~~ **Done (6 Aug 2026).** `getTrackedShows`
  no longer ships every episode row to Node. Two raw queries do the work —
  a `GROUP BY` for the counts and `MAX(watchedAt)`, and a `ROW_NUMBER()` window
  for next-unwatched — because neither can be expressed in Prisma's `groupBy`,
  which cannot group by a relation's column.

  Measured on a local file: **75ms → 13ms** at 40 shows × 120 episodes,
  **358ms → 44ms** at 80 × 250. Round trips went from `1 + ceil(episodes / 999)`
  to a flat 3, which matters more in production than locally, since each one is
  a Turso network hop.

  The warning in this entry was the right one and is now the standing risk:
  `getShowBuckets` decides which list a show appears in from these counts, so a
  subtly wrong aggregate files a show under the wrong heading rather than
  erroring. `tests/queries.test.ts` gained cases for the three behaviours that
  are easy to lose in the translation — a watch mark on an unaired episode
  counts as *activity* but not as *progress*, a show with no episodes at all
  still has to render, and next-up crosses season boundaries in season order —
  and `tests/large-library.test.ts` covers sizes where a smeared join would
  still look plausible.

**A correction to what this entry used to say.** It claimed the old read would
eventually *throw*, on SQLite's 32,766 bind-variable cap, because the nested
`watched: { where: { userId } }` select compiles to `episodeId IN (…)`. The cap
is real — a hand-written `IN` list breaks between 32,766 and 33,000 binds — but
this read never reached it: **Prisma chunks a nested relation read at 999 binds
per statement.** A 40,000-episode show cost 44 queries, not an exception. The
claim went unchecked long enough to be repeated as a reason to prioritise the
work; the real reasons are the two measurements above.

The other two items here shipped in the meantime:

- ~~`ShowList` / `UpcomingList` are client components~~ — both are server
  components now, revealing rows through a `?<list>=<n>` search param rather
  than client state. `limitFrom` in `components/show-more-link.tsx` is what
  reads and bounds the value; each list uses its own param so two lists on one
  page expand independently.
- ~~The show page ships the whole provider matrix~~ — it now renders one
  country, chosen by `?country=`, with `pickCountry` holding the
  URL → settings → first-available precedence. `CountrySelect` is the only
  client piece and carries codes and names alone. The cost is a round trip when
  changing country, which is the right trade for a control most people never
  touch on a page that previously always paid for it.

One limit worth knowing rather than fearing, since it is easy to re-derive and
get wrong: SQLite caps bind variables at 32,766, and the write side chunks at
500 for exactly that reason. **Prisma's own reads are not exposed to it** — it
chunks nested relation loads at 999 binds per statement, so a large `IN` list
arrives as many statements rather than one oversized one. Hand-written
`$queryRaw` gets no such help: `Prisma.join` over an unbounded array is the one
place in this codebase that can actually hit the cap. `getTrackedShows` binds
*show* ids there, which is dozens.

## Already captured elsewhere

These are noted in [scope.md](scope.md) under Phase 2 / "Ideas for the
Future" — listed here too so this doc stays the single place to check:

- Movies (search, tracking, watchlist)
- Ratings — 1–5 rating per show/movie
- Notes/reviews per episode or show
- Stats dashboard (hours watched, favorite genres, etc.)
- Notifications for new episodes of shows you're watching
- Basic profile page — watched list and stats
- See friends' activity
