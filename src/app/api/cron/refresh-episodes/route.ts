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
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when the env var is
 * set. Without this check the route is a public endpoint anyone could hammer,
 * burning through the TMDB rate limit.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // No secret configured (e.g. local dev) — allow, but only outside production
  // so a misconfigured deployment fails closed rather than open.
  if (!secret) return process.env.NODE_ENV !== "production";

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

  const tracked = await prisma.trackedShow.findMany({
    select: { showId: true },
  });

  const refreshed: string[] = [];
  const failed: Array<{ showId: string; error: string }> = [];

  // Sequential on purpose: a handful of shows at a time keeps us well under
  // TMDB's rate limit, and the cron has no deadline pressure.
  for (const { showId } of tracked) {
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

  const durationMs = Date.now() - startedAt;

  logger.info("cron.refresh.completed", {
    checked: tracked.length,
    refreshed: refreshed.length,
    failed: failed.length,
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
