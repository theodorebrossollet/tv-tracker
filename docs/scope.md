# TV Tracker — Project Scope

## Overview
A web app to track TV shows you've watched, replacing TV Time. **v1 is a single-user proof of concept** — just for you, not shared with anyone else — to validate the core idea works end-to-end before investing in multi-user support. Movies and multi-user access are Phase 2 additions.

## Tech Stack (beginner-friendly, low maintenance)
- **Framework:** Next.js (React) — one codebase for frontend + backend
- **Database:** SQLite via Prisma — no separate database server to manage
- **Data source:** TMDB API (free) — show metadata, posters, episode lists and release dates
- **Auth:** None in v1 (single user, not shared). Phase 2 will add either Google login or an anonymous account-code login — open question, see Phase 2.
- **Hosting:** Vercel free tier — connects to GitHub, deploys automatically on push
- **Why this stack:** minimal moving parts, huge amount of documentation/examples online, and Claude Code can scaffold all of it quickly.

## MVP Features (v1 — build this first)
1. **Search** — look up shows via TMDB, as an overlay opened from anywhere with live as-you-type results
2. **Track shows** — a single "+" adds a show to the watchlist; it moves to "watching" automatically once you mark an episode watched
3. **Watchlist** — "want to watch" list
4. **Upcoming episodes** — future episodes across *both* lists (via TMDB release dates)
5. **Where to watch** — streaming availability per show, defaulting to your country with a dropdown for others
6. **Episode detail** — runtime and a per-episode synopsis (collapsed by default), plus an inline trailer on each show page
7. **Settings page** — country, notification preferences, option to clear all data
8. **Paused shows** — set a started show aside without losing its history; it leaves Watching and Upcoming but keeps its progress

### User Stories (v1)
- As a user, I want to search for a show so I can start tracking it.
- As a user, I want to mark episodes as watched so my progress is saved.
- As a user, I want to add shows to a watchlist so I remember what to start later.
- As a user, I want to see which upcoming episodes are coming for my tracked shows so I know when to watch next.
- As a user, I want to clear my data if I want to start fresh.
- As a user, I want to open a show from a search result and read about it before deciding to add it.
- As a user, I want to hide shows I've finished so my Watching list stays useful.
- As a user, I want to know which service a show is on in my country.

### Success Criteria (v1 "done")
You can search for and track a show, mark episodes watched, and see an accurate upcoming-episodes list — running reliably with no crashes during normal use.

### Non-Functional Expectations (v1)
- Single user (you) — no multi-user concerns for v1
- Should work on both desktop and mobile browsers (responsive, not a dedicated mobile app)
- "Best effort" uptime — no formal SLA, occasional downtime for updates is fine
- ~~Data resets on redeploy are accepted for v1 (SQLite on Vercel doesn't persist across deploys)~~ — no longer applies: v1 uses Turso, so data persists. See technical design doc, section 10.

## Phase 2 (after MVP works)

**v2 scope is decided and narrower than the list below: accounts (anonymous
account-code login) and a PWA, and nothing else.** See `docs/scope-v2.md` and
`docs/technical-design-v2.md`. Everything else in this section is deferred
past v2 — kept here as the original brainstorm, not as a build plan.

- **Account system** — multi-user support, so friends/family can each have their own private tracking data. ~~Open question, not yet decided: Google OAuth login vs. anonymous account-code login~~ **Decided for v2: anonymous account-code login** (Mullvad-style) — prioritizes staying data-minimal over self-serve recovery, since this is a closed group of friends/family, not public signup. See `docs/scope-v2.md`.
- ~~**Persistent database** — move from local SQLite file to a hosted SQLite-compatible service (e.g., Turso), so data survives redeploys~~ **Done in v1** — had to be pulled forward, since a local SQLite file isn't writable on Vercel at all. See the technical design doc, section 10.
- Movies (search, tracking, watchlist)
- Ratings — 1–5 rating per show/movie
- Basic profile page — see your own watched list and stats (shows completed, episodes watched)
- Notes/reviews per episode or show
- Stats dashboard (hours watched, favorite genres, etc.)
- Notifications for new episodes of shows you're watching

### Shared password — removed

**Done.** `APP_PASSWORD` and `src/proxy.ts` were deleted once every page and
server action checked a real session. The gate existed only because v1 had no
auth; keeping it afterwards would have added a browser prompt in front of the
app's own login page and a second credential to remember, while guarding
nothing.

What replaced each thing it was doing:

- **Covering un-gated routes.** Every page uses `requireOnboardedSession()` and
  every action opens with it — audited route by route before the gate came off.
  The cron route still authenticates itself with `CRON_SECRET`.
- **Slowing down guessing.** Per-account backoff in
  `src/lib/login-throttle.ts`, since the login form is now reachable by anyone
  who finds the URL. The optional Vercel Firewall rule in the README is defence
  in depth on top.
- **Keeping preview deployments closed.** Real auth covers them now: every
  Vercel preview URL requires a sign-in, the same as production. The v1 concern
  was that previews had no auth at all.

## Ideas for the Future (not scheduled, just captured)
- See friends' activity (since it's for friends/family)

## Explicitly Out of Scope (for now)
- Public sign-ups / arbitrary strangers using it
- ~~Native mobile app~~ — v2 adds a PWA instead (installable, no app store); a true native app remains out of scope, see `docs/scope-v2.md`
- Social features beyond friends/family (comments, follows, etc.)
- Payment/subscription anything
- Any login/multi-user support in v1 (deferred to v2, see `docs/scope-v2.md`)

## Security & Privacy Best Practices
**Secrets**
- Never commit secrets to GitHub — keep the TMDB API key in `.env` (gitignored) locally and in Vercel's environment variables in production. (Built as `.env` rather than `.env.local`: Prisma's CLI reads `.env`, and one file is less confusing than two. Both are gitignored.)

**Data**
- Prisma parameterizes queries by default — don't bypass it with raw/hand-built SQL strings
- v1 collects no personal data at all — no accounts, no email, nothing. Just your own show/episode tracking data.
- No analytics/ad trackers/third-party cookies — keeps things simple and avoids needing a cookie-consent banner

**Carried into Phase 2 (once accounts exist)**
- Whichever login method is chosen (Google or anonymous code), manage secrets via environment variables, never commit them
- Let Auth.js (if Google is chosen) manage sessions with its defaults (HttpOnly, encrypted, secure cookies)
- Keep dependencies updated (monthly `npm update` is enough at this scale)
- Account deletion must actually delete the data, not just deactivate the account
- Don't expose personal info (e.g., email) beyond login/account identification

## Assumptions & Open Risks
- TMDB's free API tier is assumed sufficient — not yet verified against their rate limits
- "Upcoming episodes" accuracy depends entirely on TMDB's data being correct/up to date — no fallback if it's wrong or delayed
- ~~Phase 2 login method (Google vs. anonymous) is still undecided~~ — decided for v2: anonymous account-code. See `docs/scope-v2.md`.

## Next Steps
1. Get a free TMDB API key (themoviedb.org → API settings)
2. Create a GitHub account/repo for the project (if you don't have one)
3. Open the project folder in Claude Code and hand it this scope doc as the starting brief

_(All three done — see the README for how to run it.)_
