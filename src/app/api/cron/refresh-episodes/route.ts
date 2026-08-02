import { deleteExpiredSessions } from "@/lib/auth";
import { describeError, logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { syncShowFromTmdb } from "@/lib/shows";
import { TmdbError } from "@/lib/tmdb";

// Refreshes air dates for tracked shows. Called by Vercel Cron once a day, at
// 06:00 UTC (see vercel.json — the Hobby plan allows no more than daily, and
// docs/technical-design.md explains the choice of hour) — TMDB corrects and
// adds air dates regularly, so the upcoming-episodes list would drift without
// this.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * When to stop starting new shows, leaving room inside `maxDuration` for the
 * session sweep and the completion log that follow the loop. Ten seconds is
 * generous for those, and the alternative — being killed mid-show — costs the
 * whole record of the run.
 */
const DEADLINE_MS = 50_000;

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the env var is
 * set. Without this check the route is a public endpoint anyone could hammer,
 * burning through the TMDB rate limit.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // No secret configured (e.g. local dev) — allow, but only outside production
  // so a misconfigured deployment fails closed rather than open.
  if (!secret) return process.env.NODE_ENV !== "production";

  // Plain === rather than a constant-time compare — the same trade the proxy's
  // `matches` documents: CRON_SECRET is a generated 32-byte value, and a
  // timing oracle against a JS string compare buys nothing usable against
  // that. Written down so it reads as a decision, not an oversight.
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    logger.warn("cron.refresh.unauthorized");
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Timed because the run has a deadline: maxDuration is 60s, and the cost per
  // show is what decides how many tracked shows fit inside it. An estimate in
  // a design doc goes stale silently; a number in every run's log doesn't.
  // See "Runtime headroom" in docs/technical-design.md.
  const startedAt = Date.now();

  // `distinct` because the same show tracked by N people is N rows — and each
  // would otherwise cost its own identical TMDB sync inside the 60s budget.
  // The cache being refreshed is global, so this route stays user-agnostic:
  // there is no session here, and it must not acquire one.
  const tracked = await prisma.trackedShow.findMany({
    distinct: ["showId"],
    select: { showId: true },
    // Least recently synced first. Without an order this is whatever the
    // database hands back — stable enough that a run which doesn't finish
    // would refresh the same prefix every night and never reach the tail.
    // Oldest-first makes successive runs rotate through the whole set on
    // their own, and a truncated run still advances the shows furthest behind.
    orderBy: { show: { lastSynced: "asc" } },
  });

  const refreshed: string[] = [];
  const failed: Array<{ showId: string; error: string }> = [];
  let deadlineHit = false;

  // Sequential on purpose: one show at a time keeps us well under TMDB's rate
  // limit. That politeness spends the 60s deadline measured above — when the
  // headroom runs out, parallelise the season fetches inside a show before
  // giving this loop up.
  for (const { showId } of tracked) {
    // Stopping early beats being killed mid-loop. At ~1.1s/show the 60s
    // maxDuration runs out somewhere near 50 shows, and being terminated takes
    // the completion log and the session sweep below with it — so the run
    // leaves no record it happened, and expired sessions quietly stop being
    // deleted. Yielding here keeps both.
    if (Date.now() - startedAt > DEADLINE_MS) {
      deadlineHit = true;
      break;
    }

    try {
      await syncShowFromTmdb(showId);
      refreshed.push(showId);
    } catch (error) {
      // One bad show shouldn't abort the whole run.
      const message =
        error instanceof TmdbError ? error.message : "Unexpected error";
      failed.push({ showId, error: message });
      logger.error("cron.refresh.show_failed", {
        showId,
        ...describeError(error),
      });
    }
  }

  // Piggy-backing on the daily run rather than adding a second schedule:
  // nothing else deletes expired sessions, so without this they accumulate for
  // the lifetime of the database. Done after the refresh so a TMDB outage
  // can't stop it, and outside the loop's error handling because it shares
  // nothing with it.
  const expiredSessions = await deleteExpiredSessions();

  const durationMs = Date.now() - startedAt;

  // A run that hit the deadline is the one worth noticing, and an info line
  // among a year of identical info lines is not noticing. Warnings go to
  // stderr, so this separates itself out without anyone having to remember to
  // grep for `skipped`.
  const log = deadlineHit ? logger.warn : logger.info;

  log("cron.refresh.completed", {
    checked: tracked.length,
    refreshed: refreshed.length,
    failed: failed.length,
    // How many the deadline left untouched. Non-zero is the signal that the
    // library has outgrown one run — they'll be first in line tomorrow, but
    // it's worth knowing before the backlog does something visible.
    skipped: tracked.length - refreshed.length - failed.length,
    deadlineHit,
    expiredSessions,
    durationMs,
    // Pre-divided: this is the figure the timeout headroom is read off, and
    // doing the arithmetic by hand at 6am is how it stops being read at all.
    msPerShow: tracked.length ? Math.round(durationMs / tracked.length) : null,
  });

  return Response.json({
    checked: tracked.length,
    refreshed: refreshed.length,
    failed,
  });
}
