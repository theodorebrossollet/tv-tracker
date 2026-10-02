# Lists — design

Sub-project 3 of the movie roadmap in `2026-10-01-movies-core-design.md`.

## Why

The owner wants to keep lists of titles in tv-tracker, including lists to
watch with friends and family, and found Letterboxd's lists buried in the
profile. Lists here are private, per account, never shared. A list is
first-class: it gets its own tab.

## Decisions

- A list holds movies and shows, mixed.
- At creation the owner chooses how "watched" works for that list:
  - **Personal list (default):** items show the title's real status from the
    Library. Marking a movie watched in the list marks it watched everywhere.
  - **"Watching together" list:** each item has its own "we've watched it"
    tick, independent of the Library, with the real status shown beside it.
  - The choice is a per-list switch (`trackSeparately`) and can be changed
    later. Switching it off keeps stored ticks but ignores them.
- Adding a title to a list never adds it to the Library watchlist.
- Lists get a fifth tab. The Search tab stays for now; it can be removed later
  because search is already reachable from each screen's header.
- Titles are added from a title's page ("Add to list" sheet) and from inside a
  list (search overlay in an "adding to this list" mode).
- Order inside a list is fixed: unwatched first, newest added first; watched
  below. Manual ordering is deferred; it needs only an additive `position`
  column when built.
- Rewatching is out of scope. It becomes its own sub-project (rewatch runs for
  shows and movies, history kept), after ratings. Lists show a title's real
  status and need no change when it arrives.

## Roadmap after this

2 ratings (1–10 per movie and per watched episode; season and show are derived
averages), then rewatch runs, then 4 recommendations and pick-for-tonight, then
5 streaming availability and release tracking.

## Scope

In: `List` and `ListItem` tables, the Lists tab and screens, create/edit/delete
list, add/remove items, the per-list tick, "Add to list" on movie and show
pages, an "adding to a list" mode in the search overlay.

Out: sharing, manual ordering, covers or icons, list notes, rewatch, ratings,
a "to watch" count on the index rows.

## Data

One additive migration, two new tables. No existing table changes; it is
applied to Turso by hand after a backup and before the merge.

`List`
- `id` (cuid), `userId`, `name`, `trackSeparately` (boolean, default false),
  `createdAt`
- cascade from `User`; `@@index([userId, createdAt])`
- `name` is trimmed, 1–60 characters; names need not be unique

`ListItem`
- `id` (cuid), `listId`, `movieId?`, `showId?`, `addedAt`, `watchedAt?`
- exactly one of `movieId` / `showId` is set (enforced by the actions, pinned
  by a test; SQLite cannot check it)
- `@@unique([listId, movieId])`, `@@unique([listId, showId])`,
  `@@index([movieId])`, `@@index([showId])`
- cascade from `List`, `Movie` and `Show`
- `watchedAt` counts only while the list's `trackSeparately` is on

Limits: 50 lists per account, 500 items per list.

Adding a title that is not cached caches it the way the Library does and counts
against the matching hourly allowance (60 new movies, 20 new shows). Cached
titles are free. Deleting a list or removing an item deletes list rows only,
never the title or the account's tracking. "Clear all my data" also deletes the
account's lists.

## Rules

- Personal list, movie: unwatched = Library status is not `watched`.
- Personal list, show: watched = finished, using the Library's derived rule in
  `lib/queries.ts`; it is not re-derived elsewhere.
- Together list, any title: unwatched = no `watchedAt` on the item.
- An untracked title on a list shows no status.
- A title appears at most once per list and may be on several lists.
- Another account can never read or change your lists, items or ticks.

## Screens

**Lists tab (`/lists`).** Header "Lists" with a "New list" button. Rows show the
name and "N titles", with a small "Together" label on lists that track
separately. Empty state: "Start your first list" with a "New list" button. The
tab sits between Library and Search and is active for `/lists` and
`/lists/...`.

**Create / edit sheet.** The app's existing sheet: name field, and the switch
"Track what you've watched separately in this list" (off by default, one-line
explanation). The same sheet renames and flips the switch.

**List page (`/lists/[id]`).** Back link, name, "…" menu (Edit list, Delete list
with confirmation), "Add titles" button. Unwatched titles first, watched below
in the quieter section style the Library uses. Rows: poster with the movie/TV
badge, title, year, "…" menu with "Remove from list".
- Personal list: a movie row shows its real status and a one-tap "mark watched"
  (via `setMovieStatus`); a show row shows its real progress and links to the
  show page, with no tick.
- Together list: every row has the list tick, plus a "You've seen this" note
  when the real status says watched.

**Add to list (title pages).** Movie and show pages get an "Add to list" button
opening a sheet of the account's lists as checkboxes plus a "New list" row.

**Add titles (inside a list).** The search overlay opens in an "Adding to
<list name>" mode: tapping a result adds it, results already on the list show a
tick, the overlay stays open, "Done" closes it. In this mode the Library "+" is
replaced by the list control, so nothing reaches the Library by accident.

Each new route has a loading state and its own session gate. Library screens
are unchanged.

## Server side

Writes live in a new `src/app/list-actions.ts`, governed by the rules in
`actions.ts`'s header (gate above each `try`, every Prisma call scoped by user,
arguments validated); AGENTS.md gets a line for the third action module.

- `createList(name, trackSeparately)`: validates and trims, enforces the list
  limit, returns the new id.
- `updateList(listId, { name, trackSeparately })`
- `deleteList(listId)`
- `addToList(listId, kind, titleId)`: item limit, id validation per kind,
  caches an uncached title, creates the item; losing the unique-constraint race
  still reports success.
- `removeFromList(listId, itemId)`
- `setListItemWatched(listId, itemId, watched)`: sets or clears `watchedAt`;
  refused on a list whose `trackSeparately` is off.
- Marking a movie watched on a personal list reuses `setMovieStatus`.

Every action finds the list by `listId` and `userId` together.

Reads in `queries.ts`, all filtered by `userId`:
- `getLists(userId)`: lists with title counts.
- `getListDetail(userId, listId)`: the list, its items with titles and the
  account's own tracking, sorted per the order above.
- `getListsForTitle(userId, kind, titleId)`: lists with an "on this list" flag.
- `searchSuggestions` takes an optional `listId` (checked to belong to the
  caller) and marks each result `onList`.

## Testing

Real database, session gate and TMDB stubbed, as in the movie work.
- Schema: tables, cascades from user/list/movie/show, uniqueness.
- Actions: happy paths; refusals (malformed ids, empty and over-long names, the
  limits at 49/50 lists and 499/500 items); isolation per action; a concurrent
  `addToList` through a slow TMDB stub so the unique-constraint branch really
  runs; `setListItemWatched` refused on a personal list; ticks kept across
  switching the setting off and on.
- Queries: ordering, personal vs together semantics, a show's finished state
  agreeing with the Library, isolation.
- Screens: Lists index and empty state; rows in each mode; the Add-to-list sheet;
  the search "adding" mode (adds, shows ticks, replaces the "+", does not
  navigate); the fifth tab staying active on `/lists/...`.
- Existing guards (route gates, loading states, client boundary) cover the new
  routes; any new "show more" parameter is added to `KNOWN_PARAMS`.
- Edge cases: no poster or year, an untracked title on a list, one title on
  several lists, an empty list, a movie removed from the Library while still on
  a list.

## Risks

- Two meanings of "watched" on one screen (together lists). Mitigated by the
  per-list choice, clear labels, and showing the real status as a separate note.
- Show state on a list reuses the Library's derived-state code; a copy of that
  rule elsewhere would drift (AGENTS.md).
- Not checked on a real phone before release; the fifth tab and the list rows
  need a look on the preview deploy.
