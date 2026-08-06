"use server";

import { revalidatePath } from "next/cache";

import {
  isUniqueConstraintError,
  toResult,
  type ActionResult,
} from "@/lib/action-result";
import { MAX_PROVIDERS } from "@/lib/alternate-countries";
import { requireOnboardedSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { isTmdbShowId } from "@/lib/show-id";
import { refreshShowDeduped, syncShowFromTmdb } from "@/lib/shows";
import { searchTvShows, type TmdbSearchResult } from "@/lib/tmdb";
import type { TrackStatus } from "@/lib/types";

// Every write in the app that isn't an account operation — those live in
// `app/account-actions.ts`, and the rules below govern them too.
//
// Every action here starts with `requireOnboardedSession`, and scopes its
// Prisma calls by the userId it returns. Both halves matter and neither is
// optional: server actions are reachable by direct POST, so the gate is the
// only thing standing in front of them — and a forgotten `userId` filter leaks
// another account's data on a read, or corrupts it on a write.
//
// The gate goes ABOVE each `try`, never inside. `redirect` works by throwing,
// and `toResult` would swallow it into a generic error toast.
//
// What stops a malicious page from POSTing clearAllData on your behalf is not
// the session cookie — it is SameSite=Lax plus Next's own CSRF check on server
// actions, which compares the request's `Origin` to the `Host` (or
// `X-Forwarded-Host`) and rejects mismatches. That control is load-bearing and
// invisible, so two things follow:
//
//   - `experimental.serverActions.allowedOrigins` is the knob that widens it.
//     It is absent from next.config.ts today, which is the safe default —
//     same-origin only. Adding a domain there weakens exactly this protection.
//   - Route handlers get none of it, and none of the session gate either. The
//     cron route is safe because it checks its own bearer token; any future
//     route handler must bring its own auth. There is no longer a shared
//     password sitting in front of everything to catch what a route forgets.

/**
 * Refreshes every route that can show a show's tracked state or progress.
 *
 * One layout-level call rather than four path-level ones. Note this is wider
 * than what it replaced — it invalidates everything under the root layout, not
 * three fixed paths plus one show — which is fine here only because every route
 * in the app is `force-dynamic` and re-renders on request anyway. What these
 * calls actually buy is purging the *client* router cache, which is what would
 * otherwise show a stale count after navigating back.
 *
 * The narrow version was also easy to get wrong: each new route that displays
 * progress had to remember to add itself here, and a missing line looks like
 * nothing at all.
 *
 * The settings actions used to reach for `revalidatePath("/show", "layout")`
 * instead, which is not a narrower version of this — it is very likely nothing
 * at all. `type: "layout"` names the `layout.tsx` *at that segment*, and there
 * is no `app/show/layout.tsx`; the route is `/show/[id]`, and Next's own
 * documentation says a path with a dynamic segment has to be spelled out as the
 * pattern. A call that matches no layout fails silently, and the symptom is
 * three navigations away: change your country, go back to a show page you have
 * already opened, and read last country's availability out of the client router
 * cache. Use this instead — it is the one form documented to cover everything
 * beneath the root layout, which includes every show page.
 */
function revalidateShowViews() {
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchSuggestion {
  id: string;
  name: string;
  posterPath: string | null;
  firstAirYear: string | null;
  status: TrackStatus | null;
}

/**
 * Backs the search overlay's as-you-type suggestions. Results aren't cached in
 * the database until a show is actually opened or added.
 */
export async function searchSuggestions(
  query: string,
): Promise<{ results?: SearchSuggestion[]; error?: string }> {
  const { user } = await requireOnboardedSession();

  // Capped rather than rejected: TMDB has nothing useful to say about a pasted
  // wall of text, and sending it verbatim helps no one.
  const trimmed = query.trim().slice(0, 200);
  if (!trimmed) return { results: [] };

  let results: TmdbSearchResult[];
  try {
    results = await searchTvShows(trimmed);
  } catch (error) {
    return { error: toResult(error).error };
  }

  // One query for the whole page of results, rather than one per row.
  const tracked = await prisma.trackedShow.findMany({
    where: {
      userId: user.id,
      showId: { in: results.map((result) => String(result.id)) },
    },
    select: { showId: true, status: true },
  });
  const statusByShow = new Map(tracked.map((row) => [row.showId, row.status]));

  return {
    results: results.slice(0, 12).map((result) => {
      const id = String(result.id);

      return {
        id,
        name: result.name,
        posterPath: result.posterPath,
        firstAirYear: result.firstAirYear,
        status: (statusByShow.get(id) ?? null) as TrackStatus | null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tracking
//
// There is only one way a show enters your lists: the "+" button puts it on the
// watchlist. It graduates to "watching" on its own the moment you mark any
// episode watched — which is the point at which "watching" becomes true.
// ---------------------------------------------------------------------------

/** Adds a show to the watchlist, caching it from TMDB on the way in. */
export async function addToWatchlist(tmdbShowId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Actions are POST-able directly, so this is an entry point for untrusted
  // input regardless of what the UI sends. The id reaches a TMDB request path
  // from here, via syncShowFromTmdb.
  if (!isTmdbShowId(tmdbShowId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const existing = await prisma.trackedShow.findUnique({
      where: { userId_showId: { userId: user.id, showId: tmdbShowId } },
      select: { id: true },
    });

    // Already tracked — don't demote a show you're watching back to the
    // watchlist just because the button was pressed again.
    if (existing) return { ok: true };

    await syncShowFromTmdb(tmdbShowId);
    await prisma.trackedShow.create({
      data: { userId: user.id, showId: tmdbShowId, status: "watchlist" },
    });
  } catch (error) {
    // The check above and this create aren't atomic, so a double-click can
    // lose the race and hit the unique constraint. The show is tracked either
    // way, which is all the caller asked for — reporting "something went
    // wrong" for a successful add is the actual bug.
    if (isUniqueConstraintError(error)) return { ok: true };

    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

/** Removes a show from your lists. The cached show/episode rows stay. */
export async function removeShow(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Never reaches TMDB, but the guard holds the invariant uniformly: every
  // showId an action accepts is an id, not just the ones that hit the network.
  // Real rows can't have a non-id key, so this rejects nothing legitimate.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    // `userId` is what keeps this from removing the show for everyone who
    // tracks it. In v1 the filter was incidentally unique; now it is the only
    // thing scoping the delete.
    await prisma.trackedShow.deleteMany({ where: { userId: user.id, showId } });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Watch progress
// ---------------------------------------------------------------------------

/**
 * Marks an episode watched and promotes its show to "watching".
 *
 * The promotion also covers shows that were never added at all: marking an
 * episode watched is a clearer statement of intent than pressing "+", so it
 * creates the tracked row rather than silently recording progress for a show
 * that appears on no list.
 *
 * It also un-pauses. Watching an episode of a paused show is the clearest
 * possible signal you've picked it back up, so there's no separate "resume"
 * action to find.
 */
export async function markEpisodeWatched(
  episodeId: string,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  try {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { showId: true },
    });

    if (!episode) return { ok: false, error: "Unknown episode." };

    // Concurrent, because they touch different rows and neither reads what the
    // other writes. Turso is a network hop per statement, and this is the most
    // tapped action in the app.
    //
    // The ordering that *does* matter is `previous` versus the upsert below:
    // it exists to spot a show coming back from paused or stopped, and the
    // upsert overwrites exactly the status it reads. Reading it after would
    // report every resumed show as already "watching" and the log would
    // silently stop firing — so it stays here, before the write.
    const [, previous] = await Promise.all([
      prisma.watchedEpisode.upsert({
        where: { userId_episodeId: { userId: user.id, episodeId } },
        create: { userId: user.id, episodeId },
        update: {},
      }),
      prisma.trackedShow.findUnique({
        where: { userId_showId: { userId: user.id, showId: episode.showId } },
        select: { status: true },
      }),
    ]);

    await prisma.trackedShow.upsert({
      where: { userId_showId: { userId: user.id, showId: episode.showId } },
      create: { userId: user.id, showId: episode.showId, status: "watching" },
      update: { status: "watching" },
    });

    if (previous?.status === "paused" || previous?.status === "stopped") {
      logger.info("show.resumed", {
        userId: user.id,
        showId: episode.showId,
        via: "watched_episode",
        from: previous.status,
      });
    }

    revalidateShowViews();
  } catch (error) {
    return toResult(error);
  }

  return { ok: true };
}

/**
 * Drops a show back to the watchlist once it has no watched episodes left.
 *
 * This is the exact inverse of the promotion rule: "watching" means at least
 * one episode watched, so undoing the last one has to undo the move as well.
 * Without it, marking an episode by mistake left the show stuck under Watching
 * with zero progress and no way back short of removing and re-adding it.
 *
 * Shows already on the watchlist are untouched, and a show that isn't tracked
 * at all is left alone rather than being added.
 */
async function demoteIfNothingWatched(userId: string, showId: string) {
  const remaining = await prisma.watchedEpisode.count({
    where: { userId, episode: { showId } },
  });

  if (remaining > 0) return;

  // Scoped to "watching" on purpose. A paused show with no watched episodes
  // left is a contradiction anyway, but silently moving it would undo an
  // explicit choice the user made — leave their decision alone.
  const { count } = await prisma.trackedShow.updateMany({
    where: { userId, showId, status: "watching" },
    data: { status: "watchlist" },
  });

  if (count > 0) logger.info("show.demoted_to_watchlist", { userId, showId });
}

/**
 * Sets a started show aside without losing its history.
 *
 * `paused` and `stopped` differ only in intent — coming back versus not — but
 * that intent is the whole point: it's what makes the two lists worth scanning
 * separately months later.
 *
 * Only meaningful from "watching" (or from the other set-aside state, so you
 * can change your mind about which one it is). Setting aside something never
 * started is what the watchlist already is, and doing it to an untracked show
 * would create a tracked row for something never added.
 */
async function setAside(
  userId: string,
  showId: string,
  status: "paused" | "stopped",
): Promise<ActionResult> {
  // Same uniform-invariant guard as removeShow.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  const other = status === "paused" ? "stopped" : "paused";

  try {
    const { count } = await prisma.trackedShow.updateMany({
      where: { userId, showId, status: { in: ["watching", other] } },
      data: { status },
    });

    if (count === 0) {
      return {
        ok: false,
        error: "Only a show you've started can be set aside.",
      };
    }

    logger.info(`show.${status}`, { userId, showId });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

/**
 * How recently a show can have been synced before a manual refresh declines to
 * do it again.
 *
 * This is the rate limit as well as the answer. `syncShowFromTmdb` is the most
 * expensive thing in the app — a request per season, then hundreds of writes —
 * and a server action is POST-able directly, so *something* has to bound it;
 * a cooldown that doubles as "you're already up to date" costs no extra
 * infrastructure and no extra table.
 *
 * Note `lastSynced` is global rather than per-user: the Show/Episode cache is
 * shared. If someone else refreshed the same show two minutes ago, this
 * returns success without fetching, which is correct — the data really is
 * fresh — but it is worth knowing before it reads as a bug.
 */
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Re-syncs one show from TMDB, on demand.
 *
 * The cron visits tracked shows daily and `ensureShowCached` re-syncs an
 * untracked one on view once it is a day stale; neither is something the reader
 * can ask for. This is, and it is the only path that blocks on the result.
 *
 * Success is decided by whether `lastSynced` moved, not by catching an error.
 * `refreshShowDeduped` never rejects, and a sync that lost the primary-key race
 * against another instance still left the timestamp advanced — treating that as
 * a failure would report "couldn't reach TMDB" for a refresh that worked.
 */
export async function refreshShow(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Same uniform-invariant guard as removeShow. This one does reach TMDB.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const before = await prisma.show.findUnique({
      where: { id: showId },
      select: { lastSynced: true },
    });

    // Nothing cached means nothing to refresh — opening the show is what
    // fetches it in the first place.
    if (!before) return { ok: false, error: "Unknown show." };

    if (Date.now() - before.lastSynced.getTime() < REFRESH_COOLDOWN_MS) {
      return { ok: true };
    }

    await refreshShowDeduped(showId);

    const refreshed = await prisma.show.findUnique({
      where: { id: showId },
      select: { lastSynced: true },
    });

    if (refreshed?.lastSynced.getTime() === before.lastSynced.getTime()) {
      logger.warn("show.refresh_failed", { userId: user.id, showId });
      return { ok: false, error: "Couldn't reach TMDB. Please try again." };
    }

    logger.info("show.refreshed", { userId: user.id, showId });
  } catch (error) {
    return toResult(error);
  }

  // Wider than the show page: a sync can add or move episodes, which changes
  // the upcoming list and every progress count that reads from it.
  revalidateShowViews();
  return { ok: true };
}

/** Set aside, meaning to come back to it. */
export async function pauseShow(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();
  return setAside(user.id, showId, "paused");
}

/** Set aside for good. */
export async function stopShow(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();
  return setAside(user.id, showId, "stopped");
}

/**
 * Puts a paused or stopped show back on the watching list without marking
 * anything watched — resuming a show you're behind on shouldn't require
 * pretending you've seen an episode.
 */
export async function resumeShow(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Same uniform-invariant guard as removeShow.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const { count } = await prisma.trackedShow.updateMany({
      where: { userId: user.id, showId, status: { in: ["paused", "stopped"] } },
      data: { status: "watching" },
    });

    if (count === 0) {
      return { ok: false, error: "That show isn't paused or stopped." };
    }

    logger.info("show.resumed", { userId: user.id, showId, via: "explicit" });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

/**
 * Unmarks an episode, and returns the show to the watchlist if that was the
 * last watched episode.
 */
export async function unmarkEpisodeWatched(
  episodeId: string,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  try {
    // Independent: the delete is keyed by user and episode id, so it doesn't
    // need the lookup's answer. Only the demotion check that follows does.
    const [episode] = await Promise.all([
      prisma.episode.findUnique({
        where: { id: episodeId },
        select: { showId: true },
      }),
      prisma.watchedEpisode.deleteMany({
        where: { userId: user.id, episodeId },
      }),
    ]);

    if (episode) await demoteIfNothingWatched(user.id, episode.showId);

    revalidateShowViews();
  } catch (error) {
    return toResult(error);
  }

  return { ok: true };
}

/** Marks every already-aired episode of a season watched, or clears them all. */
export async function setSeasonWatched(
  showId: string,
  seasonNumber: number,
  watched: boolean,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // Same uniform-invariant guard as removeShow.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    // The caller's own watch marks come back with the episodes rather than in
    // a second query — which is what the separate "already watched" read below
    // used to be. Scoped by userId, or it would carry everyone's marks and
    // decide there was nothing left to insert.
    const episodes = await prisma.episode.findMany({
      where: {
        showId,
        seasonNumber,
        airDate: { not: null, lte: new Date() },
      },
      select: {
        id: true,
        watched: { where: { userId: user.id }, select: { id: true } },
      },
    });

    const episodeIds = episodes.map((episode) => episode.id);

    if (watched) {
      // SQLite doesn't support `skipDuplicates`, so filter out the episodes
      // that are already marked instead of relying on conflict handling.
      const missing = episodes
        .filter((episode) => episode.watched.length === 0)
        .map((episode) => episode.id);

      // Concurrent rather than sequential: different rows, and neither reads
      // the other. Not a `$transaction` — the insert tolerates a lost race and
      // the promotion must survive one, but a transaction would roll the
      // promotion back along with it.
      await Promise.all([
        // Same race as addToWatchlist: another click can mark an episode
        // between the read above and this insert. The season ends up fully
        // marked either way, so a lost race isn't a failure worth reporting.
        missing.length > 0
          ? prisma.watchedEpisode
              .createMany({
                data: missing.map((episodeId) => ({
                  userId: user.id,
                  episodeId,
                })),
              })
              .catch((error) => {
                if (!isUniqueConstraintError(error)) throw error;
              })
          : null,

        // Same promotion rule as marking a single episode.
        episodeIds.length > 0
          ? prisma.trackedShow.upsert({
              where: { userId_showId: { userId: user.id, showId } },
              create: { userId: user.id, showId, status: "watching" },
              update: { status: "watching" },
            })
          : null,
      ]);
    } else {
      await prisma.watchedEpisode.deleteMany({
        where: { userId: user.id, episodeId: { in: episodeIds } },
      });

      // Same rule as unmarking a single episode.
      await demoteIfNothingWatched(user.id, showId);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateNotificationPrefs(
  enabled: boolean,
): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  try {
    await prisma.settings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, notifyEnabled: enabled },
      update: { notifyEnabled: enabled },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/settings");
  return { ok: true };
}

/** Sets the default country for streaming availability. "" clears it. */
export async function updateCountry(country: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  const value = country.trim().toUpperCase();

  if (value && !/^[A-Z]{2}$/.test(value)) {
    return { ok: false, error: "Country must be a two-letter code." };
  }

  try {
    await prisma.settings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, country: value || null },
      update: { country: value || null },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/settings");
  revalidateShowViews();
  return { ok: true };
}

/**
 * Sets the streaming services the user already subscribes to — used to flag
 * when a show is already on one of these in a country other than their own.
 * An empty array clears the whole list.
 */
export async function updateProviders(ids: number[]): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  if (
    !Array.isArray(ids) ||
    ids.length > MAX_PROVIDERS ||
    ids.some((id) => !Number.isInteger(id) || id <= 0)
  ) {
    return { ok: false, error: "Invalid provider selection." };
  }

  // Deduplicated: the picker can't produce repeats, but this is POST-able
  // directly, and a stored "8,8,8" would burn the cap on one service.
  const value = ids.length > 0 ? [...new Set(ids)].join(",") : null;

  try {
    await prisma.settings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, providerIds: value },
      update: { providerIds: value },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/settings");
  revalidateShowViews();
  return { ok: true };
}

/**
 * Wipes the user's tracking data. The global Show/Episode cache is kept so
 * re-adding a show doesn't have to re-download everything from TMDB.
 */
export async function clearAllData(): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  try {
    // One transaction, children first: a failure partway through used to leave
    // watch history gone but the tracked shows still listed, which reads as
    // "everything I watched was forgotten" rather than as a failed wipe.
    // The `where` clauses are the only thing between "wipe my data" and "wipe
    // everyone's". In v1 these were bare deleteMany calls on tables that held
    // one user's rows; they are now shared.
    await prisma.$transaction([
      prisma.watchedEpisode.deleteMany({ where: { userId: user.id } }),
      prisma.trackedShow.deleteMany({ where: { userId: user.id } }),
      prisma.settings.deleteMany({ where: { userId: user.id } }),
    ]);
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
