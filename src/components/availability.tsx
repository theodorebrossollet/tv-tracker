"use client";

import Image from "next/image";
import { useState } from "react";

import { posterUrl } from "@/lib/images";
import type { CountryAvailability, WatchProvider } from "@/lib/tmdb";

interface AvailabilityProps {
  /** Every country TMDB has data for, so switching costs no extra request. */
  countries: CountryAvailability[];
  /** Display names keyed by country code, for the dropdown labels. */
  regionNames: Record<string, string>;
  /** The country from settings, when it has data for this show. */
  defaultCode: string | null;
  /** True when settings has a country but this show isn't available there. */
  settingsCountryUnavailable: string | null;
}

const GROUPS = [
  { key: "flatrate", label: "Stream" },
  { key: "free", label: "Free" },
  { key: "rent", label: "Rent" },
  { key: "buy", label: "Buy" },
] as const;

export function Availability({
  countries,
  regionNames,
  defaultCode,
  settingsCountryUnavailable,
}: AvailabilityProps) {
  const [code, setCode] = useState(defaultCode ?? countries[0]?.code ?? "");

  const selected = countries.find((country) => country.code === code);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Where to watch</h2>

        <label className="flex items-center gap-2 text-xs text-muted">
          Country
          <select
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground outline-none focus:border-accent"
          >
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {regionNames[country.code] ?? country.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      {settingsCountryUnavailable ? (
        <p className="mt-2 text-xs text-muted">
          Not available in{" "}
          {regionNames[settingsCountryUnavailable] ??
            settingsCountryUnavailable}{" "}
          (your settings country) — showing {regionNames[code] ?? code} instead.
        </p>
      ) : null}

      {selected ? (
        <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
          {GROUPS.map(({ key, label }) => {
            const providers = selected[key];
            if (providers.length === 0) return null;

            return (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-muted">{label}</span>
                {providers.map((provider) => (
                  <ProviderBadge key={provider.id} provider={provider} />
                ))}
              </div>
            );
          })}

          <p className="border-t border-border pt-2 text-[11px] text-muted">
            Availability data from{" "}
            <a
              href="https://www.justwatch.com/"
              target="_blank"
              rel="noreferrer noopener"
              className="underline hover:text-foreground"
            >
              JustWatch
            </a>{" "}
            via TMDB.
            {selected.link ? (
              <>
                {" "}
                <a
                  href={selected.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline hover:text-foreground"
                >
                  Open on TMDB
                </a>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function ProviderBadge({ provider }: { provider: WatchProvider }) {
  const logo = posterUrl(provider.logoPath, "w185");

  return (
    <span
      className="flex items-center gap-1.5 rounded-full border border-border py-1 pl-1 pr-2.5"
      title={provider.name}
    >
      {logo ? (
        <Image
          src={logo}
          alt=""
          width={20}
          height={20}
          className="size-5 rounded-full object-cover"
        />
      ) : null}
      <span className="text-xs">{provider.name}</span>
    </span>
  );
}
