"use client";

import Image from "next/image";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import {
  updateCountry,
  updateNotificationPrefs,
  updateProviders,
} from "@/app/actions";
import {
  Chevron,
  Group,
  ToggleRow,
} from "@/components/settings-rows";
import { ShowMoreLink } from "@/components/show-more-link";
import { MAX_PROVIDERS } from "@/lib/alternate-countries";
import { posterUrl } from "@/lib/images";
import type { WatchProvider, WatchRegion } from "@/lib/tmdb";

interface SettingsClientProps {
  notifyEnabled: boolean;
  country: string | null;
  regions: WatchRegion[];
  /** Only the slice of the catalogue this page asked for — see settings/page. */
  providerOptions: WatchProvider[];
  providerIds: number[];
  /** Whether the URL is asking to browse the whole catalogue. */
  browsingProviders: boolean;
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
  browsingProviders,
  providerMore,
}: SettingsClientProps) {
  // Derived from the props via useOptimistic, not copied into useState. All
  // three change server-side — clearing all data resets them, and the row is
  // recreated with defaults — and a useState copy initialises once and then
  // ignores every later prop, so the display could never be corrected. Same
  // reasoning as AddButton.
  const [enabled, setEnabled] = useOptimistic(notifyEnabled);
  const [selectedCountry, setSelectedCountry] = useOptimistic(country ?? "");
  const [selectedProviders, setSelectedProviders] = useOptimistic(providerIds);
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
    startCountry(async () => {
      setSelectedCountry(next);
      await updateCountry(next);
    });
  }

  function toggleProvider(id: number) {
    const removing = selectedProviders.includes(id);
    const next = removing
      ? selectedProviders.filter((existing) => existing !== id)
      : [...selectedProviders, id];

    // Checked here as well as in the action, so the cap reads as a rule rather
    // than as a tap that silently does nothing: the optimistic value would
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
      // toggle has reverted itself — all that's missing is saying why.
      if (!result.ok) {
        setProviderError(result.error ?? "Couldn't save that. Try again.");
      }
    });
  }

  const countryName =
    regions.find((region) => region.code === selectedCountry)?.name ??
    "Not set";

  return (
    <>
      <Group
        label="Your services"
        description={
          <>
            Used to tell you where a show is streaming — and where it
            isn&rsquo;t.{" "}
            {selectedProviders.length === 0
              ? "None selected."
              : `${selectedProviders.length} selected.`}
          </>
        }
      >
        {providerOptions.length === 0 && !browsingProviders ? null : (
          providerOptions.map((provider) => (
            <ToggleRow
              key={provider.id}
              label={provider.name}
              logo={<ProviderLogo provider={provider} />}
              checked={selectedProviders.includes(provider.id)}
              onChange={() => toggleProvider(provider.id)}
              disabled={savingProviders}
            />
          ))
        )}

        {/* TMDB lists several hundred services per region, so the catalogue is
            behind a disclosure rather than in the group: collapsed, this shows
            only what you actually subscribe to. The reveal is a URL, like every
            other list in the app, which is also why it survives the round trip
            a toggle causes. */}
        <Link
          href={browsingProviders ? "/settings" : "?providers=24"}
          scroll={false}
          className="flex min-h-[52px] w-full items-center justify-between gap-3 px-3.5 text-[15px] transition-colors hover:bg-surface-sunken"
        >
          {browsingProviders ? "Done choosing" : "Choose services"}
          <span className="text-muted">
            <Chevron />
          </span>
        </Link>
      </Group>

      {providerError ? (
        <p role="alert" className="mx-0.5 mt-2 text-[12.5px] text-danger">
          {providerError}
        </p>
      ) : null}

      {browsingProviders && providerMore.remaining > 0 ? (
        <ShowMoreLink
          param={providerMore.param}
          current={providerMore.current}
          step={providerMore.step}
          shown={providerMore.shown}
          remaining={providerMore.remaining}
          label="Show"
        />
      ) : null}

      <Group label="Region &amp; alerts">
        {/* A native select covering the row, rather than a drill-in to a
            picker screen. It looks like the drawn row, and on a phone it opens
            the platform's own wheel — which is better than anything a custom
            sheet would do here, and free for keyboards and screen readers. */}
        <label className="relative flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-3 px-3.5 text-[15px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent hover:bg-surface-sunken">
          Country
          <span className="flex items-center gap-[7px] text-muted">
            {savingCountry ? "Saving…" : countryName}
            <Chevron />
          </span>

          <select
            value={selectedCountry}
            onChange={(event) => changeCountry(event.target.value)}
            disabled={savingCountry || regions.length === 0}
            aria-label="Country"
            className="absolute inset-0 cursor-pointer text-base opacity-0"
          >
            <option value="">Not set</option>
            {regions.map((region) => (
              <option key={region.code} value={region.code}>
                {region.name}
              </option>
            ))}
          </select>
        </label>

        <ToggleRow
          label="Air-date alerts"
          // The handoff's subtitle promises a notification that nothing sends.
          // The preference is real and worth keeping; the delivery isn't built,
          // and a settings screen that implies otherwise is how someone misses
          // an episode waiting for a message.
          description="The morning an episode lands. Not sending yet."
          checked={enabled}
          onChange={toggleNotifications}
          disabled={savingPrefs}
        />
      </Group>
    </>
  );
}

function ProviderLogo({ provider }: { provider: WatchProvider }) {
  const logo = posterUrl(provider.logoPath, "w185");

  if (!logo) {
    return (
      <span className="size-7 shrink-0 rounded-lg border border-border bg-surface-sunken" />
    );
  }

  return (
    <Image
      src={logo}
      alt=""
      width={28}
      height={28}
      className="size-7 shrink-0 rounded-lg border border-border object-cover"
    />
  );
}
