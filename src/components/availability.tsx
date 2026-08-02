import Image from "next/image";

import { CountrySelect } from "@/components/country-select";
import { posterUrl } from "@/lib/images";
import type { CountryAvailability, WatchProvider } from "@/lib/tmdb";

interface AvailabilityProps {
  /** Just the country being shown — not every country TMDB has data for. */
  selected: CountryAvailability;
  /** Codes and display names, for the dropdown only. */
  options: Array<{ code: string; name: string }>;
  /** Display name of the country being shown. */
  selectedName: string;
  /** Set when settings names a country this show isn't available in. */
  settingsCountryUnavailable: { code: string; name: string } | null;
}

const GROUPS = [
  { key: "flatrate", label: "Stream" },
  { key: "free", label: "Free" },
  { key: "rent", label: "Rent" },
  { key: "buy", label: "Buy" },
] as const;

/**
 * Where a show can be streamed, for one country at a time.
 *
 * A server component. TMDB returns every country in a single response, so
 * fetching them all costs nothing extra — but *sending* them all did: a popular
 * show carries provider lists, logo paths and names for dozens of countries,
 * all serialised into the page for a dropdown most people never open. The
 * chosen country now comes from the URL, and only that country's data is
 * rendered. `CountrySelect` is the one client piece, and it carries codes and
 * names only.
 */
export function Availability({
  selected,
  options,
  selectedName,
  settingsCountryUnavailable,
}: AvailabilityProps) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Where to watch</h2>

        <label className="flex items-center gap-2 text-xs text-muted">
          Country
          <CountrySelect value={selected.code} options={options} />
        </label>
      </div>

      {settingsCountryUnavailable ? (
        <p className="mt-2 text-xs text-muted">
          Not available in {settingsCountryUnavailable.name} (your settings
          country) — showing {selectedName} instead.
        </p>
      ) : null}

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
    </section>
  );
}

export function ProviderBadge({ provider }: { provider: WatchProvider }) {
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
