import { ProfileForm } from "@/components/ProfileForm";
import { listProfiles } from "@/lib/profile/store";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const snapshot = await listProfiles();
  const label = snapshot.profiles.find((entry) => entry.id === snapshot.activeId)?.label ?? "Profile";
  return <ProfileForm initial={snapshot.active} profileLabel={label} profileId={snapshot.activeId} />;
}
