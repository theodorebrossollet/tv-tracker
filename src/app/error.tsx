"use client";

import { useEffect } from "react";

/**
 * Catches anything a page throws — most realistically TMDB being unreachable
 * while opening a show that isn't cached locally yet, which otherwise renders
 * a bare 500.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what ties this back to the server-side log entry; the
    // message itself is scrubbed in production builds.
    console.error("Page error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium">Something went wrong</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        This is usually TMDB being unreachable. Your tracked shows and watch
        history are stored locally and are unaffected.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
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
