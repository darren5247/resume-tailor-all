import path from "node:path";
import {
  dbLoadPipelineRun,
  dbLoadPipelineSignals,
  dbListPipelineRuns,
  dbSavePipelineRun,
  dbSetPipelineSignals,
  dbClearPipelineSignals,
  dbUpdatePipelineState,
  hasDatabase,
  isEphemeralFs,
} from "../db";
import { RUNS_DIR, writeJson, readJson } from "../paths";
import type { Profile } from "../profile/schema";
import type { Settings } from "../settings-schema";
import type { JobState, RunState } from "./types";

export interface RunRecord {
  state: RunState;
  /** Frozen at start so editing Settings mid-run cannot change the outcome. */
  settings: Settings;
  profile: Profile;
  controller: AbortController;
  /** Per-job abort so one resume can be cancelled without stopping the batch. */
  jobControllers: Map<string, AbortController>;
  listeners: Set<(state: RunState) => void>;
  persistTimer: NodeJS.Timeout | null;
  abortPoller: NodeJS.Timeout | null;
}

/**
 * Runs live in memory for the duration of the process. `globalThis` keeps them
 * alive across Next.js hot reloads, which would otherwise drop an in-flight run
 * every time a file is saved during development.
 */
const registry: Map<string, RunRecord> = (() => {
  const key = "__resumeTailorRuns" as const;
  const store = globalThis as typeof globalThis & { [key]?: Map<string, RunRecord> };
  store[key] ??= new Map<string, RunRecord>();
  return store[key];
})();

export function createRun(record: Omit<RunRecord, "listeners" | "persistTimer" | "jobControllers" | "abortPoller">): RunRecord {
  const jobControllers = new Map(record.state.jobs.map((job) => [job.id, new AbortController()]));
  const full: RunRecord = {
    ...record,
    jobControllers,
    listeners: new Set(),
    persistTimer: null,
    abortPoller: null,
  };
  registry.set(record.state.id, full);
  return full;
}

export function getJobController(runId: string, jobId: string): AbortController | undefined {
  const record = registry.get(runId);
  if (!record) return undefined;
  record.jobControllers ??= new Map();
  let controller = record.jobControllers.get(jobId);
  if (!controller) {
    controller = new AbortController();
    record.jobControllers.set(jobId, controller);
  }
  return controller;
}

export function resetJobController(runId: string, jobId: string): AbortController | undefined {
  const record = registry.get(runId);
  if (!record) return undefined;
  record.jobControllers ??= new Map();
  const controller = new AbortController();
  record.jobControllers.set(jobId, controller);
  return controller;
}

export function getRun(id: string): RunRecord | undefined {
  return registry.get(id);
}

export function getState(id: string): RunState | undefined {
  return registry.get(id)?.state;
}

export async function listRuns(): Promise<Array<{ id: string; createdAt: number; status: string; total: number }>> {
  if (hasDatabase()) {
    const stored = await dbListPipelineRuns();
    if (stored.length > 0) return stored;
  }
  return [...registry.values()]
    .map((record) => ({
      id: record.state.id,
      createdAt: record.state.createdAt,
      status: record.state.status,
      total: record.state.total,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Rebuild an in-memory record from Postgres so retry/delete can run on a new instance. */
export async function ensureRun(id: string): Promise<RunRecord | undefined> {
  const live = registry.get(id);
  if (live) return live;
  if (!hasDatabase()) return undefined;
  const row = await dbLoadPipelineRun(id);
  if (!row) return undefined;
  return createRun({
    state: row.state as unknown as RunState,
    settings: row.settings as unknown as Settings,
    profile: row.profile as unknown as Profile,
    controller: new AbortController(),
  });
}

export function subscribe(id: string, listener: (state: RunState) => void): () => void {
  const record = registry.get(id);
  if (!record) return () => undefined;
  record.listeners.add(listener);
  return () => record.listeners.delete(listener);
}

/** Apply a mutation, notify subscribers immediately, and persist lazily. */
export function update(id: string, mutate: (state: RunState) => void): void {
  const record = registry.get(id);
  if (!record) return;
  mutate(record.state);
  for (const listener of record.listeners) {
    try {
      listener(record.state);
    } catch {
      // A dead SSE connection must never stop the pipeline.
    }
  }
  schedulePersist(record);
}

export function updateJob(runId: string, jobId: string, mutate: (job: JobState) => void): void {
  update(runId, (state) => {
    const job = state.jobs.find((entry) => entry.id === jobId);
    if (job) mutate(job);
  });
}

function schedulePersist(record: RunRecord) {
  if (record.persistTimer) return;
  record.persistTimer = setTimeout(() => {
    record.persistTimer = null;
    void flush(record);
  }, hasDatabase() ? 250 : 1000);
  if (!isEphemeralFs()) record.persistTimer.unref?.();
}

async function flush(record: RunRecord): Promise<void> {
  await applyRemoteAborts(record.state.id).catch(() => undefined);
  if (hasDatabase()) {
    await dbSavePipelineRun(record.state.id, {
      state: record.state,
      settings: record.settings,
      profile: record.profile,
    }).catch((error) => {
      console.error("[resume-tailor] persist run", error);
    });
  }
  if (!isEphemeralFs()) {
    await writeJson(runFile(record.state.id), record.state).catch(() => undefined);
  }
}

export async function persistNow(id: string): Promise<void> {
  const record = registry.get(id);
  if (!record) return;
  if (record.persistTimer) {
    clearTimeout(record.persistTimer);
    record.persistTimer = null;
  }
  await flush(record);
}

export async function loadPersistedRun(id: string): Promise<RunState | null> {
  if (hasDatabase()) {
    const row = await dbLoadPipelineRun(id);
    if (row) return row.state as unknown as RunState;
  }
  if (isEphemeralFs()) return null;
  return readJson<RunState>(runFile(id));
}

export async function requestAbort(runId: string, jobId?: string): Promise<boolean> {
  if (hasDatabase()) {
    const ok = await dbSetPipelineSignals(runId, jobId ? { abortJob: jobId } : { abortRun: true });
    if (ok) return true;
  }
  return Boolean(registry.get(runId));
}

export async function clearAbortSignals(runId: string): Promise<void> {
  if (hasDatabase()) await dbClearPipelineSignals(runId);
}

export async function persistStateOnly(state: RunState): Promise<void> {
  if (hasDatabase()) {
    await dbUpdatePipelineState(state.id, state);
    return;
  }
  if (!isEphemeralFs()) await writeJson(runFile(state.id), state).catch(() => undefined);
}

export async function applyRemoteAborts(runId: string): Promise<void> {
  if (!hasDatabase()) return;
  const record = registry.get(runId);
  if (!record) return;
  const signals = await dbLoadPipelineSignals(runId);
  if (!signals) return;

  if (signals.abortRun) {
    if (!record.controller.signal.aborted) record.controller.abort();
    const needsCancel =
      record.state.status === "running" ||
      record.state.jobs.some((job) => job.status === "queued" || job.status === "running");
    if (needsCancel) {
      update(runId, (draft) => {
        if (draft.status === "running") draft.status = "cancelled";
        for (const job of draft.jobs) {
          if (job.status !== "queued" && job.status !== "running") continue;
          job.status = "cancelled";
          job.error = "Cancelled.";
          job.note = "";
          job.finishedAt = Date.now();
        }
      });
    }
  }
  for (const jobId of signals.abortJobs) {
    const job = record.state.jobs.find((entry) => entry.id === jobId);
    if (!job || (job.status !== "queued" && job.status !== "running")) continue;
    getJobController(runId, jobId)?.abort();
    if (job.status === "queued" || job.status === "running") {
      updateJob(runId, jobId, (state) => {
        if (state.status !== "queued" && state.status !== "running") return;
        state.status = "cancelled";
        state.error = "Cancelled.";
        state.note = "";
        state.finishedAt = Date.now();
      });
    }
  }
}

export function startAbortPoller(runId: string): void {
  if (!hasDatabase()) return;
  const record = registry.get(runId);
  if (!record || record.abortPoller) return;
  record.abortPoller = setInterval(() => {
    void applyRemoteAborts(runId);
  }, 750);
}

export function stopAbortPoller(runId: string): void {
  const record = registry.get(runId);
  if (!record?.abortPoller) return;
  clearInterval(record.abortPoller);
  record.abortPoller = null;
}

function runFile(id: string): string {
  return path.join(RUNS_DIR, `${id}.json`);
}
