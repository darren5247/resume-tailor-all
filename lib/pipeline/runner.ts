import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { ensureDir } from "../paths";
import { loadProfile, profileIsUsable } from "../profile/store";
import { loadSettings } from "../settings";
import { inspectUrl } from "../scrape/detect";
import { createRun, getJobController, getRun, persistNow, resetJobController, update, updateJob } from "./store";
import { processJob } from "./job";
import { emptyUsage, initialSteps, type JobState, type RunState } from "./types";

export class RunSetupError extends Error {}

export async function startRun(urls: string[]): Promise<RunState> {
  const [settings, profile] = await Promise.all([loadSettings(), loadProfile()]);

  if (!settings.apiKey) throw new RunSetupError("Add an OpenAI API key on the Settings tab first.");
  const profileProblem = profileIsUsable(profile);
  if (profileProblem) throw new RunSetupError(profileProblem);
  if (urls.length === 0) throw new RunSetupError("Paste at least one job URL.");

  await ensureDir(settings.outputDir);

  const batchSize = settings.concurrency;
  const jobs: JobState[] = urls.map((url, index) => ({
    id: randomUUID(),
    index,
    url,
    label: inspectUrl(url)?.label ?? url,
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

  // Deliberately not awaited: the POST returns as soon as the run exists, and
  // the browser follows along over SSE.
  void execute(state.id).catch(() => undefined);

  return record.state;
}

async function execute(runId: string): Promise<void> {
  const record = getRun(runId);
  if (!record) return;

  const { state, controller } = record;
  const limit = pLimit(state.batchSize);
  const started = new Set<string>();
  let wave = 0;

  // Waves of currently queued jobs, so deleting a card mid-run cannot skip the
  // ones after it. The pause between waves still gives rate limits room to recover.
  while (!controller.signal.aborted) {
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
  const record = getRun(runId);
  if (!record) throw new RunSetupError("That run is no longer in memory. Start a new run.");

  const job = record.state.jobs.find((entry) => entry.id === jobId);
  if (!job) throw new RunSetupError("Unknown job.");

  if (record.controller.signal.aborted) {
    record.controller = new AbortController();
  }
  resetJobController(runId, jobId);
  if (record.state.status === "cancelled") {
    update(runId, (state) => {
      state.status = "running";
    });
  }

  void processJob(runId, jobId, pastedJd)
    .then(() => persistNow(runId))
    .catch(() => undefined);
}

export function cancelRun(runId: string): boolean {
  const record = getRun(runId);
  if (!record) return false;
  record.controller.abort();
  record.jobControllers ??= new Map();
  for (const jobController of record.jobControllers.values()) jobController.abort();
  return true;
}

export function cancelJob(runId: string, jobId: string): boolean {
  const record = getRun(runId);
  if (!record) return false;

  const job = record.state.jobs.find((entry) => entry.id === jobId);
  if (!job) return false;
  if (job.status !== "queued" && job.status !== "running") return false;

  getJobController(runId, jobId)?.abort();

  updateJob(runId, jobId, (state) => {
    state.status = "cancelled";
    state.error = "Cancelled.";
    state.note = "";
    state.finishedAt = Date.now();
  });

  void persistNow(runId);
  return true;
}

export async function deleteJob(runId: string, jobId: string): Promise<void> {
  const record = getRun(runId);
  if (!record) throw new RunSetupError("That run is no longer in memory. Start a new run.");

  const job = record.state.jobs.find((entry) => entry.id === jobId);
  if (!job) throw new RunSetupError("Unknown job.");

  getJobController(runId, jobId)?.abort();
  record.jobControllers.delete(jobId);

  const folder = jobOutputFolder(record.state.outputDir, job);

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
    await fsp.rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
  await persistNow(runId);
}

function jobOutputFolder(outputDir: string, job: JobState): string | null {
  if (job.downloads.length === 0) return null;
  const root = path.resolve(/* turbopackIgnore: true */ outputDir);
  const folder = path.resolve(/* turbopackIgnore: true */ root, path.dirname(job.downloads[0].file));
  if (folder === root || !folder.startsWith(root + path.sep)) return null;
  return folder;
}
