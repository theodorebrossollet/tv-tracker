// Recognising "the database is behind the code".
//
// Migrations are applied by hand (`npm run db:deploy`) and never run on
// deploy, so shipping code before its migration is a real and recurring state
// — it has happened twice. What the user saw both times was "Something went
// wrong. Please try again.", which is indistinguishable from a genuine bug and
// sent debugging in the wrong direction.
//
// The signal is the *driver's* message, not Prisma's error code. Measured
// against a database deliberately left one migration behind:
//
//   missing column, via the query API  → P2039
//   missing table, via a raw query     → P2010
//
// Neither is the documented P2021/P2022, because the libSQL driver adapter
// reports these as generic adapter failures and nests the real cause under
// `meta.driverAdapterError`. Matching on the code alone would have missed both.
//
// SQLite-specific wording, which is fine: this project has no other database,
// and the alternative is a check that silently matches nothing.

const MISSING_SCHEMA = /no such (?:column|table):\s*([\w.]+)/i;

/** Everything the error carries that might hold the driver's own message. */
function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";

  const parts: string[] = [];

  if ("message" in error && typeof error.message === "string") {
    parts.push(error.message);
  }

  // The driver's cause lives in `meta`, several levels down and shaped
  // differently per adapter version. Serialising is more durable than reaching
  // through a specific path that a Prisma upgrade could rename.
  if ("meta" in error && error.meta) {
    try {
      parts.push(JSON.stringify(error.meta));
    } catch {
      // Circular or otherwise unserialisable — the message alone will do.
    }
  }

  return parts.join(" ");
}

/** True when a query failed because the schema lacks something the code wants. */
export function isSchemaMismatch(error: unknown): boolean {
  return MISSING_SCHEMA.test(errorText(error));
}

/**
 * The `digest` stamped onto a schema-mismatch error so the error boundary can
 * recognise it.
 *
 * Next scrubs an error's message before it reaches the client in production
 * builds — that is the whole point of the digest — so `error.tsx` cannot run
 * `isSchemaMismatch` itself and has nothing else to go on. A digest set on the
 * error server-side *is* forwarded verbatim rather than replaced by the usual
 * generated hash: measured against a production build of this app on Next
 * 16.2.12, not assumed, because a generated hash here would silently fall
 * through to the generic message and nobody would notice.
 */
export const SCHEMA_MISMATCH_DIGEST = "SCHEMA_MISMATCH";

/**
 * The missing column or table, for the log line.
 *
 * Deliberately just this fragment rather than the whole error: Prisma's message
 * embeds the failing invocation and its arguments, and this project's rule is
 * that nothing which might carry a secret gets logged. A column name cannot.
 */
export function missingSchemaObject(error: unknown): string {
  return MISSING_SCHEMA.exec(errorText(error))?.[1] ?? "unknown";
}
