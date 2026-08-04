"use client";

import { useState, useTransition } from "react";

import { logout, signOutEverywhere } from "@/app/actions";
import { ButtonRow } from "@/components/settings-rows";

/**
 * Sign out of this device, or of all of them.
 *
 * Two rows rather than one with a toggle: they answer different questions, and
 * the everywhere case is the one people reach for while worried. The ordinary
 * case stays the plain, obvious one — a stored session table is what makes
 * cutting off one device without disturbing the others possible at all.
 *
 * Renders bare rows, so it sits inside the Account group rather than bringing
 * a container of its own.
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
    <>
      <ButtonRow
        label={pending ? "Signing out…" : "Sign out"}
        onClick={() => run(logout)}
        disabled={pending}
      />

      <ButtonRow
        label="Sign out everywhere"
        description="Ends every session, including this one"
        onClick={() => run(signOutEverywhere)}
        disabled={pending}
      />

      {error ? (
        <p role="alert" className="px-3.5 py-2.5 text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}
