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
        <label htmlFor="nickname" className="mb-1 block text-sm text-muted">
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
          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-muted"
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
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !nickname.trim() || !password}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
