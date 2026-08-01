"use client";

import { useState, useTransition } from "react";

import { setNickname } from "@/app/actions";
import { NICKNAME_RULES, validateNickname } from "@/lib/nickname";

export function NicknameForm() {
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The same function the action runs, so the inline message and the server's
  // rejection can never disagree about what's allowed.
  const checked = validateNickname(value);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!checked.ok) {
      setError(checked.error);
      return;
    }

    // Nicknames are permanent and there is no in-app way to change one, so the
    // choice gets an explicit confirmation rather than a single click that
    // can't be taken back. See docs/scope-v2.md, "Assumptions & Open Risks".
    if (!confirming) {
      setConfirming(true);
      return;
    }

    start(async () => {
      // Only returns on failure; success redirects server-side. See the note
      // in login-form.tsx for why the navigation isn't done here.
      const result = await setNickname(value);

      if (!result?.ok) {
        setError(result?.error ?? "Something went wrong.");
        setConfirming(false);
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="nickname" className="sr-only">
          Nickname
        </label>
        <input
          id="nickname"
          name="nickname"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            // Editing after reaching the confirm step returns you to it, so the
            // text on the button always describes the value in the field.
            setConfirming(false);
            setError(null);
          }}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          maxLength={40}
          placeholder="nickname"
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        <p className="mt-2 text-xs text-neutral-500">{NICKNAME_RULES}</p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {confirming && checked.ok && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950"
        >
          You&rsquo;ll be{" "}
          <strong className="font-semibold">{checked.nickname}</strong>. This
          can&rsquo;t be changed later — there&rsquo;s no rename in the app.
        </div>
      )}

      <button
        type="submit"
        disabled={pending || !value.trim()}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending
          ? "Saving…"
          : confirming
            ? "Yes, use this nickname"
            : "Continue"}
      </button>
    </form>
  );
}
