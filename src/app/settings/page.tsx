import { ChangePasswordForm } from "./change-password-form";
import { DangerZone } from "./danger-zone";
import { SettingsClient } from "./settings-client";
import { describeError, logger } from "@/lib/logger";
import { SignOutButton } from "@/components/sign-out-button";
import {
  DisclosureRow,
  Group,
  InfoRow,
} from "@/components/settings-rows";
import { requireOnboardedSession } from "@/lib/auth";
import { parseProviderIds } from "@/lib/alternate-countries";
import { limitFrom } from "@/components/show-more-link";
import { getSettings } from "@/lib/shows";
import { getWatchProviderList, getWatchRegions, TmdbError } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · TV Tracker" };

/** Search param the service catalogue reveals itself with. */
const PROVIDER_PARAM = "providers";
/** Services shown per page while browsing, in TMDB's popularity order. */
const PROVIDER_PAGE_SIZE = 24;

interface SettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SettingsPage({
  searchParams,
}: SettingsPageProps) {
  const { user } = await requireOnboardedSession();
  const params_ = await searchParams;
  const settings = await getSettings(user.id);

  // The country list comes from TMDB (cached for a day). If it can't be
  // fetched, the rest of the settings page should still work.
  let regions: Awaited<ReturnType<typeof getWatchRegions>> = [];
  let providerOptions: Awaited<ReturnType<typeof getWatchProviderList>> = [];

  try {
    regions = await getWatchRegions();
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    logger.warn("settings.regions_unavailable", describeError(error));
  }

  try {
    // Falls back to US when no country is set yet — still a usable list to
    // pick services from, just not tailored to a region yet.
    providerOptions = await getWatchProviderList(settings.country ?? "US");
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    logger.warn("settings.providers_unavailable", describeError(error));
  }

  // TMDB lists several hundred providers per region and every one sent here is
  // serialised into the client payload, so only a slice crosses over — the
  // same reasoning that stopped `Availability` shipping every country's
  // provider list, and the same URL-driven reveal the show lists use.
  //
  // Collapsed, that slice is *just the ones you subscribe to*: the group is
  // meant to answer "what am I paying for", and 24 rows of catalogue between
  // it and the next group answers a question nobody asked.
  const providerIds = parseProviderIds(settings.providerIds);
  const chosen = new Set(providerIds);
  const browsing = params_[PROVIDER_PARAM] !== undefined;
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);

  let shownProviders: typeof providerOptions;
  let remaining = 0;

  if (browsing) {
    const limit = limitFrom(params_, PROVIDER_PARAM, PROVIDER_PAGE_SIZE);
    const head = providerOptions.slice(0, limit);
    // A service picked from a later page has to keep rendering once the list
    // collapses again, or reloading settings would show it off while the
    // stored row still counts it.
    const pinned = providerOptions
      .slice(limit)
      .filter((provider) => chosen.has(provider.id));

    shownProviders = [...head, ...pinned].sort(byName);
    remaining = providerOptions.length - head.length - pinned.length;
  } else {
    shownProviders = providerOptions
      .filter((provider) => chosen.has(provider.id))
      .sort(byName);
  }

  return (
    <div>
      <h1 className="text-[25px] font-semibold tracking-[-0.025em]">Settings</h1>

      <SettingsClient
        notifyEnabled={settings.notifyEnabled}
        country={settings.country}
        regions={regions}
        providerOptions={shownProviders}
        providerIds={providerIds}
        browsingProviders={browsing}
        providerMore={{
          param: PROVIDER_PARAM,
          current: params_,
          step: PROVIDER_PAGE_SIZE,
          shown: shownProviders.length,
          remaining,
        }}
      />

      <Group
        label="Account"
        footnote="Signing out ends this session only — other devices stay signed in. Sign out everywhere ends all of them, including this one, for when you've left yourself signed in somewhere you'd rather not have."
      >
        <InfoRow label="Signed in as" value={user.nickname} />

        <DisclosureRow label="Change password">
          <p className="text-[12.5px] leading-relaxed text-muted">
            Changing it requires your account code — the one you were given when
            invited — as proof it&rsquo;s really you. Keep that code regardless:
            it&rsquo;s still the only way back in if you forget whatever password
            you set here.
          </p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            Changing your password signs you out everywhere else — your other
            devices will need the new one. That&rsquo;s the point: it&rsquo;s
            what makes changing it useful if you think someone else is in your
            account.
          </p>
          <ChangePasswordForm />
        </DisclosureRow>

        <DisclosureRow label="Add to home screen">
          <p className="text-[12.5px] leading-relaxed text-muted">
            Adds TV Tracker to your home screen so it opens full-screen, without
            browser chrome.
          </p>

          {/* Instructions rather than a button: `beforeinstallprompt` doesn't
              exist on Safari iOS, so a custom install button would work for
              half the users and silently do nothing for the other half. */}
          <div className="mt-3 space-y-4 text-[12.5px] leading-relaxed text-muted">
            <div>
              <p className="text-foreground">iPhone or iPad</p>
              <p className="mt-1 text-[11.5px]">
                Must be done in Safari — Chrome and other browsers on iOS
                can&rsquo;t install web apps, even though they can open this
                site.
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Open this site in Safari.</li>
                <li>
                  Tap the Share icon (a square with an arrow pointing up) in the
                  toolbar — on iPhone that&rsquo;s at the bottom of the screen,
                  on iPad it&rsquo;s at the top.
                </li>
                <li>
                  Scroll down the sheet that opens and tap “Add to Home Screen”.
                </li>
                <li>Tap “Add” in the top-right corner.</li>
              </ol>
            </div>

            <div>
              <p className="text-foreground">Android (Chrome)</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Open this site in Chrome.</li>
                <li>
                  Tap the ⋮ menu in the top-right corner (or the “Install”
                  banner, if Chrome already shows one at the bottom).
                </li>
                <li>
                  Tap “Install app” (older versions of Chrome show “Add to Home
                  screen” instead — either works).
                </li>
                <li>Confirm by tapping “Install”.</li>
              </ol>
              <p className="mt-2 text-[11.5px]">
                Other Android browsers (Firefox, Samsung Internet) have a
                similar option, usually under “Add to Home screen”.
              </p>
            </div>
          </div>
        </DisclosureRow>

        <SignOutButton />
      </Group>

      <DangerZone />
    </div>
  );
}
