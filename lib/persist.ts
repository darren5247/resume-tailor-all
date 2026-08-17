import path from "node:path";
import fs from "node:fs/promises";
import {
  dbDeleteProfile,
  dbListProfiles,
  dbLoadProfile,
  dbLoadSettings,
  dbSaveProfile,
  dbSaveSettings,
  dbWriteIndex,
  hasDatabase,
  isEphemeralFs,
  missingDatabaseMessage,
} from "./db";
import {
  PROFILES_DIR,
  PROFILES_INDEX_FILE,
  SETTINGS_FILE,
  ensureDir,
  readJson,
  safeFileName,
  writeJson,
} from "./paths";

export { hasDatabase, isEphemeralFs, missingDatabaseMessage };

export interface PersistedProfileMeta {
  id: string;
  label: string;
}

export interface PersistedIndex {
  activeId: string;
  profiles: PersistedProfileMeta[];
}

export function canPersist(): boolean {
  return hasDatabase() || !isEphemeralFs();
}

export function assertCanPersist(): void {
  if (!canPersist()) throw new Error(missingDatabaseMessage());
}

function profileFile(id: string): string {
  return path.join(PROFILES_DIR, `${safeFileName(id)}.json`);
}

export async function persistLoadSettings(): Promise<Record<string, unknown> | null> {
  if (hasDatabase()) {
    const stored = await dbLoadSettings();
    if (stored) return stored;
    const fromFile = await readJson<Record<string, unknown>>(SETTINGS_FILE);
    if (fromFile) {
      await dbSaveSettings(fromFile);
      return fromFile;
    }
    return null;
  }
  if (isEphemeralFs()) return null;
  return readJson<Record<string, unknown>>(SETTINGS_FILE);
}

export async function persistSaveSettings(data: unknown): Promise<void> {
  assertCanPersist();
  if (hasDatabase()) {
    await dbSaveSettings(data);
    return;
  }
  await writeJson(SETTINGS_FILE, data);
}

export async function persistLoadIndex(): Promise<PersistedIndex | null> {
  if (hasDatabase()) {
    const stored = await dbListProfiles();
    if (stored) return stored;
    return migrateFilesIntoDatabase();
  }
  if (isEphemeralFs()) return null;
  return readIndexFile();
}

export async function persistSaveIndex(index: PersistedIndex): Promise<void> {
  assertCanPersist();
  if (hasDatabase()) {
    await dbWriteIndex(index.activeId, index.profiles);
    return;
  }
  await writeJson(PROFILES_INDEX_FILE, index);
}

export async function persistLoadProfile(id: string): Promise<Record<string, unknown> | null> {
  if (hasDatabase()) return dbLoadProfile(id);
  if (isEphemeralFs()) return null;
  return readJson<Record<string, unknown>>(profileFile(id));
}

export async function persistSaveProfile(id: string, label: string, data: unknown): Promise<void> {
  assertCanPersist();
  if (hasDatabase()) {
    await dbSaveProfile(id, label, data);
    return;
  }
  await ensureDir(PROFILES_DIR);
  await writeJson(profileFile(id), data);
}

export async function persistDeleteProfile(id: string): Promise<void> {
  assertCanPersist();
  if (hasDatabase()) {
    await dbDeleteProfile(id);
    return;
  }
  await fs.unlink(profileFile(id)).catch(() => undefined);
}

async function readIndexFile(): Promise<PersistedIndex | null> {
  const stored = await readJson<PersistedIndex>(PROFILES_INDEX_FILE);
  if (!stored?.activeId || !Array.isArray(stored.profiles) || stored.profiles.length === 0) {
    return null;
  }
  return stored;
}

/** One-time copy of local JSON files into Postgres when the database is empty. */
async function migrateFilesIntoDatabase(): Promise<PersistedIndex | null> {
  const index = await readIndexFile();
  if (!index) return null;

  for (const meta of index.profiles) {
    const data = (await readJson<Record<string, unknown>>(profileFile(meta.id))) ?? {};
    await dbSaveProfile(meta.id, meta.label, data);
  }
  await dbWriteIndex(index.activeId, index.profiles);

  const settings = await readJson<Record<string, unknown>>(SETTINGS_FILE);
  if (settings) await dbSaveSettings(settings);

  return index;
}
