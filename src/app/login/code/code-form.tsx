"use client";

import { useState, useTransition } from "react";

import { loginWithCode } from "@/app/actions";
import { SecretInput } from "@/components/secret-input";

export function CodeForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

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
