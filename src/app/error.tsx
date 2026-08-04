"use client";

import { useEffect } from "react";

import { SCHEMA_MISMATCH_DIGEST } from "@/lib/schema-error";

/**
 * Catches anything a page throws — most realistically TMDB being unreachable
 * while opening a show that isn't cached locally yet, which otherwise renders
 * a bare 500.
 *
 * The one case worth telling apart is a database that hasn't had its migration
 * applied yet. Migrations here are run by hand and never on deploy, so code
 * shipping ahead of its schema is a recurring state, and blaming TMDB for it
 * sends whoever is debugging in the wrong direction. The message is scrubbed
 * by the time it reaches this component, so the signal is the digest stamped
 * on the error in `lib/prisma.ts`.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const staleSchema = error.digest === SCHEMA_MISMATCH_DIGEST;

  useEffect(() => {
    // The digest is what ties this back to the server-side log entry; the
    // message itself is scrubbed in production builds.
    console.error("Page error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium">
        {staleSchema ? "The app is being updated" : "Something went wrong"}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        {staleSchema
          ? "This should sort itself out in a minute. Your tracked shows and watch history are safe."
          : "This is usually TMDB being unreachable. Your tracked shows and watch history are stored locally and are unaffected."}
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90"
      >
        Try again
      </button>

      {error.digest ? (
        <p className="mt-3 font-mono text-[11px] text-muted">
          Reference: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
