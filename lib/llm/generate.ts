import type { Profile, TargetRole } from "../profile/schema";
import { PROFILE_COUNTRY_LABELS, baseResumeForRole, skillPool } from "../profile/schema";
import type { Settings } from "../settings-schema";
import type { LlmClient } from "./client";
import { CoverLetterSchema, ResumeDraftSchema, type CoverLetter, type JobSpec, type ResumeDraft } from "./schemas";

const RESUME_SYSTEM = `You tailor an existing resume to one specific job description.

Absolute rules (never overridden):
1. Employers, employment dates, schools, degrees, and certifications come only from the candidate profile. You may never add or rename an employer, invent a date range, or add a degree/certification the profile does not list. Map every experience entry to the exact experienceId from the profile and keep the profile's order.
2. Tailor content to the TARGET JOB. Mirror the posting's mustHave, keywords, and tech surface forms in the headline, summary, skills, overviews, bullets, and technologies so an ATS can match them. Prefer the posting's own wording (e.g. "Node.js", "CI/CD") when placing those terms.
3. Never invent facts from a "CANDIDATE RESUME PROMPT" — that block is style and structure only.
4. If a "ROLE BASE RESUME" is provided, use it only for sentence pattern, tone, bullet density, section structure, and writing style. Do not treat it as the content source and do not copy its detail bullets verbatim. The TARGET JOB drives what to emphasize; the base resume drives how it should read.
5. Hard numbers are allowed when they make scale concrete. Never invent unrealistic percentages. Do not claim more years of experience than the profile's yearsExperience.

When a "CANDIDATE RESUME PROMPT" is provided, follow it for tone, emphasis, what to stress or avoid, bullet length and density, uniqueness, breadth vs the JD, skill/section preferences, language, and output structure. Only absolute rules 1–5 stay above it. When no candidate resume prompt is provided, still fill the JSON schema fields from the profile and job — do not invent a house style beyond the absolute rules.`;

/**
 * Colombia: the profile resume prompt is the only style/structure instruction set.
 * Profile + job JSON are data inputs. Bullet counts are a hard structural constraint.
 */
const COLOMBIA_RESUME_SYSTEM = `You write a tailored resume as JSON.

The RESUME PROMPT is your complete and only set of writing instructions: how to write, what to emphasize, structure, tone, language, bullet style, skills layout, and how to use the candidate profile and target job. Follow it fully. Do not apply any other house style, ATS rules, market conventions, or default resume-writing policies.

Hard constraint: when BULLET COUNTS are provided, write exactly that many bullets for each company (newest first; roles beyond the 3rd use the third value). This overrides any conflicting bullet-count guidance in the RESUME PROMPT.

Use the candidate profile and target job only as source data the RESUME PROMPT tells you how to use. Map every experience entry to the exact experienceId from the profile and keep the profile's employer order.`;

const COVER_SYSTEM = `You write a short, specific cover letter for one job application.

Rules:
- Three or four paragraphs. Under 300 words total.
- Employers and dates must match the candidate profile. Align evidence to what the posting asks for.
- Paragraph 1: the role and why this candidate fits it in one concrete sentence, not a greeting restatement.
- Middle paragraphs: two or three specific pieces of evidence matched to the posting.
- Final paragraph: a plain, confident close. No "I would be thrilled".
- No cliches: "I am writing to apply", "passionate", "team player", "fast-paced environment".
- greeting must be "Dear Hiring Manager," unless the posting names a person.`;

export async function generateResumeDraft(
  llm: LlmClient,
  profile: Profile,
  job: JobSpec,
  settings: Settings,
  signal?: AbortSignal,
  correction?: string,
  detectedRole?: TargetRole | null,
): Promise<ResumeDraft> {
  if (profile.country === "Colombia") {
    return generateColombiaResumeDraft(llm, profile, job, signal, correction);
  }

  const roleBase = baseResumeForRole(profile, detectedRole ?? null);
  return llm.json({
    schema: ResumeDraftSchema,
    label: "resume",
    temperature: 0.35,
    signal,
    system: RESUME_SYSTEM,
    user: [
      `Write the resume in ${settings.language}.`,
      `Candidate market: ${PROFILE_COUNTRY_LABELS[profile.country]}. Align tone and emphasis with that market when the posting does not override it.`,
      `Bullet counts by company (newest first): 1st company = ${profile.bulletsPerCompany[0]} bullets, 2nd = ${profile.bulletsPerCompany[1]} bullets, 3rd and older = ${profile.bulletsPerCompany[2]} bullets each.`,
      profile.headline ? `The candidate fixes their headline as "${profile.headline}"; keep it.` : "",
      detectedRole
        ? detectedRole === "Base"
          ? "A base resume is available for style and structure only — tailor content to the TARGET JOB."
          : `Detected target role track: ${detectedRole}. Use that track's base resume for style/structure only; tailor content to the TARGET JOB.`
        : "",
      profile.resumePrompt.trim()
        ? `\n--- CANDIDATE RESUME PROMPT (REQUIRED — follow these instructions for tone, structure, bullet style, emphasis and uniqueness; never invent employers or dates from this block) ---\n${profile.resumePrompt.trim()}\n--- END CANDIDATE RESUME PROMPT ---`
        : "",
      roleBase
        ? `\n--- ROLE BASE RESUME${detectedRole && detectedRole !== "Base" ? ` (${detectedRole})` : ""} — STYLE / STRUCTURE / SENTENCE PATTERN ONLY; do not copy detail content; tailor to TARGET JOB; keep profile employers and dates ---\n${roleBase}`
        : "",
      correction ? `\nFIX REQUIRED FROM THE PREVIOUS ATTEMPT:\n${correction}` : "",
      `\n--- CANDIDATE PROFILE ---\n${JSON.stringify(profileForPrompt(profile), null, 2)}`,
      skillPoolPrompt(profile, detectedRole ?? null, job),
      `\n--- TARGET JOB ---\n${JSON.stringify(job, null, 2)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

async function generateColombiaResumeDraft(
  llm: LlmClient,
  profile: Profile,
  job: JobSpec,
  signal?: AbortSignal,
  correction?: string,
): Promise<ResumeDraft> {
  const prompt = profile.resumePrompt.trim();
  if (!prompt) {
    throw new Error("Colombia profiles need a Resume prompt on the Profile tab.");
  }

  return llm.json({
    schema: ResumeDraftSchema,
    label: "resume",
    temperature: 0.35,
    signal,
    system: COLOMBIA_RESUME_SYSTEM,
    user: [
      `\n--- RESUME PROMPT (sole writing instructions — follow completely) ---\n${prompt}\n--- END RESUME PROMPT ---`,
      `BULLET COUNTS by company (newest first, hard constraint): 1st company = ${profile.bulletsPerCompany[0]} bullets, 2nd = ${profile.bulletsPerCompany[1]} bullets, 3rd and older = ${profile.bulletsPerCompany[2]} bullets each.`,
      correction ? `\n--- CORRECTION (still obey the RESUME PROMPT; fix only what is listed) ---\n${correction}` : "",
      `\n--- CANDIDATE PROFILE (source data) ---\n${JSON.stringify(profileForPrompt(profile), null, 2)}`,
      `\n--- TARGET JOB (source data) ---\n${JSON.stringify(job, null, 2)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

function skillPoolPrompt(profile: Profile, role: TargetRole | null, job: JobSpec): string {
  const pool = skillPool(profile, role);
  const jdTerms = [...job.mustHave, ...job.niceToHave, ...job.keywords, ...job.tech]
    .map((term) => term.trim())
    .filter(Boolean);
  const jdBlock =
    jdTerms.length > 0
      ? `\n--- JD TERMS TO MIRROR FOR ATS (use these surface forms in skills, technologies, summary and bullets when relevant) ---\n${[...new Set(jdTerms)].join(", ")}`
      : "";

  if (pool.length > 0) {
    return `${jdBlock}\n--- REFERENCE SKILL POOL (optional inventory from the profile/base; prefer overlap with JD TERMS) ---\n${pool.join(", ")}`;
  }
  return `${jdBlock}\n--- SKILL POOL ---\nNo structured skills list is on the profile. Build skillGroups from the JD TERMS above plus tools you name in the experience bullets.`;
}

export async function generateCoverLetter(
  llm: LlmClient,
  profile: Profile,
  job: JobSpec,
  draft: ResumeDraft,
  settings: Settings,
  signal?: AbortSignal,
): Promise<CoverLetter> {
  return llm.json({
    schema: CoverLetterSchema,
    label: "cover letter",
    temperature: 0.4,
    signal,
    system: COVER_SYSTEM,
    user: [
      `Write the letter in ${settings.language}.`,
      `Candidate: ${profile.fullName}. Applying to ${job.title || "the role"} at ${job.company || "the company"}.`,
      `\n--- CANDIDATE PROFILE ---\n${JSON.stringify(profileForPrompt(profile), null, 2)}`,
      `\n--- TAILORED RESUME POINTS ---\n${JSON.stringify(draft, null, 2)}`,
      `\n--- TARGET JOB ---\n${JSON.stringify(job, null, 2)}`,
    ].join("\n"),
  });
}

/** Trim contact details out of the prompt; the model never needs them. */
function profileForPrompt(profile: Profile) {
  return {
    yearsExperience: profile.yearsExperience,
    summary: profile.summary,
    experience: profile.experience.map((entry) => ({
      experienceId: entry.id,
      company: entry.company,
      role: entry.role,
      period: entry.period,
      location: entry.location,
      workingMethod: entry.workingMethod || undefined,
      description: entry.description,
      highlights: entry.highlights,
    })),
    education: profile.education.map((entry) => ({ degree: entry.degree, school: entry.school })),
    certifications: profile.certifications.map((entry) => ({ name: entry.name, issuer: entry.issuer })),
    projects: profile.projects.map((entry) => ({
      projectId: entry.id,
      name: entry.name,
      description: entry.description,
      tech: entry.tech,
    })),
    languages: profile.languages.map((entry) => ({ name: entry.name, level: entry.level })),
  };
}
