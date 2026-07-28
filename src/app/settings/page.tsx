import { SettingsClient } from "./settings-client";
import { getSettings } from "@/lib/shows";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings · TV Tracker" };

export default async function SettingsPage() {
  const settings = await getSettings();

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <SettingsClient notifyEnabled={settings.notifyEnabled} />
    </div>
  );
}
