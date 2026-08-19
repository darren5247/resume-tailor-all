import { randomUUID } from "node:crypto";
import path from "node:path";
import pLimit from "p-limit";
import { deleteBlobs } from "../blob-store";
import { ensureDir, removeDir, resolveOutputDir } from "../paths";
import { loadProfile, profileIsUsable } from "../profile/store";
import { loadSettings } from "../settings";
import { hostLabel, normalizeUrl } from "../scrape/url";
import {
  applyRemoteAborts,
  createRun,
  ensureRun,
  getJobController,
  getRun,
  persistNow,
  persistStateOnly,
  requestAbort,
  clearAbortSignals,
  resetJobController,
  startAbortPoller,
  stopAbortPoller,
  update,
  updateJob,
  loadPersistedRun,
} from "./store";
import { emptyUsage, initialSteps, type JobState, type RunState } from "./types";

export class RunSetupError extends Error {}

export async function startRun(urls: string[]): Promise<RunState> {
  const [settings, profile] = await Promise.all([loadSettings(), loadProfile()]);

  if (!settings.apiKey) throw new RunSetupError("Add an OpenAI API key on the Settings tab first.");
  const profileProblem = profileIsUsable(profile);
  if (profileProblem) throw new RunSetupError(profileProblem);
  if (urls.length === 0) throw new RunSetupError("Paste at least one job URL.");

  settings.outputDir = resolveOutputDir(settings.outputDir);
  await ensureDir(settings.outputDir);

  const batchSize = settings.concurrency;
  const jobs: JobState[] = urls.map((url, index) => ({
    id: randomUUID(),
    index,
    url,
    label: jobLabel(url),
    status: "queued",
    steps: initialSteps(),
    note: "",
    company: "",
    role: "",
    hiringChannel: "unknown",
    clientCompany: "",
    isStartup: false,
    workplaceType: "unspecified",
    salaryExpectation: "",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: "",
    error: null,
    attempts: [],
    canPaste: false,
    atsScore: null,
    matchedKeywords: [],
    missingKeywords: [],
    warnings: [],
    violations: [],
    downloads: [],
    usage: emptyUsage(),
    startedAt: null,
    finishedAt: null,
  }));

  const state: RunState = {
    id: randomUUID(),
    createdAt: Date.now(),
    status: "running",
    total: jobs.length,
    batchSize,
    outputDir: settings.outputDir,
    jobs,
    usage: emptyUsage(),
    currentBatch: 1,
    batchCount: Math.max(1, Math.ceil(jobs.length / batchSize)),
  };

  const record = createRun({ state, settings, profile, controller: new AbortController() });
  await persistNow(record.state.id);
  return record.state;
}

export async function executeRun(runId: string): Promise<void> {
  const record = getRun(runId);
  if (!record) return;

  startAbortPoller(runId);
  try {
    await execute(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[resume-tailor] run failed", runId, error);
    update(runId, (draft) => {
      if (draft.status === "running") draft.status = "done";
      for (const job of draft.jobs) {
        if (job.status === "queued" || job.status === "running") {
          job.status = "failed";
          job.error = message;
          job.note = "";
          job.finishedAt = Date.now();
        }
      }
    });
  } finally {
    stopAbortPoller(runId);
    await persistNow(runId);
  }
}

async function execute(runId: string): Promise<void> {
  const record = getRun(runId);
  if (!record) return;

  const { state, controller } = record;
  const { processJob } = await import("./job");
  const limit = pLimit(state.batchSize);
  const started = new Set<string>();
  let wave = 0;

  // Waves of currently queued jobs, so deleting a card mid-run cannot skip the
  // ones after it. The pause between waves still gives rate limits room to recover.
  while (!controller.signal.aborted) {
    await applyRemoteAborts(runId);
    if (controller.signal.aborted) break;

    const queued = state.jobs.filter((job) => job.status === "queued" && !started.has(job.id));
    if (queued.length === 0) break;

    const batch = queued.slice(0, state.batchSize);
    for (const job of batch) started.add(job.id);

    wave += 1;
    update(runId, (draft) => {
      draft.currentBatch = wave;
      draft.batchCount = Math.max(wave, Math.ceil(Math.max(draft.jobs.length, 1) / draft.batchSize));
    });

    await Promise.all(batch.map((job) => limit(() => processJob(runId, job.id))));
  }

  update(runId, (draft) => {
    draft.status = controller.signal.aborted ? "cancelled" : "done";
    for (const job of draft.jobs) {
      if (job.status === "queued" || job.status === "running") job.status = "cancelled";
    }
  });
  await persistNow(runId);
}

export async function retryJob(runId: string, jobId: string, pastedJd?: string): Promise<void> {
  const record = await ensureRun(runId);
  if (!record) throw new RunSetupError("That run is no longer in memory. Start a new run.");

  const job = record.state.jobs.find((entry) => entry.id === jobId);
  if (!job) throw new RunSetupError("Unknown job.");

  if (record.controller.signal.aborted) {
    record.controller = new AbortController();
  }
  resetJobController(runId, jobId);
  await clearAbortSignals(runId);
  if (record.state.status !== "running") {
    update(runId, (state) => {
      state.status = "running";
    });
  }

  startAbortPoller(runId);
  try {
    const { processJob } = await import("./job");
    await processJob(runId, jobId, pastedJd);
    const live = getRun(runId);
    if (live && live.state.jobs.every((entry) => entry.status !== "running" && entry.status !== "queued")) {
      update(runId, (state) => {
        if (state.status === "running") state.status = "done";
      });
    }
  } finally {
    stopAbortPoller(runId);
    await persistNow(runId);
  }
}

export async function cancelRun(runId: string): Promise<boolean> {
  const record = getRun(runId);
  if (record) {
    record.controller.abort();
    record.jobControllers ??= new Map();
    for (const jobController of record.jobControllers.values()) jobController.abort();
  }

  const signaled = await requestAbort(runId);
  if (!record) {
    const state = await loadPersistedRun(runId);
    if (!state) return signaled;
    state.status = "cancelled";
    for (const job of state.jobs) {
      if (job.status === "queued" || job.status === "running") {
        job.status = "cancelled";
        job.error = "Cancelled.";
        job.note = "";
        job.finishedAt = Date.now();
      }
    }
    await persistStateOnly(state);
    return true;
  }

  update(runId, (draft) => {
    draft.status = "cancelled";
    for (const job of draft.jobs) {
      if (job.status === "queued" || job.status === "running") {
        job.status = "cancelled";
        job.error = "Cancelled.";
        job.note = "";
        job.finishedAt = Date.now();
      }
    }
  });
  await persistNow(runId);
  return true;
}

export async function cancelJob(runId: string, jobId: string): Promise<boolean> {
  const record = getRun(runId);
  const job = record?.state.jobs.find((entry) => entry.id === jobId);

  if (record && job) {
    if (job.status !== "queued" && job.status !== "running") return false;
    getJobController(runId, jobId)?.abort();
    updateJob(runId, jobId, (state) => {
      state.status = "cancelled";
      state.error = "Cancelled.";
      state.note = "";
      state.finishedAt = Date.now();
    });
    await requestAbort(runId, jobId);
    await persistNow(runId);
    return true;
  }

  const state = await loadPersistedRun(runId);
  const stored = state?.jobs.find((entry) => entry.id === jobId);
  if (!state || !stored) return false;
  if (stored.status !== "queued" && stored.status !== "running") return false;

  stored.status = "cancelled";
  stored.error = "Cancelled.";
  stored.note = "";
  stored.finishedAt = Date.now();
  await requestAbort(runId, jobId);
  await persistStateOnly(state);
  return true;
}

export async function deleteJob(runId: string, jobId: string): Promise<{ sheetWarning?: string }> {
  const record = await ensureRun(runId);
  if (!record) throw new RunSetupError("That run is no longer in memory. Start a new run.");

  const job = record.state.jobs.find((entry) => entry.id === jobId);
  if (!job) throw new RunSetupError("Unknown job.");

  const url = job.url;
  getJobController(runId, jobId)?.abort();
  record.jobControllers.delete(jobId);

  const folder = jobOutputFolder(record.state.outputDir, job);
  await deleteBlobs(job.downloads.map((download) => download.blobUrl));

  update(runId, (state) => {
    state.jobs = state.jobs.filter((entry) => entry.id !== jobId);
    state.jobs.forEach((entry, index) => {
      entry.index = index;
    });
    state.total = state.jobs.length;
    state.batchCount = Math.max(1, Math.ceil(Math.max(state.jobs.length, 1) / state.batchSize));
    if (state.currentBatch > state.batchCount) state.currentBatch = state.batchCount;
  });

  if (folder) {
    await removeDir(folder).catch(() => undefined);
  }
  await persistNow(runId);

  try {
    const { deleteSheetJob, isSheetConfigured } = await import("../sheets");
    if (isSheetConfigured(record.settings)) {
      await deleteSheetJob(url, record.settings);
    }
  } catch (error) {
    return { sheetWarning: error instanceof Error ? error.message : String(error) };
  }
  return {};
}

function jobLabel(url: string): string {
  const parsed = normalizeUrl(url);
  return parsed ? hostLabel(parsed) : url;
}

function jobOutputFolder(outputDir: string, job: JobState): string | null {
  if (job.downloads.length === 0) return null;
  const root = path.resolve(/* turbopackIgnore: true */ outputDir);
  const folder = path.resolve(/* turbopackIgnore: true */ root, path.dirname(job.downloads[0].file));
  if (folder === root || !folder.startsWith(root + path.sep)) return null;
  return folder;
}
