import { SettingsClient } from "./settings-client";
import { describeError, logger } from "@/lib/logger";
import { SignOutButton } from "@/components/sign-out-button";
import { requireOnboardedSession } from "@/lib/auth";
import { getSettings } from "@/lib/shows";
import { getWatchRegions, TmdbError } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · TV Tracker" };

export default async function SettingsPage() {
  const { user } = await requireOnboardedSession();
  const settings = await getSettings(user.id);

  // The country list comes from TMDB (cached for a day). If it can't be
  // fetched, the rest of the settings page should still work.
  let regions: Awaited<ReturnType<typeof getWatchRegions>> = [];

  try {
    regions = await getWatchRegions();
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    logger.warn("settings.regions_unavailable", describeError(error));
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <SettingsClient
        notifyEnabled={settings.notifyEnabled}
        country={settings.country}
        regions={regions}
      />

      <section className="mt-8">
        <h2 className="font-medium">Account</h2>
        <p className="mt-1 text-sm text-muted">
          Signed in as{" "}
          <span className="font-medium text-foreground">
            {user.nickname}
          </span>
          . Signing out ends this session only — other devices stay signed in.
        </p>

        <SignOutButton />
      </section>
    </div>
  );
}
