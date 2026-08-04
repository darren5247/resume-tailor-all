import { profileCorpus, type Profile } from "../profile/schema";
import type { JobSpec, ResumeDraft } from "./schemas";

export interface ValidationReport {
  /** Must be fixed: these are fabrications, and they get one repair round-trip. */
  violations: string[];
  /** Worth knowing, not worth another API call. */
  warnings: string[];
}

/**
 * Deterministic fact check for structural inventions only.
 * JD keyword/tech mirroring is intentional for ATS tailoring and is not penalized.
 * Employers and dates are still locked at assemble time from the profile.
 */
export function validateDraft(profile: Profile, job: JobSpec, draft: ResumeDraft): ValidationReport {
  const violations: string[] = [];
  const warnings: string[] = [];

  const knownIds = new Set(profile.experience.map((entry) => entry.id));
  for (const entry of draft.experience) {
    if (!knownIds.has(entry.experienceId)) {
      violations.push(`Experience "${entry.experienceId}" is not in your profile.`);
    }
  }
  const draftIds = new Set(draft.experience.map((entry) => entry.experienceId));
  for (const id of knownIds) {
    if (!draftIds.has(id)) {
      const role = profile.experience.find((entry) => entry.id === id);
      warnings.push(`No bullets were written for ${role?.company || id}.`);
    }
  }

  const prose = [
    draft.headline,
    draft.summary,
    ...draft.experience.flatMap((entry) => [
      entry.role,
      entry.overview,
      ...entry.bullets,
      ...entry.technologies,
    ]),
  ];
  const corpus = normalize(profileCorpus(profile));

  // Percentages must appear in the profile/base; other scale numbers are allowed for JD-first tailoring.
  for (const number of unsupportedPercentages(prose, corpus)) {
    violations.push(`Uses the percentage "${number}", which does not appear anywhere in your profile.`);
  }

  const claimedYears = maxClaimedYears(prose);
  if (profile.yearsExperience > 0 && claimedYears > profile.yearsExperience) {
    violations.push(
      `Claims ${claimedYears} years of experience; your profile says ${profile.yearsExperience}.`,
    );
  }

  for (const entry of draft.experience) {
    if (!entry.overview.trim()) {
      warnings.push(`No overview written for experience "${entry.experienceId}".`);
    } else if (/\b(I|my|me)\b/.test(entry.overview)) {
      warnings.push(`Overview uses a pronoun: "${truncate(entry.overview)}"`);
    }
    if (entry.bullets.length > 0 && entry.technologies.length === 0) {
      warnings.push(`No technologies listed for experience "${entry.experienceId}".`);
    }
  }

  for (const bullet of draft.experience.flatMap((entry) => entry.bullets)) {
    if (/\b(I|my|me)\b/.test(bullet)) warnings.push(`Bullet uses a pronoun: "${truncate(bullet)}"`);
    if (bullet.split(/\s+/).length > 45) warnings.push(`Bullet runs long: "${truncate(bullet)}"`);
  }

  if (job.company && prose.some((line) => normalize(line).includes(normalize(job.company)))) {
    warnings.push(`"${job.company}" appears in your history section; check it reads as a target, not an employer.`);
  }

  const mustCoverage = [...job.mustHave, ...job.keywords].filter((term) => term.trim().length >= 2);
  if (mustCoverage.length > 0) {
    const haystack = normalize(prose.filter(Boolean).join("\n"));
    const missing = mustCoverage.filter((term) => !containsTerm(haystack, term)).slice(0, 8);
    if (missing.length > 0) {
      warnings.push(`ATS gap — consider weaving in: ${missing.join(", ")}`);
    }
  }

  return { violations: dedupe(violations), warnings: dedupe(warnings).slice(0, 20) };
}

/** Turn a report into the correction note fed back to the model. */
export function repairInstruction(report: ValidationReport): string {
  return [
    "Remove or rewrite the following structural issues. Keep JD keyword mirroring for ATS; do not strip mustHave/tech terms just to satisfy this list.",
    ...report.violations.map((violation) => `- ${violation}`),
  ].join("\n");
}

export function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9+#./ ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Term match that tolerates the usual surface drift, so "Postgres" in a profile
 * satisfies "PostgreSQL" in a posting without a hand-maintained alias table.
 */
export function containsTerm(normalizedHaystack: string, term: string): boolean {
  const needle = normalize(term);
  if (!needle) return false;
  if (normalizedHaystack.includes(needle)) return true;

  const compactHaystack = normalizedHaystack.replace(/[^a-z0-9]/g, "");
  const compactNeedle = needle.replace(/[^a-z0-9]/g, "");
  if (compactNeedle.length >= 4 && compactHaystack.includes(compactNeedle)) return true;

  // Multi-word terms count when every word of length 3+ is present.
  const words = needle.split(" ").filter((word) => word.length >= 3);
  return words.length > 1 && words.every((word) => normalizedHaystack.includes(word));
}

function unsupportedPercentages(prose: string[], corpus: string): string[] {
  const found = new Set<string>();
  for (const line of prose) {
    for (const match of line.matchAll(/(\d[\d.,]*)\s?%/gi)) {
      const digits = match[1].replace(/[.,]$/, "");
      if (corpus.includes(digits.toLowerCase())) continue;
      found.add(`${digits}%`);
    }
  }
  return [...found].slice(0, 8);
}

function maxClaimedYears(prose: string[]): number {
  let max = 0;
  for (const line of prose) {
    for (const match of line.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs|años|anos)/gi)) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return max;
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

function truncate(text: string, length = 60): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}
