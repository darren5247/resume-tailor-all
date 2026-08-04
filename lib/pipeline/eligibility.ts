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
 * Colombia candidates only apply to fully remote roles that do not require
 * living in another specific country. Returns a user-facing failure reason.
 */
export function checkColombiaJobEligibility(job: JobSpec): EligibilityResult {
  const workplace = job.workplaceType;
  if (workplace === "onsite" || workplace === "hybrid") {
    const label = workplace === "onsite" ? "on-site" : "hybrid";
    return {
      ok: false,
      reason: `Skipped: job requires ${label} work (only fully remote roles are eligible for Colombia profiles).`,
    };
  }

  const required = job.requiredBaseCountries.map((entry) => entry.trim()).filter(Boolean);
  if (required.length === 0) return { ok: true };

  if (required.some(allowsColombiaCandidate)) return { ok: true };

  const listed = required.join(", ");
  return {
    ok: false,
    reason: `Skipped: job requires candidates based in ${listed} (Colombia-based candidates are not eligible).`,
  };
}

/** True when a required country/region includes or is compatible with Colombia. */
function allowsColombiaCandidate(label: string): boolean {
  const text = label.trim().toLowerCase();
  if (!text) return false;

  if (
    /world\s*wide|anywhere|any\s*country|global|no\s*restriction|unrestricted|international\s*remote/.test(
      text,
    )
  ) {
    return true;
  }

  // Colombia and common city/demonym forms.
  if (/colomb|bogot|medell[ií]n|cali\b|barranquilla|cartagena|valledupar/.test(text)) {
    return true;
  }
  if (/^co$/.test(text)) return true;

  // Regions that include Colombia.
  if (
    /\blatam\b|latin\s*america|south\s*america|central\s*america|americas\b|iberoamerica|ibero-america/.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}
