import { ChangePasswordForm } from "./change-password-form";
import { DangerZone } from "./danger-zone";
import { SettingsClient } from "./settings-client";
import { describeError, logger } from "@/lib/logger";
import { SignOutButton } from "@/components/sign-out-button";
import { requireOnboardedSession } from "@/lib/auth";
import { parseProviderIds } from "@/lib/alternate-countries";
import { getSettings } from "@/lib/shows";
import { getWatchProviderList, getWatchRegions, TmdbError } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · TV Tracker" };

export default async function SettingsPage() {
  const { user } = await requireOnboardedSession();
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

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <SettingsClient
        notifyEnabled={settings.notifyEnabled}
        country={settings.country}
        regions={regions}
        providerOptions={providerOptions}
        providerIds={parseProviderIds(settings.providerIds)}
      />

      <section className="mt-8">
        <h2 className="font-medium">Install on your phone</h2>
        <p className="mt-1 text-sm text-muted">
          Adds TV Tracker to your home screen so it opens full-screen, without
          browser chrome.
        </p>
        {/* Instructions rather than a button: `beforeinstallprompt` doesn't
            exist on Safari iOS, so a custom install button would work for half
            the users and silently do nothing for the other half. */}
        <div className="mt-3 space-y-4 text-sm text-muted">
          <div>
            <p className="text-foreground">iPhone or iPad</p>
            <p className="mt-1 text-xs text-muted">
              Must be done in Safari — Chrome and other browsers on iOS can&rsquo;t
              install web apps, even though they can open this site.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Open this site in Safari.</li>
              <li>
                Tap the Share icon (a square with an arrow pointing up) in the
                toolbar — on iPhone that&rsquo;s at the bottom of the screen, on
                iPad it&rsquo;s at the top.
              </li>
              <li>Scroll down the sheet that opens and tap “Add to Home Screen”.</li>
              <li>Tap “Add” in the top-right corner.</li>
            </ol>
            <p className="mt-2 text-xs text-muted">
              An icon appears on your home screen. Open the app from there, not
              from Safari, to get the full-screen experience.
            </p>
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
            <p className="mt-2 text-xs text-muted">
              Other Android browsers (Firefox, Samsung Internet) have a similar
              option, usually under “Add to Home screen” in their menu.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-medium">Account</h2>
        <p className="mt-1 text-sm text-muted">
          Signed in as{" "}
          <span className="font-medium text-foreground">
            {user.nickname}
          </span>
          . Signing out ends this session only — other devices stay signed in.
          Sign out everywhere ends all of them, including this one, for when
          you&rsquo;ve left yourself signed in somewhere you&rsquo;d rather not
          have.
        </p>

        <SignOutButton />

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-medium">Password</h3>
          <p className="mt-1 text-sm text-muted">
            Changing it requires your account code — the one you were given
            when invited — as proof it&rsquo;s really you. Keep that code
            regardless: it&rsquo;s still the only way back in if you forget
            whatever password you set here.
          </p>
          <p className="mt-2 text-sm text-muted">
            Changing your password signs you out everywhere else — your other
            devices will need the new one. That&rsquo;s the point: it&rsquo;s
            what makes changing it useful if you think someone else is in your
            account.
          </p>
          <ChangePasswordForm />
        </div>
      </section>

      <section className="mt-8">
        <DangerZone />
      </section>
    </div>
  );
}
