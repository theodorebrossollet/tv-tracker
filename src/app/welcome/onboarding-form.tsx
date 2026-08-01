"use client";

import { useState, useTransition } from "react";

import { completeOnboarding } from "@/app/actions";
import { SecretInput } from "@/components/secret-input";
import { NICKNAME_RULES, validateNickname } from "@/lib/nickname";
import { PASSWORD_RULES, validatePassword } from "@/lib/password-rules";

interface OnboardingFormProps {
  /** Set when the account already has a nickname and only needs a password. */
  existingNickname: string | null;
}

export function OnboardingForm({ existingNickname }: OnboardingFormProps) {
  const [nickname, setNickname] = useState(existingNickname ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The same functions the action runs, so the inline message and the server's
  // rejection can never disagree about what's allowed.
  const checkedNickname = existingNickname
    ? ({ ok: true, nickname: existingNickname } as const)
    : validateNickname(nickname);
  const checkedPassword = validatePassword(password, { nickname });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!checkedNickname.ok) return setError(checkedNickname.error);
    if (!checkedPassword.ok) return setError(checkedPassword.error);
    if (password !== confirm) return setError("The passwords don't match.");

    // Nicknames are permanent and there is no in-app way to change one, so a
    // new one gets an explicit confirmation rather than a single click that
    // can't be taken back. An account that already has one skips this.
    if (!existingNickname && !confirming) {
      setConfirming(true);
      return;
    }

    start(async () => {
      // Only returns on failure; success redirects server-side.
      const result = await completeOnboarding(nickname, password);

      if (!result?.ok) {
        setError(result?.error ?? "Something went wrong.");
        setConfirming(false);
      }
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
          onChange={(event) => {
            setNickname(event.target.value);
            setConfirming(false);
            setError(null);
          }}
          disabled={existingNickname !== null}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={existingNickname === null}
          maxLength={40}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500 disabled:opacity-60 dark:border-neutral-700"
        />
        <p className="mt-2 text-xs text-neutral-500">
          {existingNickname ? "Already chosen — this can't be changed." : NICKNAME_RULES}
        </p>
      </div>

      <SecretInput
        id="password"
        label="Password"
        value={password}
        onChange={(next) => {
          setPassword(next);
          setError(null);
        }}
        autoComplete="new-password"
        autoFocus={existingNickname !== null}
      />
      <p className="-mt-2 text-xs text-neutral-500">{PASSWORD_RULES}</p>

      <SecretInput
        id="confirm"
        label="Confirm password"
        value={confirm}
        onChange={(next) => {
          setConfirm(next);
          setError(null);
        }}
        autoComplete="new-password"
      />

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {confirming && checkedNickname.ok && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950"
        >
          You&rsquo;ll be{" "}
          <strong className="font-semibold">{checkedNickname.nickname}</strong>.
          This can&rsquo;t be changed later — there&rsquo;s no rename in the app.
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !nickname.trim() || !password || !confirm}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending ? "Saving…" : confirming ? "Yes, use this nickname" : "Continue"}
      </button>
    </form>
  );
}
