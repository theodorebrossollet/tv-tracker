import { PrismaLibSql } from "@prisma/adapter-libsql";

import { PrismaClient } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import {
  isSchemaMismatch,
  missingSchemaObject,
  SCHEMA_MISMATCH_DIGEST,
} from "@/lib/schema-error";

// One adapter covers both environments, because libSQL speaks plain SQLite
// files as well as Turso's remote protocol:
//
//   local dev    DATABASE_URL="file:./dev.db"        (no auth token)
//   production   DATABASE_URL="libsql://….turso.io"  (+ TURSO_AUTH_TOKEN)
//
// Turso is what makes deploying to Vercel possible at all: Vercel's filesystem
// is read-only outside /tmp, so a local SQLite file there can be read but never
// written to.

// Next.js hot-reloads modules in dev, which would otherwise open a new database
// connection on every reload until the process runs out of handles. Stashing the
// client on globalThis keeps a single instance across reloads.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

function createPrismaClient() {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url.startsWith("libsql://") && !authToken) {
    throw new Error(
      "DATABASE_URL points at Turso but TURSO_AUTH_TOKEN is not set.",
    );
  }

  const adapter = new PrismaLibSql({ url, authToken });

  return new PrismaClient({ adapter }).$extends(schemaMismatchDigest);
}

/**
 * Marks "the database is behind the code" on the error itself, so a *page*
 * render can say so rather than showing the generic failure.
 *
 * Server actions already handled this in `toResult`, but that only ever
 * covered writes. A page that reads a column the database doesn't have throws
 * during render, lands in `app/error.tsx`, and gets "This is usually TMDB
 * being unreachable" — which is exactly the wrong-direction debugging
 * `schema-error.ts` exists to prevent, and which happened for real when the
 * `Settings.providerIds` migration hadn't been applied yet: every page reading
 * Settings blamed TMDB.
 *
 * Done here rather than per page because the alternative is a convention every
 * future page has to remember, for a failure nobody sees until a migration is
 * late. Every read in the app goes through this client.
 *
 * The original error is rethrown with a property added, not replaced: the
 * detection in `toResult` matches on the driver's own message, so wrapping it
 * would break the path that already worked.
 *
 * `$allOperations` sits at the top level rather than under `$allModels` so it
 * covers raw queries too — nothing here uses one today, but a missing *table*
 * surfaces through a raw query, which is half of what `isSchemaMismatch`
 * recognises.
 *
 * Exported for `tests/schema-error-digest.test.ts`, which applies it to its own
 * client pointed at a deliberately incomplete database — the singleton below
 * is bound to the suite's fully-migrated one.
 */
export const schemaMismatchDigest = {
  name: "schema-mismatch-digest",
  query: {
    async $allOperations({
      args,
      query,
    }: {
      args: unknown;
      query: (args: never) => Promise<unknown>;
    }) {
      try {
        return await query(args as never);
      } catch (error) {
        if (isSchemaMismatch(error)) {
          logger.error("db.schema_mismatch", {
            missing: missingSchemaObject(error),
          });

          Object.assign(error as object, { digest: SCHEMA_MISMATCH_DIGEST });
        }

        throw error;
      }
    },
  },
} as const;

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
