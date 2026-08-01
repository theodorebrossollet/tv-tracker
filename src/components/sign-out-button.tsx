"use client";

import { useState, useTransition } from "react";

import { logout } from "@/app/actions";

/**
 * Revokes this session only, not every session on the account.
 *
 * That is the behaviour the user story asks for — "log out from a device that
 * isn't mine" — and it is what makes a stored session table worth having: one
 * device can be cut off without disturbing the others.
 */
export function SignOutButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function signOut() {
    setError(null);

    start(async () => {
      // Only returns on failure; success redirects server-side.
      const result = await logout();

      if (!result?.ok) setError(result?.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-surface disabled:opacity-50"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
