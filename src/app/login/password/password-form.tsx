"use client";

import { useState, useTransition } from "react";

import { loginWithPassword } from "@/app/account-actions";
import { SecretInput } from "@/components/secret-input";

export function PasswordForm() {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    start(async () => {
      const result = await loginWithPassword(nickname, password);

      if (!result?.ok) setError(result?.error ?? "Something went wrong.");
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="nickname" className="mb-1 block text-sm text-neutral-500">
          Nickname
        </label>
        <input
          id="nickname"
          name="nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
      </div>

      <SecretInput
        id="password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !nickname.trim() || !password}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
