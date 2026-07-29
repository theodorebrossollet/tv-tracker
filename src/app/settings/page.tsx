import { SettingsClient } from "./settings-client";
import { getSettings } from "@/lib/shows";
import { getWatchRegions, TmdbError } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · TV Tracker" };

export default async function SettingsPage() {
  const settings = await getSettings();

  // The country list comes from TMDB (cached for a day). If it can't be
  // fetched, the rest of the settings page should still work.
  let regions: Awaited<ReturnType<typeof getWatchRegions>> = [];

  try {
    regions = await getWatchRegions();
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    console.error("Could not load country list:", error.message);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <SettingsClient
        notifyEnabled={settings.notifyEnabled}
        country={settings.country}
        regions={regions}
      />
    </div>
  );
}
