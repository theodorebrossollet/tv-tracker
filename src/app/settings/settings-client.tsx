"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";

import {
  clearAllData,
  updateCountry,
  updateNotificationPrefs,
} from "@/app/actions";
import { Select } from "@/components/select";
import type { WatchRegion } from "@/lib/tmdb";

interface SettingsClientProps {
  notifyEnabled: boolean;
  country: string | null;
  regions: WatchRegion[];
}

export function SettingsClient({
  notifyEnabled,
  country,
  regions,
}: SettingsClientProps) {
  const router = useRouter();
  // Derived from the props via useOptimistic, not copied into useState. Both
  // values change server-side — clearing all data resets them, and the row is
  // recreated with defaults — and a useState copy initialises once and then
  // ignores every later prop, so the display could never be corrected. Same
  // reasoning as AddButton.
  const [enabled, setEnabled] = useOptimistic(notifyEnabled);
  const [selectedCountry, setSelectedCountry] = useOptimistic(country ?? "");
  const [countrySaved, setCountrySaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [savingPrefs, startPrefs] = useTransition();
  const [savingCountry, startCountry] = useTransition();
  const [clearing, startClear] = useTransition();

  // The optimistic setters must be called inside the transition — that is what
  // scopes them. No manual rollback anywhere below: when a transition ends the
  // optimistic value is dropped and the prop wins, so a failed save reverts
  // itself and a successful one has already been revalidated.
  function toggleNotifications() {
    const next = !enabled;

    startPrefs(async () => {
      setEnabled(next);
      await updateNotificationPrefs(next);
    });
  }

  function changeCountry(next: string) {
    setCountrySaved(false);

    startCountry(async () => {
      setSelectedCountry(next);
      const result = await updateCountry(next);

      if (result.ok) setCountrySaved(true);
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
        <h2 className="font-medium">Country</h2>
        <p className="mt-1 text-sm text-muted">
          Used as the default when showing where a series is available to
          stream. You can still check other countries from any show page.
        </p>

        {regions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Couldn&rsquo;t load the country list from TMDB. Reload to try again.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Select
              scale="md"
              value={selectedCountry}
              onChange={(event) => changeCountry(event.target.value)}
              disabled={savingCountry}
              aria-label="Country"
            >
              <option value="">Not set</option>
              {regions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </Select>

            {savingCountry ? (
              <span className="text-xs text-muted">Saving…</span>
            ) : countrySaved ? (
              <span className="text-xs text-accent">Saved</span>
            ) : null}
          </div>
        )}
      </section>

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
