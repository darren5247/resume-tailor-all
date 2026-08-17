import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { listProfiles } from "@/lib/profile/store";
import { canPersist, missingDatabaseMessage } from "@/lib/persist";

export const metadata: Metadata = {
  title: "Resume Tailor",
  description: "ATS packets from job URLs",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const snapshot = await listProfiles();
  const profile = snapshot.active;
  const persistWarning = canPersist() ? null : missingDatabaseMessage();

  return (
    <html lang="en">
      <body>
        <div className="mx-auto w-full max-w-6xl px-6 pb-10 pt-6">
          <SiteHeader
            activeId={snapshot.activeId}
            profiles={snapshot.profiles}
            fullName={profile.fullName}
            headline={profile.headline}
            location={profile.location}
            country={profile.country}
            email={profile.email}
            phone={profile.phone}
            linkedin={profile.linkedin}
            persistWarning={persistWarning}
          />
          <main className="mt-8 flex flex-col gap-6 pb-24">{children}</main>
        </div>
      </body>
    </html>
  );
}
