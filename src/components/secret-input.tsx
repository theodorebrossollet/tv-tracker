"use client";

import { useState } from "react";

interface SecretInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  autoComplete: string;
  autoFocus?: boolean;
  /** Renders in a monospace face — worth it for a pasted 32-character code. */
  mono?: boolean;
}

/**
 * A masked field with a reveal toggle.
 *
 * Masking alone is wrong for the values this app asks for: an account code is
 * 32 characters that people paste, and a row of dots gives you no way to tell a
 * truncated paste from a good one. Masked by default, revealable on purpose.
 */
export function SecretInput({
  id,
  value,
  onChange,
  label,
  placeholder,
  autoComplete,
  autoFocus,
  mono,
}: SecretInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-neutral-500">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          name={id}
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className={`w-full rounded-md border border-neutral-300 bg-transparent py-2 pl-3 pr-16 text-base outline-none focus:border-neutral-500 dark:border-neutral-700 ${
            mono ? "font-mono" : ""
          }`}
        />

        <button
          type="button"
          onClick={() => setRevealed((on) => !on)}
          // Not a submit button, and not in the tab order ahead of the real
          // one — it's an aid, not a step.
          tabIndex={-1}
          aria-pressed={revealed}
          className="absolute inset-y-0 right-0 px-3 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        >
          {revealed ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
