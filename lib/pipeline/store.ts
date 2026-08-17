import path from "node:path";
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

export function createRun(record: Omit<RunRecord, "listeners" | "persistTimer" | "jobControllers">): RunRecord {
  const jobControllers = new Map(record.state.jobs.map((job) => [job.id, new AbortController()]));
  const full: RunRecord = { ...record, jobControllers, listeners: new Set(), persistTimer: null };
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

export function listRuns(): RunState[] {
  return [...registry.values()].map((record) => record.state).sort((a, b) => b.createdAt - a.createdAt);
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
    void writeJson(runFile(record.state.id), record.state).catch(() => undefined);
  }, 1000);
  record.persistTimer.unref?.();
}

export async function persistNow(id: string): Promise<void> {
  const record = registry.get(id);
  if (!record) return;
  if (record.persistTimer) {
    clearTimeout(record.persistTimer);
    record.persistTimer = null;
  }
  await writeJson(runFile(id), record.state).catch(() => undefined);
}

export async function loadPersistedRun(id: string): Promise<RunState | null> {
  return readJson<RunState>(runFile(id));
}

function runFile(id: string): string {
  return path.join(RUNS_DIR, `${id}.json`);
}
