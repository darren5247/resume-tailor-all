import type { HiringChannel, WorkplaceType } from "../llm/schemas";

export interface BadgeSource {
  hiringChannel: HiringChannel;
  clientCompany: string;
  isStartup: boolean;
  workplaceType: WorkplaceType;
}

/** The same labels JobCard shows — used when writing the Google Sheet. */
export function jobBadgeLabels(job: BadgeSource): string[] {
  const labels: string[] = [];
  if (job.hiringChannel === "direct") labels.push("Direct hire");
  if (job.hiringChannel === "agency") {
    labels.push(job.clientCompany.trim() ? `Agency · ${job.clientCompany.trim()}` : "Agency");
  }
  if (job.isStartup) labels.push("Startup");
  if (job.workplaceType === "hybrid") labels.push("Hybrid");
  if (job.workplaceType === "onsite") labels.push("On-site");
  return labels;
}

export function formatBadgeLabels(job: BadgeSource): string {
  return jobBadgeLabels(job).join(" · ");
}
