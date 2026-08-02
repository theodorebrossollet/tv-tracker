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

## Deferred performance work

Carried over from the security & efficiency review (2 Aug 2026), whose other
findings all shipped. Not a bug — the app is correct and fast enough today.
This is the thing that gets worse as the library grows.

- **Compute bucket counts in SQL.** `getTrackedShows` ships every episode row
  (plus watch marks) of every tracked show to Node to derive four counts and one
  episode name, on **every** dashboard, watchlist and archive render — so the
  payload grows with shows × episodes. At 40 shows × 120 episodes that's ~4,800
  rows per page view. The fix is a grouped aggregate for the counts plus one
  narrow query for next-unwatched. The field-level `select` already in place is
  what keeps it tolerable; the single-pass loop over the result changed the
  constant, not the shape. *Trigger: the dashboard feeling slow, or the library
  passing a few dozen shows with long runs.*

  Worth budgeting properly rather than squeezing in. `getShowBuckets` decides
  which list a show appears in from these counts, so an aggregate that is
  subtly wrong doesn't error — it quietly files a show under the wrong heading.
  Every aggregate also needs its own `userId` filter, or it sums the household.

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

There's also one latent limit worth knowing rather than fixing: the nested
`watched: { where: { userId } }` reads compile to `episodeId IN (…)` with one
bind variable per episode, and SQLite caps those at 32,766. The write side
already chunks at 500 for exactly this reason. A tracked daytime soap (10,000+
episodes) would make the *read* throw. Restructuring falls out of the first item
above, so it's worth doing then rather than on its own.

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
