import { prisma } from "@/lib/prisma";
import { syncShowFromTmdb } from "@/lib/shows";
import { TmdbError } from "@/lib/tmdb";

// Refreshes air dates for tracked shows. Called by Vercel Cron twice a day
// (see vercel.json) — TMDB corrects and adds air dates regularly, so the
// upcoming-episodes list would drift without this.

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
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      console.error(`Refresh failed for show ${showId}:`, error);
    }
  }

  return Response.json({
    checked: tracked.length,
    refreshed: refreshed.length,
    failed,
  });
}
