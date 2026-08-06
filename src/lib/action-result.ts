import "server-only";

import { describeError, logger } from "@/lib/logger";
import { isSchemaMismatch, missingSchemaObject } from "@/lib/schema-error";
import { TmdbError } from "@/lib/tmdb";

// What every server action returns, and how an unexpected failure becomes
// something a person can read.
//
// Split out of `app/actions.ts` when the account half moved to its own file, so
// the two share one definition rather than one importing the other — an action
// module importing another action module would make every export of the second
// reachable through the first, which is a confusing thing for a "use server"
// boundary to be doing.
//
// Deliberately NOT a `"use server"` file: those may only export async
// functions, and this exports a type and two synchronous helpers. Importing it
// into an action module is fine — only that module's own exports become
// endpoints.

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Prisma's "unique constraint failed". Two writers raced and the second one
 * lost — which, for a write whose whole point is "make this row exist", means
 * the work is done rather than failed.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Turns an unexpected failure into a message safe to show the user. */
export function toResult(error: unknown): ActionResult {
  if (error instanceof TmdbError) {
    return { ok: false, error: error.message };
  }

  // A deploy that landed before its migration. Split out from the generic
  // failure because the two need different things: the visitor needs to know
  // it is temporary and not their fault, and the operator needs to know which
  // migration is missing without reading a stack trace.
  if (isSchemaMismatch(error)) {
    logger.error("action.schema_mismatch", { missing: missingSchemaObject(error) });

    return {
      ok: false,
      error: "The app is being updated. Please try again in a minute.",
    };
  }

  logger.error("action.failed", describeError(error));
  return { ok: false, error: "Something went wrong. Please try again." };
}
