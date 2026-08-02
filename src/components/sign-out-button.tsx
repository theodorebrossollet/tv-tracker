"use client";

import { useState, useTransition } from "react";

import { logout, signOutEverywhere } from "@/app/actions";

/**
 * Sign out of this device, or of all of them.
 *
 * Two buttons rather than one with a checkbox: they answer different
 * questions, and the everywhere case is the one people reach for while
 * worried. The ordinary case stays the plain, obvious button — a stored
 * session table is what makes cutting off one device without disturbing the
 * others possible at all.
 */
export function SignOutButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);

    start(async () => {
      // Only returns on failure; success redirects server-side.
      const result = await action();

      if (!result?.ok) setError(result?.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run(logout)}
          disabled={pending}
          className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-surface disabled:opacity-50"
        >
          {pending ? "Signing out…" : "Sign out"}
        </button>

        <button
          type="button"
          onClick={() => run(signOutEverywhere)}
          disabled={pending}
          className="rounded-full border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50"
        >
          Sign out everywhere
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
