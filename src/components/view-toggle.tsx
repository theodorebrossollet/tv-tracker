"use client";

import { useOptimistic, useState, useTransition } from "react";

import { setViewMode } from "@/app/view-actions";
import type { ViewMode } from "@/lib/view-mode";

const OPTIONS: Array<{ mode: ViewMode; label: string; icon: React.ReactNode }> =
  [
    {
      mode: "rows",
      label: "Rows",
      icon: <path d="M4 6h16M4 12h16M4 18h16" />,
    },
    {
      mode: "posters",
      label: "Posters",
      icon: (
        <>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </>
      ),
    },
  ];

/**
 * Rows or posters, for every list of titles in the app. Two pressed-state
 * buttons rather than links: the choice lives in a cookie, not the URL. The
 * pressed state follows the server value through `useOptimistic`; a failure
 * message is plain state, so it is still there once the action settles.
 */
export function ViewToggle({ view }: { view: ViewMode }) {
  const [shown, setShown] = useOptimistic(view);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function choose(mode: ViewMode) {
    if (mode === shown) return;
    setError(null);

    startTransition(async () => {
      setShown(mode);
      const result = await setViewMode(mode);
      if (!result.ok) setError(result.error ?? "Couldn't change the view.");
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div
        role="group"
        aria-label="Layout"
        className="flex gap-0.5 rounded-[11px] border border-border bg-surface-sunken p-0.5"
      >
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-label={`${option.label} view`}
            aria-pressed={shown === option.mode}
            onClick={() => choose(option.mode)}
            className={`flex h-10 min-w-9 items-center justify-center rounded-[9px] transition-colors ${
              shown === option.mode
                ? "bg-background text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-[17px]"
              aria-hidden="true"
            >
              {option.icon}
            </svg>
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
