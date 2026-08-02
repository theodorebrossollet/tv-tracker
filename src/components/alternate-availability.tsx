import { ProviderBadge } from "@/components/availability";
import { ShowMoreLink } from "@/components/show-more-link";
import type { WatchProvider } from "@/lib/tmdb";

interface AlternateAvailabilityProps {
  /** Countries to render, already sliced to the current page size. */
  shown: Array<{ code: string; name: string; providers: WatchProvider[] }>;
  /** Rows still hidden, for the "see more" control. */
  remaining: number;
  param: string;
  current: Record<string, string | string[] | undefined>;
  step: number;
}

/**
 * "You already pay for this elsewhere" — countries where the show is on one
 * of the user's own streaming services, shown only when their home country
 * isn't among them. Reuses `ShowMoreLink` exactly the way `ShowList` does:
 * this stays a server component, and the URL (not client state) tracks how
 * much of the list is revealed.
 */
export function AlternateAvailability({
  shown,
  remaining,
  param,
  current,
  step,
}: AlternateAvailabilityProps) {
  return (
    <section className="mt-8">
      <h2 className="font-semibold">Also on your services</h2>
      <p className="mt-1 text-xs text-muted">
        Not available through your services where you are, but already is in
        these countries. Watching from there usually means a VPN set to that
        country, which is against most streaming services&rsquo; terms —
        worth knowing before you rely on it.
      </p>

      <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
        {shown.map((country) => (
          <div key={country.code} className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-muted">
              {country.name}
            </span>
            {country.providers.map((provider) => (
              <ProviderBadge key={provider.id} provider={provider} />
            ))}
          </div>
        ))}
      </div>

      {remaining > 0 ? (
        <ShowMoreLink
          param={param}
          current={current}
          step={step}
          shown={shown.length}
          remaining={remaining}
          label="Show"
        />
      ) : null}
    </section>
  );
}
