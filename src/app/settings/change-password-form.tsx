"use client";

import { useState, useTransition } from "react";

import { changePassword } from "@/app/account-actions";
import { SecretInput } from "@/components/secret-input";
import { PASSWORD_RULES, validatePassword } from "@/lib/password-rules";

/**
 * Requires the account code, not the current password — see the comment on
 * `changePassword` in app/actions.ts for why. Collapsed behind a toggle so
 * settings doesn't show three password-shaped fields by default.
 */
export function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const checkedPassword = validatePassword(password);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!checkedPassword.ok) return setError(checkedPassword.error);
    if (password !== confirm) return setError("The passwords don't match.");

    start(async () => {
      const result = await changePassword(code, password);

      if (result.ok) {
        setDone(true);
        setOpen(false);
        setCode("");
        setPassword("");
        setConfirm("");
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
          className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-surface"
        >
          Change password
        </button>
        {done && <p className="mt-2 text-sm text-accent">Password changed.</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-4">
      <SecretInput
        id="reset-code"
        label="Account code"
        value={code}
        onChange={setCode}
        placeholder="your account code"
        autoComplete="one-time-code"
        mono
      />
      <p className="-mt-2 text-xs text-muted">
        Confirms it&rsquo;s really you — a signed-in session alone isn&rsquo;t
        enough to change the password. Same code you were given when invited.
      </p>

      <SecretInput
        id="new-password"
        label="New password"
        value={password}
        onChange={(next) => {
          setPassword(next);
          setError(null);
        }}
        autoComplete="new-password"
      />
      <p className="-mt-2 text-xs text-muted">{PASSWORD_RULES}</p>

      <SecretInput
        id="confirm-new-password"
        label="Confirm new password"
        value={confirm}
        onChange={(next) => {
          setConfirm(next);
          setError(null);
        }}
        autoComplete="new-password"
      />

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || !code.trim() || !password || !confirm}
          className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? "Saving…" : "Save new password"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-surface"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
