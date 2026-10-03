"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { resetDismissedSuggestions } from "@/app/discover-actions";

const ROW = "flex w-full items-center gap-3 px-3.5 min-h-[52px] text-[15px]";
const BUTTON =
  "flex min-h-[48px] w-full items-center justify-center rounded-[12px] border text-[15px] transition-colors disabled:opacity-50";

/**
 * The Discover reset, as one settings row.
 *
 * `count` is null when it couldn't be read (the migration isn't applied yet):
 * the row says so and offers nothing, rather than a button that would fail.
 */
export function HiddenSuggestions({ count }: { count: number | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, startReset] = useTransition();

  function confirm() {
    setError(null);
    startReset(async () => {
      const result = await resetDismissedSuggestions();

      if (result.ok) {
        setDone(true);
        setConfirming(false);
        router.refresh();
      } else {
        setError(result.error ?? "Couldn't show them again. Try again.");
      }
    });
  }

  const value = count === null ? "Unavailable" : count === 0 ? "None" : count;
  const canReset = count !== null && count > 0;

  return (
    <div>
      <div className={`${ROW} justify-between`}>
        Hidden suggestions
        <span className="text-muted">{value}</span>
      </div>

      {canReset || done || error ? (
        <div className="flex flex-col gap-2 px-3.5 pb-3.5">
          {done ? (
            <p className="text-[12.5px] text-accent">Done</p>
          ) : confirming ? (
            <>
              <p className="text-[12.5px] leading-relaxed text-muted">
                Everything you swiped away becomes a suggestion again.
              </p>
              <button
                type="button"
                onClick={confirm}
                disabled={working}
                className={`${BUTTON} border-border bg-background`}
              >
                {working ? "Working…" : "Show them again"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={working}
                className={`${BUTTON} border-border hover:bg-surface`}
              >
                Cancel
              </button>
            </>
          ) : canReset ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className={`${BUTTON} border-border hover:bg-background`}
            >
              Show them again
            </button>
          ) : null}

          {error ? (
            <p role="alert" className="text-[12.5px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
