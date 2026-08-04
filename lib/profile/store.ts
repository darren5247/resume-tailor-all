import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  PROFILE_FILE,
  PROFILES_DIR,
  PROFILES_INDEX_FILE,
  SETTINGS_FILE,
  ensureDir,
  readJson,
  safeFileName,
  slugify,
  writeJson,
} from "../paths";
import { Profile, ProfileSchema, emptyProfile, firstName, inferCountryFromLocation, type ProfileCountry, PROFILE_COUNTRIES } from "./schema";
import { legacyBulletsPerCompany } from "../settings-schema";

export interface ProfileMeta {
  id: string;
  /** Short label shown in the header dropdown (Diego, Jomar, …). */
  label: string;
}

export interface ProfilesIndex {
  activeId: string;
  profiles: ProfileMeta[];
}

export interface ProfilesSnapshot {
  activeId: string;
  active: Profile;
  profiles: ProfileMeta[];
}

function profilePath(id: string): string {
  return path.join(PROFILES_DIR, `${safeFileName(id)}.json`);
}

function labelFromProfile(profile: Profile, fallback = "Profile"): string {
  const name = profile.fullName.trim();
  if (!name) return fallback;
  return firstName(profile);
}

async function writeIndex(index: ProfilesIndex): Promise<void> {
  await writeJson(PROFILES_INDEX_FILE, index);
}

async function readIndex(): Promise<ProfilesIndex | null> {
  const stored = await readJson<ProfilesIndex>(PROFILES_INDEX_FILE);
  if (!stored?.activeId || !Array.isArray(stored.profiles) || stored.profiles.length === 0) {
    return null;
  }
  return stored;
}

/** One-time move from the old single profile.json into the multi-profile layout. */
async function migrateLegacyIfNeeded(): Promise<ProfilesIndex | null> {
  const legacy = await readJson<unknown>(PROFILE_FILE);
  if (!legacy) return null;

  const parsed = ProfileSchema.safeParse(legacy);
  const profile = parsed.success ? parsed.data : emptyProfile();
  const id = randomUUID();
  const index: ProfilesIndex = {
    activeId: id,
    profiles: [{ id, label: labelFromProfile(profile, "Profile 1") }],
  };

  await ensureDir(PROFILES_DIR);
  await writeJson(profilePath(id), profile);
  await writeIndex(index);

  // Keep the old file as a backup so nothing is silently lost.
  try {
    await fs.rename(PROFILE_FILE, path.join(path.dirname(PROFILE_FILE), "profile.legacy.json"));
  } catch {
    try {
      await fs.unlink(PROFILE_FILE);
    } catch {
      // Ignore; the multi-profile files are already the source of truth.
    }
  }

  return index;
}

async function ensureIndex(): Promise<ProfilesIndex> {
  const existing = await readIndex();
  if (existing) return existing;

  const migrated = await migrateLegacyIfNeeded();
  if (migrated) return migrated;

  const id = randomUUID();
  const index: ProfilesIndex = {
    activeId: id,
    profiles: [{ id, label: "Profile 1" }],
  };
  await ensureDir(PROFILES_DIR);
  await writeJson(profilePath(id), emptyProfile());
  await writeIndex(index);
  return index;
}

async function loadProfileById(id: string): Promise<Profile> {
  const stored = await readJson<Record<string, unknown>>(profilePath(id));
  if (!stored) return emptyProfile();

  // One-time seed from settings when this field still lived there.
  if (!Array.isArray(stored.bulletsPerCompany)) {
    const settingsRaw = await readJson<Record<string, unknown>>(SETTINGS_FILE);
    const legacy = legacyBulletsPerCompany(settingsRaw);
    if (legacy) stored.bulletsPerCompany = legacy;
  }

  // Profiles created before `country` existed: infer from location text.
  if (typeof stored.country !== "string" || !PROFILE_COUNTRIES.includes(stored.country as ProfileCountry)) {
    stored.country = inferCountryFromLocation(String(stored.location ?? ""));
  }

  const parsed = ProfileSchema.safeParse(stored);
  return parsed.success ? parsed.data : emptyProfile();
}

export async function listProfiles(): Promise<ProfilesSnapshot> {
  const index = await ensureIndex();
  const active = await loadProfileById(index.activeId);
  return { activeId: index.activeId, active, profiles: index.profiles };
}

export async function loadProfile(): Promise<Profile> {
  const snapshot = await listProfiles();
  return snapshot.active;
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const index = await ensureIndex();
  const parsed = ProfileSchema.parse(profile);
  await writeJson(profilePath(index.activeId), parsed);

  const meta = index.profiles.find((entry) => entry.id === index.activeId);
  if (meta && parsed.fullName.trim()) {
    // Keep custom dropdown labels (e.g. "Mar Angelo"). Only fill in when the
    // label is still a placeholder like "Profile 1".
    if (!meta.label.trim() || /^profile\s+\d+$/i.test(meta.label)) {
      meta.label = labelFromProfile(parsed, meta.label);
      await writeIndex(index);
    }
  }

  return parsed;
}

export async function selectProfile(id: string): Promise<ProfilesSnapshot> {
  const index = await ensureIndex();
  if (!index.profiles.some((entry) => entry.id === id)) {
    throw new Error("That profile does not exist.");
  }
  index.activeId = id;
  await writeIndex(index);
  return listProfiles();
}

export async function createProfile(label?: string, country?: ProfileCountry): Promise<ProfilesSnapshot> {
  const index = await ensureIndex();
  const id = randomUUID();
  const nextLabel =
    label?.trim() ||
    `Profile ${index.profiles.length + 1}`;

  const resolvedCountry: ProfileCountry =
    country && PROFILE_COUNTRIES.includes(country) ? country : "US";
  const blank = emptyProfile(resolvedCountry);
  if (label?.trim()) blank.fullName = label.trim();

  index.profiles.push({ id, label: nextLabel });
  index.activeId = id;
  await writeJson(profilePath(id), blank);
  await writeIndex(index);
  return listProfiles();
}

export async function deleteProfile(id?: string): Promise<ProfilesSnapshot> {
  const index = await ensureIndex();
  if (index.profiles.length <= 1) {
    throw new Error("Keep at least one profile.");
  }

  const targetId = id ?? index.activeId;
  const remaining = index.profiles.filter((entry) => entry.id !== targetId);
  if (remaining.length === index.profiles.length) {
    throw new Error("That profile does not exist.");
  }

  index.profiles = remaining;
  if (index.activeId === targetId) {
    index.activeId = remaining[0].id;
  }

  await writeIndex(index);
  await fs.unlink(profilePath(targetId)).catch(() => undefined);
  return listProfiles();
}

export async function renameActiveProfile(label: string): Promise<ProfilesSnapshot> {
  const index = await ensureIndex();
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Profile name cannot be empty.");

  const meta = index.profiles.find((entry) => entry.id === index.activeId);
  if (!meta) throw new Error("No active profile.");
  meta.label = trimmed;
  await writeIndex(index);
  return listProfiles();
}

export function profileIsUsable(profile: Profile): string | null {
  if (!profile.fullName.trim()) return "Add your full name on the Profile tab.";
  if (profile.experience.length === 0) return "Add at least one experience entry on the Profile tab.";
  if (profile.country === "Colombia" && !profile.resumePrompt.trim()) {
    return "Add a Resume prompt on the Profile tab (Colombia generation uses only that prompt).";
  }
  return null;
}

/** Unused helper kept for slug-based folder names if we ever need it. */
export function profileSlug(meta: ProfileMeta): string {
  return slugify(meta.label, 40);
}
