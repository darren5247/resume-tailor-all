import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
}

/** True when a Postgres connection string is available (Vercel Neon sets this). */
export function hasDatabase(): boolean {
  return Boolean(databaseUrl());
}

/**
 * Vercel/Lambda disks are ephemeral. Writes appear to succeed, then vanish on
 * the next instance. Profile and settings must use Postgres there.
 */
export function isEphemeralFs(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function missingDatabaseMessage(): string {
  return "Profile and settings cannot be saved on Vercel without Postgres. In the Vercel dashboard open Storage → Create Database → Neon, connect it to this project so DATABASE_URL is set, then redeploy.";
}

let client: Sql | null = null;
let schemaReady: Promise<void> | null = null;

function sql(): Sql {
  const url = databaseUrl();
  if (!url) {
    throw new Error(isEphemeralFs() ? missingDatabaseMessage() : "DATABASE_URL is not set.");
  }
  client ??= neon(url);
  return client;
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const q = sql();
    await q`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await q`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await q`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_profile_id TEXT
      )
    `;
    await q`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        profile JSONB NOT NULL DEFAULT '{}'::jsonb,
        signals JSONB NOT NULL DEFAULT '{"abortRun":false,"abortJobs":[]}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return null;
}

export interface ProfileMetaRow {
  id: string;
  label: string;
}

export async function dbLoadSettings(): Promise<Record<string, unknown> | null> {
  await ensureSchema();
  const rows = await sql()`SELECT data FROM app_settings WHERE id = 1 LIMIT 1`;
  return rows[0] ? asObject(rows[0].data) : null;
}

export async function dbSaveSettings(data: unknown): Promise<void> {
  await ensureSchema();
  const payload = JSON.stringify(data);
  await sql()`
    INSERT INTO app_settings (id, data, updated_at)
    VALUES (1, CAST(${payload} AS jsonb), NOW())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

export async function dbListProfiles(): Promise<{ activeId: string; profiles: ProfileMetaRow[] } | null> {
  await ensureSchema();
  const rows = await sql()`SELECT id, label FROM profiles ORDER BY created_at ASC`;
  if (rows.length === 0) return null;

  const state = await sql()`SELECT active_profile_id FROM app_state WHERE id = 1 LIMIT 1`;
  const ids = new Set(rows.map((row) => String(row.id)));
  let activeId = state[0]?.active_profile_id ? String(state[0].active_profile_id) : "";
  if (!activeId || !ids.has(activeId)) activeId = String(rows[0].id);

  return {
    activeId,
    profiles: rows.map((row) => ({ id: String(row.id), label: String(row.label) })),
  };
}

export async function dbWriteIndex(activeId: string, profiles: ProfileMetaRow[]): Promise<void> {
  await ensureSchema();
  const q = sql();
  await q`
    INSERT INTO app_state (id, active_profile_id)
    VALUES (1, ${activeId})
    ON CONFLICT (id) DO UPDATE SET active_profile_id = EXCLUDED.active_profile_id
  `;
  for (const meta of profiles) {
    await q`
      INSERT INTO profiles (id, label, data)
      VALUES (${meta.id}, ${meta.label}, '{}'::jsonb)
      ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, updated_at = NOW()
    `;
  }
  const keep = new Set(profiles.map((meta) => meta.id));
  const existing = await q`SELECT id FROM profiles`;
  for (const row of existing) {
    const id = String(row.id);
    if (!keep.has(id)) await q`DELETE FROM profiles WHERE id = ${id}`;
  }
}

export async function dbLoadProfile(id: string): Promise<Record<string, unknown> | null> {
  await ensureSchema();
  const rows = await sql()`SELECT data FROM profiles WHERE id = ${id} LIMIT 1`;
  return rows[0] ? asObject(rows[0].data) : null;
}

export async function dbSaveProfile(id: string, label: string, data: unknown): Promise<void> {
  await ensureSchema();
  const payload = JSON.stringify(data);
  await sql()`
    INSERT INTO profiles (id, label, data, updated_at)
    VALUES (${id}, ${label}, CAST(${payload} AS jsonb), NOW())
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
  `;
}

export async function dbDeleteProfile(id: string): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM profiles WHERE id = ${id}`;
}

export interface PipelineRunSignals {
  abortRun: boolean;
  abortJobs: string[];
}

export interface PipelineRunRow {
  state: Record<string, unknown>;
  settings: Record<string, unknown>;
  profile: Record<string, unknown>;
  signals: PipelineRunSignals;
}

function asSignals(value: unknown): PipelineRunSignals {
  const object = asObject(value);
  const abortJobs = object?.abortJobs;
  return {
    abortRun: object?.abortRun === true,
    abortJobs: Array.isArray(abortJobs) ? abortJobs.map((id) => String(id)) : [],
  };
}

export async function dbSavePipelineRun(id: string, data: {
  state: unknown;
  settings: unknown;
  profile: unknown;
}): Promise<void> {
  await ensureSchema();
  const state = JSON.stringify(data.state);
  const settings = JSON.stringify(data.settings);
  const profile = JSON.stringify(data.profile);
  await sql()`
    INSERT INTO pipeline_runs (id, state, settings, profile, updated_at)
    VALUES (${id}, CAST(${state} AS jsonb), CAST(${settings} AS jsonb), CAST(${profile} AS jsonb), NOW())
    ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
  `;
}

export async function dbLoadPipelineRun(id: string): Promise<PipelineRunRow | null> {
  await ensureSchema();
  const rows = await sql()`
    SELECT state, settings, profile, signals FROM pipeline_runs WHERE id = ${id} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const state = asObject(row.state);
  const settings = asObject(row.settings);
  const profile = asObject(row.profile);
  if (!state || !settings || !profile) return null;
  return { state, settings, profile, signals: asSignals(row.signals) };
}

export async function dbListPipelineRuns(): Promise<
  Array<{ id: string; createdAt: number; status: string; total: number }>
> {
  await ensureSchema();
  const rows = await sql()`
    SELECT id, state FROM pipeline_runs ORDER BY created_at DESC LIMIT 30
  `;
  return rows.flatMap((row) => {
    const state = asObject(row.state);
    if (!state) return [];
    return [
      {
        id: String(row.id),
        createdAt: Number(state.createdAt) || 0,
        status: String(state.status ?? "done"),
        total: Number(state.total) || 0,
      },
    ];
  });
}

export async function dbLoadPipelineSignals(id: string): Promise<PipelineRunSignals | null> {
  await ensureSchema();
  const rows = await sql()`SELECT signals FROM pipeline_runs WHERE id = ${id} LIMIT 1`;
  if (!rows[0]) return null;
  return asSignals(rows[0].signals);
}

export async function dbSetPipelineSignals(id: string, patch: { abortRun?: boolean; abortJob?: string }): Promise<boolean> {
  const current = await dbLoadPipelineSignals(id);
  if (!current) return false;
  if (patch.abortRun) current.abortRun = true;
  if (patch.abortJob && !current.abortJobs.includes(patch.abortJob)) {
    current.abortJobs.push(patch.abortJob);
  }
  const payload = JSON.stringify(current);
  await sql()`
    UPDATE pipeline_runs
    SET signals = CAST(${payload} AS jsonb), updated_at = NOW()
    WHERE id = ${id}
  `;
  return true;
}

export async function dbClearPipelineSignals(id: string): Promise<void> {
  await ensureSchema();
  const payload = JSON.stringify({ abortRun: false, abortJobs: [] });
  await sql()`
    UPDATE pipeline_runs
    SET signals = CAST(${payload} AS jsonb), updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function dbUpdatePipelineState(id: string, state: unknown): Promise<boolean> {
  await ensureSchema();
  const payload = JSON.stringify(state);
  await sql()`
    UPDATE pipeline_runs
    SET state = CAST(${payload} AS jsonb), updated_at = NOW()
    WHERE id = ${id}
  `;
  return true;
}
