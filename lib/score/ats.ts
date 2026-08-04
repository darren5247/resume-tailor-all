import type { JobSpec, ResumeDoc } from "../llm/schemas";
import { containsTerm, normalize } from "../llm/validate";
import { resumeToText } from "../llm/assemble";
import type { ValidationReport } from "../llm/validate";

export interface AtsScore {
  total: number;
  breakdown: { label: string; earned: number; max: number; detail: string }[];
  matched: string[];
  missing: string[];
}

const WEIGHTS = { mustHave: 50, niceToHave: 20, title: 15, format: 15 };
/** Structural violations only (bad experience ids, invented %, years inflation). */
const VIOLATION_PENALTY = 5;
const MAX_PENALTY = 20;

export function scoreResume(resume: ResumeDoc, job: JobSpec, report: ValidationReport): AtsScore {
  const haystack = normalize(resumeToText(resume));

  const must = coverage(job.mustHave.length ? job.mustHave : job.keywords, haystack);
  const nice = coverage([...job.niceToHave, ...job.tech], haystack);
  const titleScore = scoreTitle(resume, job, haystack);
  const formatScore = scoreFormat(resume);

  const breakdown = [
    {
      label: "Must-have coverage",
      earned: round(must.ratio * WEIGHTS.mustHave),
      max: WEIGHTS.mustHave,
      detail: `${must.matched.length} of ${must.total} required terms present`,
    },
    {
      label: "Nice-to-have coverage",
      earned: round(nice.ratio * WEIGHTS.niceToHave),
      max: WEIGHTS.niceToHave,
      detail: `${nice.matched.length} of ${nice.total} preferred terms present`,
    },
    { label: "Title alignment", earned: titleScore.earned, max: WEIGHTS.title, detail: titleScore.detail },
    { label: "ATS formatting", earned: formatScore.earned, max: WEIGHTS.format, detail: formatScore.detail },
  ];

  const penalty = Math.min(report.violations.length * VIOLATION_PENALTY, MAX_PENALTY);
  if (penalty > 0) {
    breakdown.push({
      label: "Unresolved fact-check issues",
      earned: -penalty,
      max: 0,
      detail: `${report.violations.length} claim(s) the profile does not support`,
    });
  }

  const total = clamp(breakdown.reduce((sum, item) => sum + item.earned, 0), 0, 100);

  // Report against the posting's own keyword list; that is what a recruiter greps for.
  const keywordCoverage = coverage(job.keywords.length ? job.keywords : job.mustHave, haystack);

  return {
    total: Math.round(total),
    breakdown,
    matched: keywordCoverage.matched,
    missing: keywordCoverage.missing,
  };
}

function coverage(terms: string[], haystack: string) {
  const unique = dedupeTerms(terms);
  const matched: string[] = [];
  const missing: string[] = [];

  for (const term of unique) {
    if (containsTerm(haystack, term)) matched.push(term);
    else missing.push(term);
  }

  return {
    matched,
    missing,
    total: unique.length,
    ratio: unique.length === 0 ? 1 : matched.length / unique.length,
  };
}

function scoreTitle(resume: ResumeDoc, job: JobSpec, haystack: string) {
  if (!job.title) return { earned: WEIGHTS.title, detail: "Posting had no title to match" };

  const headline = normalize(resume.headline);
  const titleWords = normalize(job.title)
    .split(" ")
    .filter((word) => word.length > 2 && !["and", "the", "for", "with"].includes(word));
  const hits = titleWords.filter((word) => headline.includes(word)).length;
  const ratio = titleWords.length === 0 ? 1 : hits / titleWords.length;

  let earned = ratio * (WEIGHTS.title - 4);
  const seniorityHit = !job.seniority || haystack.includes(normalize(job.seniority));
  if (seniorityHit) earned += 4;

  return {
    earned: round(earned),
    detail: `Headline matches ${hits}/${titleWords.length} title words${
      job.seniority ? `, seniority "${job.seniority}" ${seniorityHit ? "present" : "absent"}` : ""
    }`,
  };
}

function scoreFormat(resume: ResumeDoc) {
  const notes: string[] = [];
  let earned = 0;

  const contact = resume.contactLine.join(" ");
  if (/@/.test(contact)) earned += 3;
  else notes.push("no email");
  if (/\d{3}/.test(contact)) earned += 2;
  else notes.push("no phone");

  const datedRoles = resume.experience.filter((entry) => /\d{4}|present/i.test(entry.period)).length;
  if (resume.experience.length > 0 && datedRoles === resume.experience.length) earned += 4;
  else notes.push(`${resume.experience.length - datedRoles} role(s) without parseable dates`);

  const bulletCount = resume.experience.reduce((sum, entry) => sum + entry.bullets.length, 0);
  if (bulletCount >= 6 && bulletCount <= 32) earned += 3;
  else notes.push(`${bulletCount} bullets total`);

  const summaryLength = resume.summary.length;
  if (summaryLength >= 180 && summaryLength <= 900) earned += 3;
  else notes.push(`summary is ${summaryLength} characters`);

  return {
    earned,
    detail: notes.length === 0 ? "Single column, dated roles, complete contact block" : notes.join(", "),
  };
}

function dedupeTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (trimmed.length < 2) continue;
    const key = normalize(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
