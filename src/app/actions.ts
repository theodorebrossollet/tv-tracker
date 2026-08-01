"use server";

import { revalidatePath } from "next/cache";

import {
  createSession,
  destroySession,
  hashCode,
  requireSession,
} from "@/lib/auth";
import { describeError, logger } from "@/lib/logger";
import { validateNickname } from "@/lib/nickname";
import { prisma } from "@/lib/prisma";
import { isTmdbShowId } from "@/lib/show-id";
import { syncShowFromTmdb } from "@/lib/shows";
import { searchTvShows, TmdbError, type TmdbSearchResult } from "@/lib/tmdb";
import type { TrackStatus } from "@/lib/types";

// v1 has no accounts, so there is no session to check here — every action
// operates on the single implicit user's data. Phase 2 adds an auth check at
// the top of each of these. Note that server actions are reachable by direct
// POST, so this file is effectively public while the app is deployed without
// auth; keep the deployment private until Phase 2 lands.
//
// What stops a malicious page from POSTing clearAllData on your behalf is not
// the password gate. Basic auth is replayed automatically by the browser on
// cross-site requests, so the gate would happily let that through. It's Next's
// own CSRF check on server actions: the request's `Origin` is compared to the
// `Host` (or `X-Forwarded-Host`) and mismatches are rejected. That control is
// load-bearing and invisible, so two things follow:
//
//   - `experimental.serverActions.allowedOrigins` is the knob that widens it.
//     It is absent from next.config.ts today, which is the safe default —
//     same-origin only. Adding a domain there weakens exactly this protection.
//   - Route handlers get none of it. The cron route is safe because it checks
//     its own bearer token; any future route handler must bring its own auth,
//     which is also why the proxy's matcher excludes `/api/cron/` by exact
//     path rather than by prefix.

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Prisma's "unique constraint failed". Two writers raced and the second one
 * lost — which, for a write whose whole point is "make this row exist", means
 * the work is done rather than failed.
 */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Turns an unexpected failure into a message safe to show the user. */
function toResult(error: unknown): ActionResult {
  if (error instanceof TmdbError) {
    return { ok: false, error: error.message };
  }

  logger.error("action.failed", describeError(error));
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Refreshes every route that can show a show's tracked state or progress. */
function revalidateShowViews(showId?: string) {
  revalidatePath("/");
  revalidatePath("/watchlist");
  revalidatePath("/archive");
  if (showId) revalidatePath(`/show/${showId}`);
}

// ---------------------------------------------------------------------------
// Accounts
//
// These three are the only actions that may run without a completed account.
// Everything below them gets `requireOnboardedSession()` in the next stage,
// once queries are scoped by user — adding the gate before the data is
// partitioned would lock the app without making anything private.
//
// Note where the session check sits in `setNickname`: above the `try`, not
// inside it. `requireSession` redirects by throwing, and `toResult` would
// swallow that into a generic error toast.
// ---------------------------------------------------------------------------

export interface LoginResult extends ActionResult {
  /** Where the client should navigate on success. */
  next?: string;
}

/**
 * Exchanges an account code for a session.
 *
 * Returns the destination rather than redirecting, so the redirect happens on
 * the client after the cookie is set — a `redirect()` here would have to live
 * outside the try block that catches database failures, which is more
 * ceremony than a one-line navigation on the caller's side.
 */
export async function login(code: string): Promise<LoginResult> {
  const trimmed = code.trim();

  if (!trimmed) return { ok: false, error: "Enter your account code." };

  try {
    const user = await prisma.user.findUnique({
      where: { codeHash: hashCode(trimmed) },
      select: { id: true, nickname: true },
    });

    // Deliberately the same message whether the code is malformed or simply
    // wrong. There is nothing useful to distinguish, and no account enumeration
    // to enable.
    if (!user) return { ok: false, error: "That code isn't recognised." };

    await createSession(user.id);

    // The code itself is never logged — see the note in lib/logger.ts about
    // TMDB URLs, which applies with more force to a credential that cannot be
    // rotated by its owner.
    logger.info("auth.login", { userId: user.id });

    return { ok: true, next: user.nickname === null ? "/welcome" : "/" };
  } catch (error) {
    return toResult(error);
  }
}

/** Revokes the current session. Succeeds even when there isn't one. */
export async function logout(): Promise<ActionResult> {
  try {
    await destroySession();
  } catch (error) {
    return toResult(error);
  }

  return { ok: true };
}

/**
 * Claims a nickname, once, for the account that's logged in.
 *
 * Permanent by design, and enforced here rather than by hiding the UI: server
 * actions are POST-able directly, so a missing check would let a direct POST
 * rename an account that is supposed to be locked.
 */
export async function setNickname(raw: string): Promise<ActionResult> {
  // Above the try. See the note at the top of this section.
  const session = await requireSession();

  const checked = validateNickname(raw);
  if (!checked.ok) return { ok: false, error: checked.error };

  try {
    // `updateMany` with `nickname: null` in the filter makes "only if unset" a
    // property of the write itself. Reading the current value and then updating
    // would leave a window where two concurrent posts both see null.
    const { count } = await prisma.user.updateMany({
      where: { id: session.user.id, nickname: null },
      data: { nickname: checked.nickname, nicknameKey: checked.key },
    });

    if (count === 0) {
      return {
        ok: false,
        error: "Your nickname is already set and can't be changed.",
      };
    }

    logger.info("auth.nickname_set", { userId: session.user.id });
  } catch (error) {
    // The unique index on `nicknameKey` is what actually decides this, rather
    // than a lookup beforehand — two people claiming the same name at once
    // would both pass a check-then-write.
    if (isUniqueConstraintError(error)) {
      return { ok: false, error: "That nickname is taken." };
    }

    return toResult(error);
  }

  return { ok: true };
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
    where: { showId: { in: results.map((result) => String(result.id)) } },
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
  // Actions are POST-able directly, so this is an entry point for untrusted
  // input regardless of what the UI sends. The id reaches a TMDB request path
  // from here, via syncShowFromTmdb.
  if (!isTmdbShowId(tmdbShowId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const existing = await prisma.trackedShow.findUnique({
      where: { showId: tmdbShowId },
      select: { id: true },
    });

    // Already tracked — don't demote a show you're watching back to the
    // watchlist just because the button was pressed again.
    if (existing) return { ok: true };

    await syncShowFromTmdb(tmdbShowId);
    await prisma.trackedShow.create({
      data: { showId: tmdbShowId, status: "watchlist" },
    });
  } catch (error) {
    // The check above and this create aren't atomic, so a double-click can
    // lose the race and hit the unique constraint. The show is tracked either
    // way, which is all the caller asked for — reporting "something went
    // wrong" for a successful add is the actual bug.
    if (isUniqueConstraintError(error)) return { ok: true };

    return toResult(error);
  }

  revalidateShowViews(tmdbShowId);
  return { ok: true };
}

/** Removes a show from your lists. The cached show/episode rows stay. */
export async function removeShow(showId: string): Promise<ActionResult> {
  // Never reaches TMDB, but the guard holds the invariant uniformly: every
  // showId an action accepts is an id, not just the ones that hit the network.
  // Real rows can't have a non-id key, so this rejects nothing legitimate.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    await prisma.trackedShow.deleteMany({ where: { showId } });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews(showId);
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
  try {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { showId: true },
    });

    if (!episode) return { ok: false, error: "Unknown episode." };

    await prisma.watchedEpisode.upsert({
      where: { episodeId },
      create: { episodeId },
      update: {},
    });

    const previous = await prisma.trackedShow.findUnique({
      where: { showId: episode.showId },
      select: { status: true },
    });

    await prisma.trackedShow.upsert({
      where: { showId: episode.showId },
      create: { showId: episode.showId, status: "watching" },
      update: { status: "watching" },
    });

    if (previous?.status === "paused" || previous?.status === "stopped") {
      logger.info("show.resumed", {
        showId: episode.showId,
        via: "watched_episode",
        from: previous.status,
      });
    }

    revalidateShowViews(episode.showId);
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
async function demoteIfNothingWatched(showId: string) {
  const remaining = await prisma.watchedEpisode.count({
    where: { episode: { showId } },
  });

  if (remaining > 0) return;

  // Scoped to "watching" on purpose. A paused show with no watched episodes
  // left is a contradiction anyway, but silently moving it would undo an
  // explicit choice the user made — leave their decision alone.
  const { count } = await prisma.trackedShow.updateMany({
    where: { showId, status: "watching" },
    data: { status: "watchlist" },
  });

  if (count > 0) logger.info("show.demoted_to_watchlist", { showId });
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
      where: { showId, status: { in: ["watching", other] } },
      data: { status },
    });

    if (count === 0) {
      return {
        ok: false,
        error: "Only a show you've started can be set aside.",
      };
    }

    logger.info(`show.${status}`, { showId });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews(showId);
  return { ok: true };
}

/** Set aside, meaning to come back to it. */
export async function pauseShow(showId: string): Promise<ActionResult> {
  return setAside(showId, "paused");
}

/** Set aside for good. */
export async function stopShow(showId: string): Promise<ActionResult> {
  return setAside(showId, "stopped");
}

/**
 * Puts a paused or stopped show back on the watching list without marking
 * anything watched — resuming a show you're behind on shouldn't require
 * pretending you've seen an episode.
 */
export async function resumeShow(showId: string): Promise<ActionResult> {
  // Same uniform-invariant guard as removeShow.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const { count } = await prisma.trackedShow.updateMany({
      where: { showId, status: { in: ["paused", "stopped"] } },
      data: { status: "watching" },
    });

    if (count === 0) {
      return { ok: false, error: "That show isn't paused or stopped." };
    }

    logger.info("show.resumed", { showId, via: "explicit" });
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews(showId);
  return { ok: true };
}

/**
 * Unmarks an episode, and returns the show to the watchlist if that was the
 * last watched episode.
 */
export async function unmarkEpisodeWatched(
  episodeId: string,
): Promise<ActionResult> {
  try {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: { showId: true },
    });

    await prisma.watchedEpisode.deleteMany({ where: { episodeId } });

    if (episode) await demoteIfNothingWatched(episode.showId);

    revalidateShowViews(episode?.showId);
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
  // Same uniform-invariant guard as removeShow.
  if (!isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const episodes = await prisma.episode.findMany({
      where: {
        showId,
        seasonNumber,
        airDate: { not: null, lte: new Date() },
      },
      select: { id: true },
    });

    const episodeIds = episodes.map((episode) => episode.id);

    if (watched) {
      // SQLite doesn't support `skipDuplicates`, so filter out the episodes
      // that are already marked instead of relying on conflict handling.
      const alreadyWatched = await prisma.watchedEpisode.findMany({
        where: { episodeId: { in: episodeIds } },
        select: { episodeId: true },
      });

      const seen = new Set(alreadyWatched.map((row) => row.episodeId));
      const missing = episodeIds.filter((episodeId) => !seen.has(episodeId));

      // Same race as addToWatchlist: another click can mark an episode between
      // the read above and this insert. The season ends up fully marked either
      // way, so a lost race isn't a failure worth reporting.
      try {
        await prisma.watchedEpisode.createMany({
          data: missing.map((episodeId) => ({ episodeId })),
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }

      // Same promotion rule as marking a single episode.
      if (episodeIds.length > 0) {
        await prisma.trackedShow.upsert({
          where: { showId },
          create: { showId, status: "watching" },
          update: { status: "watching" },
        });
      }
    } else {
      await prisma.watchedEpisode.deleteMany({
        where: { episodeId: { in: episodeIds } },
      });

      // Same rule as unmarking a single episode.
      await demoteIfNothingWatched(showId);
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateShowViews(showId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function updateNotificationPrefs(
  enabled: boolean,
): Promise<ActionResult> {
  try {
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, notifyEnabled: enabled },
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
  const value = country.trim().toUpperCase();

  if (value && !/^[A-Z]{2}$/.test(value)) {
    return { ok: false, error: "Country must be a two-letter code." };
  }

  try {
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, country: value || null },
      update: { country: value || null },
    });
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/settings");
  revalidatePath("/show", "layout");
  return { ok: true };
}


/**
 * Wipes the user's tracking data. The global Show/Episode cache is kept so
 * re-adding a show doesn't have to re-download everything from TMDB.
 */
export async function clearAllData(): Promise<ActionResult> {
  try {
    // One transaction, children first: a failure partway through used to leave
    // watch history gone but the tracked shows still listed, which reads as
    // "everything I watched was forgotten" rather than as a failed wipe.
    await prisma.$transaction([
      prisma.watchedEpisode.deleteMany(),
      prisma.trackedShow.deleteMany(),
      prisma.settings.deleteMany(),
    ]);
  } catch (error) {
    return toResult(error);
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
