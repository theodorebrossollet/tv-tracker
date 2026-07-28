"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { clearAllData, updateNotificationPrefs } from "@/app/actions";

export function SettingsClient({ notifyEnabled }: { notifyEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(notifyEnabled);
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [savingPrefs, startPrefs] = useTransition();
  const [clearing, startClear] = useTransition();

  function toggleNotifications() {
    const next = !enabled;
    setEnabled(next);

    startPrefs(async () => {
      const result = await updateNotificationPrefs(next);
      if (!result.ok) setEnabled(!next);
    });
  }

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
    <div className="mt-6 space-y-8">
      <section>
        <h2 className="font-medium">Notifications</h2>

        <label className="mt-3 flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={toggleNotifications}
            disabled={savingPrefs}
            className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
          />
          <span className="text-sm">
            Notify me about new episodes
            <span className="mt-0.5 block text-xs text-muted">
              Saves the preference now. Actually sending notifications is a
              Phase 2 feature — see docs/scope.md.
            </span>
          </span>
        </label>
      </section>

      <section>
        <h2 className="font-medium">Danger zone</h2>
        <p className="mt-1 text-sm text-muted">
          Removes every tracked show, watch history entry, and preference. The
          locally cached show and episode details from TMDB are kept so
          re-adding a show is fast.
        </p>

        {cleared ? (
          <p className="mt-3 text-sm text-accent">All tracking data cleared.</p>
        ) : confirming ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirmClear}
              disabled={clearing}
              className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {clearing ? "Clearing…" : "Yes, delete everything"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={clearing}
              className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-3 rounded-full border border-red-500/50 px-4 py-2 text-sm text-red-500 transition-colors hover:bg-red-500/10"
          >
            Clear all data
          </button>
        )}
      </section>
    </div>
  );
}
