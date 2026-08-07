"use client";

import { useState, useTransition } from "react";

import { loginWithCode } from "@/app/account-actions";
import { SecretInput } from "@/components/secret-input";
import { CODE_LENGTH, isAccountCode, normalizeCode } from "@/lib/account-code";

export function CodeForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // The same check the action runs, so the inline message and the server's
    // rejection can never disagree — the pattern `OnboardingForm` already uses
    // for nicknames and passwords. It also means a mistyped code costs nothing:
    // this is the one form an unauthenticated visitor can submit repeatedly,
    // and every submission that reaches the server costs an invocation.
    if (!isAccountCode(normalizeCode(code))) {
      setError(`Codes are ${CODE_LENGTH} letters and numbers. Check for a missing character.`);
      return;
    }

    start(async () => {
      // Only returns on failure — success redirects server-side. Driving the
      // navigation from here meant router.replace plus router.refresh, and
      // those two in one transition deadlock.
      const result = await loginWithCode(code);

      if (!result?.ok) setError(result?.error ?? "Something went wrong.");
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <SecretInput
        id="code"
        label="Account code"
        value={code}
        onChange={setCode}
        placeholder="your account code"
        autoComplete="one-time-code"
        autoFocus
        mono
      />

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !code.trim()}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending ? "Signing in…" : "Continue"}
      </button>
    </form>
  );
}
