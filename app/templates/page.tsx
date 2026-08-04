import { TemplatesView } from "@/components/TemplatesView";
import { loadProfile } from "@/lib/profile/store";
import { loadSettings } from "@/lib/settings";
import { resumeForPreview } from "@/lib/templates/sample";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const [settings, profile] = await Promise.all([loadSettings(), loadProfile()]);
  const usingSample = !profile.fullName.trim() || profile.experience.length === 0;

  return (
    <TemplatesView
      initialTemplate={settings.template}
      previewResume={resumeForPreview(profile)}
      usingSample={usingSample}
    />
  );
}
