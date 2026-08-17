import { GenerateView } from "@/components/GenerateView";
import { listProfiles, profileIsUsable } from "@/lib/profile/store";
import { loadSettings, TEMPLATES } from "@/lib/settings";
import { isSheetConfigured } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export default async function GeneratePage() {
  const [snapshot, settings] = await Promise.all([listProfiles(), loadSettings()]);
  const profile = snapshot.active;
  const label = snapshot.profiles.find((entry) => entry.id === snapshot.activeId)?.label ?? "Profile";
  const templateName = TEMPLATES.find((entry) => entry.id === settings.template)?.name ?? settings.template;
  const problem =
    profileIsUsable(profile) ??
    (settings.apiKey ? null : "Add an OpenAI API key on the Settings tab.") ??
    (snapshot.profiles.length === 0 ? "Create a profile first." : null);

  return (
    <GenerateView
      ready={!problem}
      readyMessage={problem ?? ""}
      profileLabel={label}
      templateName={templateName}
      sheetsConfigured={isSheetConfigured(settings)}
    />
  );
}
