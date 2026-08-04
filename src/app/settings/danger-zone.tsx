"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { clearAllData } from "@/app/actions";

const BUTTON =
  "flex min-h-[52px] w-full items-center justify-center rounded-[14px] border text-[15px] transition-colors disabled:opacity-50";

/**
 * Its own block, after every other group, outlined rather than filled.
 *
 * The handoff labels this row "Delete account". It isn't one: `clearAllData`
 * wipes tracked shows, watch history and preferences and leaves the account
 * itself — you stay signed in and can start again. Calling it deletion would
 * promise something it doesn't do, and the person most likely to read it
 * literally is the one who wants to be forgotten.
 */
export function DangerZone() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [clearing, startClear] = useTransition();

  function confirmClear() {
    startClear(async () => {
      const result = await clearAllData();

      if (result.ok) {
        setCleared(true);
        setConfirming(false);
        router.refresh();
      }
    });
  }

  return (
    <section className="mt-[22px]">
      {cleared ? (
        <p className="text-[12.5px] text-accent">All tracking data cleared.</p>
      ) : confirming ? (
        <div className="flex flex-col gap-2">
          <p className="mx-0.5 text-[12.5px] leading-relaxed text-muted">
            Removes every tracked show, watch history entry and preference. Your
            account stays, and the cached show details from TMDB are kept so
            re-adding a show is fast.
          </p>

          <button
            type="button"
            onClick={confirmClear}
            disabled={clearing}
            className={`${BUTTON} border-danger/40 bg-danger/10 text-danger`}
          >
            {clearing ? "Clearing…" : "Yes, clear everything"}
          </button>

          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={clearing}
            className={`${BUTTON} border-border hover:bg-surface`}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${BUTTON} border-danger/30 bg-surface text-danger hover:bg-danger/5`}
        >
          Clear all data
        </button>
      )}
    </section>
  );
}
