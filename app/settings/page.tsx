import { SettingsForm } from "@/components/SettingsForm";
import { loadSettings, redactSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await loadSettings();
  return <SettingsForm initial={redactSettings(settings)} />;
}
