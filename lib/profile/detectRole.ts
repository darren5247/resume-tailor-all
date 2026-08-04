import type { JobSpec } from "../llm/schemas";
import {
  TARGET_ROLES,
  type Profile,
  type TargetRole,
  enabledBaseRoles,
} from "./schema";

/** Keyword signals scored against the job title + JD text. Higher weight = stronger match. */
const ROLE_SIGNALS: Record<Exclude<TargetRole, "Base">, { patterns: RegExp[]; weight: number }[]> = {
  "Data Engineer": [
    { patterns: [/\bdata\s*engineer(?:ing)?\b/i, /\bETL\b/, /\bELT\b/], weight: 5 },
    { patterns: [/\bdata\s*pipeline/i, /\bSpark\b/i, /\bAirflow\b/i, /\bdbt\b/i], weight: 2 },
    { patterns: [/\bKafka\b/i, /\bSnowflake\b/i, /\bRedshift\b/i, /\bBigQuery\b/i, /\bDatabricks\b/i], weight: 1 },
  ],
  "Data Analyst": [
    { patterns: [/\bdata\s*analyst\b/i, /\bbusiness\s*analyst\b/i, /\bBI\s*analyst\b/i], weight: 5 },
    { patterns: [/\bTableau\b/i, /\bPower\s*BI\b/i, /\bLooker\b/i, /\bdashboard/i], weight: 2 },
    { patterns: [/\bSQL\b/, /\breporting\b/i, /\bexcel\b/i, /\bstakeholder/i], weight: 1 },
  ],
  "Data Scientist": [
    { patterns: [/\bdata\s*scientist\b/i, /\bdata\s*science\b/i], weight: 5 },
    { patterns: [/\bmachine\s*learning\b/i, /\bstatistical\b/i, /\bmodeling\b/i, /\bforecast/i], weight: 2 },
    { patterns: [/\bscikit[\s-]?learn\b/i, /\bpandas\b/i, /\bexperiment\b/i, /\bA\/B\b/i], weight: 1 },
  ],
  "AI Engineer": [
    { patterns: [/\bAI\s*engineer\b/i, /\bML\s*engineer\b/i, /\bmachine\s*learning\s*engineer\b/i], weight: 5 },
    { patterns: [/\bLLM\b/, /\bGen(?:erative)?\s*AI\b/i, /\bRAG\b/, /\bprompt\s*engineer/i], weight: 3 },
    { patterns: [/\bPyTorch\b/i, /\bTensorFlow\b/i, /\bLangChain\b/i, /\binference\b/i, /\bNLP\b/], weight: 1 },
  ],
};

/**
 * Pick the best matching enabled base-resume role for this job description.
 * Returns null when the market has no base tracks (e.g. Colombia) or no
 * enabled role matches strongly enough.
 */
export function detectTargetRole(profile: Profile, job: JobSpec): TargetRole | null {
  const candidates = enabledBaseRoles(profile);
  if (candidates.length === 0) return null;

  const title = job.title || "";
  const body = [
    job.summary,
    ...job.responsibilities,
    ...job.mustHave,
    ...job.niceToHave,
    ...job.keywords,
    ...job.tech,
  ].join("\n");

  let best: TargetRole | null = null;
  let bestScore = 0;

  for (const role of candidates) {
    if (role === "Base") continue;
    const score = scoreRole(role, title, body);
    if (score > bestScore) {
      bestScore = score;
      best = role;
    }
  }

  // Require at least one strong signal (title-level or equivalent weight).
  if (bestScore < 3) return null;
  return best;
}

function scoreRole(role: Exclude<TargetRole, "Base">, title: string, body: string): number {
  let score = 0;
  for (const signal of ROLE_SIGNALS[role]) {
    for (const pattern of signal.patterns) {
      if (pattern.test(title)) score += signal.weight * 2;
      else if (pattern.test(body)) score += signal.weight;
    }
  }
  return score;
}

/** All known roles — useful for UI iteration without importing the const alone. */
export { TARGET_ROLES };
