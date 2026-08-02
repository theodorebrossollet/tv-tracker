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
findings all shipped. None of these is a bug — the app is correct and fast
enough today. They are the things that get worse as the library grows, listed
with what would trigger acting on them.

- **Compute bucket counts in SQL.** `getTrackedShows` ships every episode row
  (plus watch marks) of every tracked show to Node to derive four counts and one
  episode name, on **every** dashboard, watchlist and archive render — so the
  payload grows with shows × episodes. At 40 shows × 120 episodes that's ~4,800
  rows per page view. The fix is a grouped aggregate for the counts plus one
  narrow query for next-unwatched. The field-level `select` already in place is
  what keeps it tolerable; the single-pass loop over the result changed the
  constant, not the shape. *Trigger: the dashboard feeling slow, or the library
  passing a few dozen shows with long runs.*
- **`ShowList` / `UpcomingList` are client components for a "show more"
  counter.** The full arrays serialise into the RSC payload and pull
  `AddButton`/`Poster` into the client graph. A server-rendered disclosure, or a
  `?limit=` search param, keeps them on the server — `ShowGrid` shows the
  pattern. *Trigger: page weight, or wanting these lists to work without JS.*
- **The show page ships the whole provider matrix.** ~80 countries plus ~90
  region names go to the `Availability` client component for a dropdown most
  people never open — roughly 30-80KB of flight payload per view. Fetching it
  all server-side is right (it's one TMDB call); *sending* it all is the waste.
  Send the selected country and swap via a server round trip, or at minimum
  strip to countries that actually have providers. *Trigger: mobile page weight.*

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
