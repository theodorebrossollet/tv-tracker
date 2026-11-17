# TV Tracker — iOS app scope (v3)

Builds on `AGENTS.md` (how the app works today) and `docs/scope-v2.md`, which
chose a PWA over a native app. This doc reverses that one decision and says
why; the technical half is `docs/technical-design-ios.md`.

**Status: prep.** Nothing here is built. The visual design is being decided on
a private design canvas ("TV Tracker for iPhone", built on the Marquee design
system), and the open questions at the end are settled there or in review of
this doc before any code is written.

## Why now, and what changed

`scope-v2.md` rejected a native app because it meant "maintaining two
codebases indefinitely for a handful of users". That cost is unchanged and is
accepted knowingly. What changed:

- **Push notifications.** `Settings.notifyEnabled` has been a toggle that
  sends nothing since v2. New episodes and movie releases are the feature the
  app is missing most, and a native app makes them reliable (an installed iOS
  PWA can receive Web Push, but it is the weaker path on iOS).
- **Native feel.** Swipe actions, sheets, haptics, Liquid Glass and the
  system tab bar, Keychain autofill and Face ID. The PWA imitates these; a
  SwiftUI app gets them from the platform.
- **An Apple Developer account**, which removes the distribution cost that
  `scope-v2.md` also counted against native.

## Decisions made

- **SwiftUI, written from scratch.** Not a web-view shell (Capacitor) and not
  React Native. A shell was the cheaper option and was turned down because
  native feel is the point.
- **Audience: the owner only, through TestFlight.** No App Store listing.
  Internal testing needs no beta review, but builds expire after 90 days, so a
  build is re-uploaded at least that often. Public-listing requirements (in-app
  account deletion, review demo account, privacy policy page, guideline 4.2)
  are out of scope, and nothing here should make adopting them harder later.
- **The web app stays, and stays the source of truth.** Same database, same
  account, same server. The iOS app is a second client of the same Next.js
  deployment, reached through a new JSON API. Nothing moves off the web.
- **One design system for both.** Marquee, now kept as a design system
  artifact filled from `src/app/globals.css`. Dark only, white accent, amber
  `highlight`, Inter Tight. The iOS app translates it to platform idioms
  rather than imitating the web pixel for pixel.

## In the first TestFlight build

Everything used daily:

1. **Sign in** with nickname and password; the session is stored in the
   Keychain. Face ID to open the app, if chosen.
2. **Watching**: the hero (next episode ready), Continue watching, upcoming
   episodes and upcoming movies. Mark watched from a button or a leading
   swipe.
3. **Show page**: header, seasons, episodes, mark/unmark episodes and seasons,
   episode ratings, status (watching, paused, stopped, watchlist), Where to
   watch, Start over.
4. **Movie page**: status, rating, Watch again, Where to watch.
5. **Library**: Shows/Movies, Watchlist/Archive, rows or posters.
6. **Search**: shows and movies, add to watchlist, add to a list.
7. **Lists**: view, create, edit, add/remove, together-list ticks.
8. **Discover**: the swipe deck, Pick for tonight, dismiss.
9. **Push notifications**: new episodes of shows you're watching and digital
   releases of watchlist movies, with a "Mark watched" action on episode
   notifications. Preferences in Settings.
10. **Settings / profile**: nickname, stats, country, streaming services,
    notifications, sign out.

## Stays on the web, linked from the app

Rare or account-level, and each already has a working web screen:

- First-time sign-in with an account code, `/welcome`, and code recovery.
- Change password, Sign out everywhere, Clear all my data.
- Reset history on a title (destructive and rare; may move in later).

## Not in scope

- Widgets, Live Activities, a Share extension, iPad and Mac layouts, offline
  writes. Each is a reasonable follow-up once the app exists.
- Android.
- Any change to what the web app does, beyond the API and push work the iOS
  app needs.

## Success criteria

- The owner uses the iOS app instead of the PWA for a week without needing the
  web for anything in "In the first TestFlight build".
- A new episode of a watched show produces exactly one notification per show
  per day, and "Mark watched" on it works without opening the app.
- Every web test still passes, and the new API is covered by the same kinds
  of tests as pages (gates, per-user isolation).

## Open questions

Settled on the design canvas or in review, before building:

1. Tab bar: the system Liquid Glass tab bar with Search split off to the right
   (the canvas default), or the web's custom five-tab capsule.
2. Watching hero: full-bleed backdrop (as on the web) or a compact card.
3. Fonts: Inter Tight everywhere, or SF Pro for body text with Inter Tight for
   titles.
4. Notification timing: per show when episodes come out (checked once a day),
   or one daily digest at a chosen time. Either needs a scheduler beyond
   today's single 06:00 UTC cron; see the technical design.
5. Movie releases: digital only, or cinema too.
6. Face ID on open: on by default, opt-in, or not at all.
