import type { JobSpec } from "../llm/schemas";

export type EligibilityResult = { ok: true } | { ok: false; reason: string };

/** Minimum acceptable stated pay (monthly USD). Below this, skip the job. */
export const MIN_SALARY_MONTHLY_USD = 2500;

/**
 * Reject postings whose stated pay converts to under $2500 / month.
 * Unstated or non-convertible compensation is allowed through.
 */
export function checkSalaryEligibility(job: JobSpec): EligibilityResult {
  const amount = job.salaryMonthlyUsd;
  if (amount == null || !Number.isFinite(amount)) return { ok: true };
  if (amount < MIN_SALARY_MONTHLY_USD) {
    const rounded = Math.round(amount);
    const stated = job.salaryExpectation.trim();
    const detail = stated ? ` (${stated})` : "";
    return {
      ok: false,
      reason: `Skipped: salary expectation ≈ $${rounded}/mo${detail} is below $${MIN_SALARY_MONTHLY_USD}/mo.`,
    };
  }
  return { ok: true };
}

/**
 * Soft alert when a posting requires in-office presence.
 * Does not block generation — callers should surface the message as a warning.
 */
export function workplaceAlert(job: JobSpec): string | null {
  const workplace = job.workplaceType;
  if (workplace === "onsite" || workplace === "hybrid") {
    const label = workplace === "onsite" ? "on-site" : "hybrid";
    return `Job requires ${label} work.`;
  }
  return null;
}
