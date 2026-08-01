"use client";

import { useState, useTransition } from "react";

import { login } from "@/app/actions";

export function LoginForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    start(async () => {
      // Only returns on failure — a successful sign-in redirects server-side,
      // so there is no navigation to do here. Driving it from the client meant
      // `router.replace` plus `router.refresh`, which deadlock together and
      // leave this button reading "Signing in…" indefinitely.
      const result = await login(code);

      if (!result?.ok) {
        setError(result?.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="code" className="sr-only">
          Account code
        </label>
        <input
          id="code"
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          // A 32-character hex string that is almost always pasted. Autocorrect
          // and capitalisation would only ever corrupt it.
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder="your account code"
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
      </div>

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
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-xs text-neutral-500">
        Codes are handed out directly — there is no sign-up, and a lost code
        can&rsquo;t be recovered.
      </p>
    </form>
  );
}
