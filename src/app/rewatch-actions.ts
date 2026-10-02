"use server";

import { Prisma } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";

import { toResult, type ActionResult } from "@/lib/action-result";
import { requireOnboardedSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MAX_PAST_RUNS } from "@/lib/rewatch";
import { isTmdbShowId } from "@/lib/show-id";

// Watching a show or movie again.
//
// Split from `app/actions.ts` for size, but **every rule in that file's header
// applies here unchanged**: each action starts with `requireOnboardedSession`
// and scopes every statement by the `userId` it returns, because actions are
// POST-able directly and the gate is the only thing in front of them. That
// also means every argument is validated, whatever its TypeScript type says.
// The gate goes ABOVE each `try`, never inside — `redirect` works by throwing
// and `toResult` would swallow it.
//
// A "use server" module may export only async functions, so the helpers below
// stay unexported.

/** Same reasoning as `revalidateShowViews` in `app/actions.ts`. */
function revalidateRewatchViews() {
  revalidatePath("/", "layout");
}

const NOTHING = { ok: false, error: "Nothing to start over." } as const;
const limitMessage = () =>
  `This show has reached the limit of ${MAX_PAST_RUNS} past runs.`;

/**
 * Archives the caller's current run of a show and clears it, so the show reads
 * as unwatched again and is back in Watching.
 *
 * Four raw statements in ONE array-form `$transaction` (the form `clearAllData`
 * uses; it runs as a single batch on the libSQL adapter), so the copy and the
 * delete see the same rows and a watch mark made mid-restart can never be
 * deleted without having been archived. Raw because the archive is an
 * INSERT ... SELECT, which Prisma cannot express; the run id is generated here
 * and referenced by value, which is what lets the statements be independent.
 *
 * The reads above the transaction are only for friendly messages and a fast
 * path: a concurrent call, or an unmark of the last episode, can invalidate
 * them before the write runs. So the ShowRun insert is itself conditional in
 * SQL (something is watched AND fewer than MAX_PAST_RUNS runs exist), and the
 * other three statements run only if that row exists. Two racing calls
 * therefore produce one run, and a restart with nothing to archive is a no-op
 * rather than an empty run that counts toward the cap. `runNumber` is computed
 * in SQL inside the same transaction; writes are serialized, so the unique
 * constraint is only a backstop.
 *
 * `watchedAt` is copied as stored (ISO text); the one date written here is
 * bound as a JS `Date`, the format Prisma and the driver agree on.
 */
export async function startShowOver(showId: string): Promise<ActionResult> {
  const { user } = await requireOnboardedSession();

  // `regex.test` coerces a number to a string, so the type is checked first.
  if (typeof showId !== "string" || !isTmdbShowId(showId)) {
    return { ok: false, error: "Missing show id." };
  }

  try {
    const tracked = await prisma.trackedShow.findUnique({
      where: { userId_showId: { userId: user.id, showId } },
      select: { showId: true },
    });
    if (!tracked) return { ok: false, error: "Show isn't on your lists." };

    const [watched, pastRuns] = await Promise.all([
      prisma.watchedEpisode.count({
        where: { userId: user.id, episode: { showId } },
      }),
      prisma.showRun.count({ where: { userId: user.id, showId } }),
    ]);
    if (watched === 0) return NOTHING;
    if (pastRuns >= MAX_PAST_RUNS) return { ok: false, error: limitMessage() };

    const runId = crypto.randomUUID();
    const archivedAt = new Date();

    const ran = Prisma.sql`EXISTS (SELECT 1 FROM "ShowRun" WHERE "id" = ${runId})`;
    const [inserted] = await prisma.$transaction([
      prisma.$executeRaw`
        INSERT INTO "ShowRun" ("id", "userId", "showId", "runNumber", "archivedAt")
        SELECT ${runId}, ${user.id}, ${showId}, n, ${archivedAt}
        FROM (
          SELECT COALESCE(MAX("runNumber"), 0) + 1 AS n, COUNT(*) AS c
          FROM "ShowRun"
          WHERE "userId" = ${user.id} AND "showId" = ${showId}
        )
        WHERE c < ${MAX_PAST_RUNS}
          AND EXISTS (
            SELECT 1 FROM "WatchedEpisode" w
            JOIN "Episode" e ON e."id" = w."episodeId"
            WHERE w."userId" = ${user.id} AND e."showId" = ${showId}
          )
      `,
      prisma.$executeRaw`
        INSERT INTO "ArchivedEpisodeWatch" ("id", "runId", "episodeId", "watchedAt", "rating")
        SELECT lower(hex(randomblob(16))), ${runId}, w."episodeId", w."watchedAt", w."rating"
        FROM "WatchedEpisode" w
        JOIN "Episode" e ON e."id" = w."episodeId"
        WHERE w."userId" = ${user.id} AND e."showId" = ${showId}
          AND ${ran}
      `,
      prisma.$executeRaw`
        DELETE FROM "WatchedEpisode"
        WHERE "userId" = ${user.id}
          AND "episodeId" IN (SELECT "id" FROM "Episode" WHERE "showId" = ${showId})
          AND ${ran}
      `,
      prisma.$executeRaw`
        UPDATE "TrackedShow" SET "status" = 'watching'
        WHERE "userId" = ${user.id} AND "showId" = ${showId}
          AND ${ran}
      `,
    ]);

    if (inserted === 0) {
      // Lost a race after the reads above. Tell the two causes apart.
      const left = await prisma.watchedEpisode.count({
        where: { userId: user.id, episode: { showId } },
      });
      return left === 0 ? NOTHING : { ok: false, error: limitMessage() };
    }
  } catch (error) {
    return toResult(error);
  }

  revalidateRewatchViews();
  return { ok: true };
}
