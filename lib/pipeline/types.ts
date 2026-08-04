import type { UsageTotals } from "../llm/client";

export const STEPS = [
  { id: "scrape", label: "Scrape" },
  { id: "fetch", label: "Fetch" },
  { id: "extract", label: "Extract" },
  { id: "generate", label: "Generate" },
  { id: "validate", label: "Validate" },
  { id: "zip", label: "Zip" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];
export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type RunStatus = "running" | "done" | "cancelled";

export interface DownloadRef {
  label: string;
  /** Path relative to the run's output directory, which is what the API resolves. */
  file: string;
  kind: "resume" | "resume-pdf" | "cover" | "zip";
}

export interface JobState {
  id: string;
  index: number;
  url: string;
  label: string;
  status: JobStatus;
  steps: Record<StepId, StepStatus>;
  note: string;
  company: string;
  role: string;
  error: string | null;
  /** What each rung of the scrape ladder reported, shown when a job fails. */
  attempts: string[];
  /** A failed scrape can be rescued by pasting the description by hand. */
  canPaste: boolean;
  atsScore: number | null;
  matchedKeywords: string[];
  missingKeywords: string[];
  warnings: string[];
  violations: string[];
  downloads: DownloadRef[];
  usage: UsageTotals;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface RunState {
  id: string;
  createdAt: number;
  status: RunStatus;
  total: number;
  batchSize: number;
  outputDir: string;
  jobs: JobState[];
  usage: UsageTotals;
  /** 1-based index of the batch currently in flight. */
  currentBatch: number;
  batchCount: number;
}

export function emptyUsage(): UsageTotals {
  return { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
}

export function initialSteps(): Record<StepId, StepStatus> {
  return {
    scrape: "pending",
    fetch: "pending",
    extract: "pending",
    generate: "pending",
    validate: "pending",
    zip: "pending",
  };
}

export function summarize(run: RunState) {
  let done = 0;
  let running = 0;
  let failed = 0;
  for (const job of run.jobs) {
    if (job.status === "done") done += 1;
    else if (job.status === "running") running += 1;
    else if (job.status === "failed") failed += 1;
  }
  return { done, running, failed, queued: run.total - done - running - failed };
}
