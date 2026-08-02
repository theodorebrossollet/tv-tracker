"use client";

import { useOptimistic, useState, useTransition } from "react";

import {
  updateCountry,
  updateNotificationPrefs,
  updateProviders,
} from "@/app/actions";
import { ProviderSelect } from "@/components/provider-select";
import { Select } from "@/components/select";
import { ShowMoreLink } from "@/components/show-more-link";
import { MAX_PROVIDERS } from "@/lib/alternate-countries";
import type { WatchProvider, WatchRegion } from "@/lib/tmdb";

interface SettingsClientProps {
  notifyEnabled: boolean;
  country: string | null;
  regions: WatchRegion[];
  /** Only the slice of the catalogue this page asked for — see settings/page. */
  providerOptions: WatchProvider[];
  providerIds: number[];
  /** Everything `ShowMoreLink` needs to reveal the next slice. */
  providerMore: {
    param: string;
    current: Record<string, string | string[] | undefined>;
    step: number;
    shown: number;
    remaining: number;
  };
}

export function SettingsClient({
  notifyEnabled,
  country,
  regions,
  providerOptions,
  providerIds,
  providerMore,
}: SettingsClientProps) {
  // Derived from the props via useOptimistic, not copied into useState. Both
  // values change server-side — clearing all data resets them, and the row is
  // recreated with defaults — and a useState copy initialises once and then
  // ignores every later prop, so the display could never be corrected. Same
  // reasoning as AddButton.
  const [enabled, setEnabled] = useOptimistic(notifyEnabled);
  const [selectedCountry, setSelectedCountry] = useOptimistic(country ?? "");
  const [selectedProviders, setSelectedProviders] = useOptimistic(providerIds);
  const [countrySaved, setCountrySaved] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [savingPrefs, startPrefs] = useTransition();
  const [savingCountry, startCountry] = useTransition();
  const [savingProviders, startProviders] = useTransition();

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

  function toggleProvider(id: number) {
    const removing = selectedProviders.includes(id);
    const next = removing
      ? selectedProviders.filter((existing) => existing !== id)
      : [...selectedProviders, id];

    // Checked here as well as in the action, so the cap reads as a rule rather
    // than as a click that silently does nothing: the optimistic value would
    // otherwise flip on, then revert when the rejected save landed.
    if (!removing && next.length > MAX_PROVIDERS) {
      setProviderError(`You can pick up to ${MAX_PROVIDERS} services.`);
      return;
    }

    setProviderError(null);

    startProviders(async () => {
      setSelectedProviders(next);
      const result = await updateProviders(next);

      // The optimistic value is already dropped by the time this runs, so the
      // chip has reverted itself — all that's missing is saying why.
      if (!result.ok) {
        setProviderError(result.error ?? "Couldn't save that. Try again.");
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
        <h2 className="font-medium">Your streaming services</h2>
        <p className="mt-1 text-sm text-muted">
          Also used to flag when a show you don&rsquo;t have at home is
          already on one of these services elsewhere — useful with a VPN,
          though that&rsquo;s against most streaming services&rsquo; terms.
        </p>

        {providerOptions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Couldn&rsquo;t load the service list from TMDB. Reload to try
            again.
          </p>
        ) : (
          <div className="mt-3">
            <ProviderSelect
              options={providerOptions}
              selected={selectedProviders}
              onToggle={toggleProvider}
              disabled={savingProviders}
            />

            {providerError ? (
              <p role="alert" className="mt-2 text-sm text-red-500">
                {providerError}
              </p>
            ) : null}

            {providerMore.remaining > 0 ? (
              <ShowMoreLink
                param={providerMore.param}
                current={providerMore.current}
                step={providerMore.step}
                shown={providerMore.shown}
                remaining={providerMore.remaining}
                label="Show"
              />
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
    </div>
  );
}
