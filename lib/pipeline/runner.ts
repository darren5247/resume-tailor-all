import { randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { ensureDir } from "../paths";
import { loadProfile, profileIsUsable } from "../profile/store";
import { loadSettings } from "../settings";
import { inspectUrl } from "../scrape/detect";
import { createRun, getRun, persistNow, update } from "./store";
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

  // Batches keep the "jobs 11-20 of 32" label honest, and give a natural pause
  // between waves so a provider rate limit has room to recover.
  for (let start = 0; start < state.jobs.length; start += state.batchSize) {
    if (controller.signal.aborted) break;

    update(runId, (draft) => {
      draft.currentBatch = Math.floor(start / draft.batchSize) + 1;
    });

    const batch = state.jobs.slice(start, start + state.batchSize);
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
  return true;
}
