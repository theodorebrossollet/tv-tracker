"use client";

import { useState, useTransition } from "react";

import { loginWithPassword } from "@/app/account-actions";
import { SecretInput } from "@/components/secret-input";
import { FIELD_CLASS, FIELD_LABEL_CLASS, SUBMIT_CLASS } from "@/lib/field-styles";

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
    <form onSubmit={submit} className="mt-7 space-y-4">
      <div>
        <label htmlFor="nickname" className={FIELD_LABEL_CLASS}>
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
          className={FIELD_CLASS}
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
        className={SUBMIT_CLASS}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
