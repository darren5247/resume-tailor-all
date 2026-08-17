import { z } from "zod";

/**
 * How the role is performed. Prefer "remote" when a fully remote option exists
 * even if hybrid/onsite alternatives are also offered.
 */
export const WorkplaceTypeSchema = z.enum(["remote", "hybrid", "onsite", "unspecified"]).default("unspecified");
export type WorkplaceType = z.infer<typeof WorkplaceTypeSchema>;

/**
 * Who is hiring: the end employer ("direct") vs a recruiter/staffing firm posting
 * for a client ("agency"). "unknown" unless the posting makes it unmistakable —
 * badges are only shown for direct/agency.
 */
export const HiringChannelSchema = z.enum(["direct", "agency", "unknown"]).default("unknown");
export type HiringChannel = z.infer<typeof HiringChannelSchema>;

/** Structured job description, the output of the Extract step. */
export const JobSpecSchema = z.object({
  title: z.string().default(""),
  company: z.string().default(""),
  location: z.string().default(""),
  seniority: z.string().default(""),
  employmentType: z.string().default(""),
  /**
   * remote = fully remote is allowed; hybrid/onsite = in-office presence is required
   * (no fully remote option); unspecified = posting does not say.
   */
  workplaceType: WorkplaceTypeSchema,
  /**
   * direct = employer hiring for itself; agency = recruiter/staffing/search firm
   * posting on behalf of a client; unknown when unclear.
   */
  hiringChannel: HiringChannelSchema,
  /**
   * When hiringChannel is "agency", the end client's brand if the posting names it.
   * Empty for direct hires or when the client is undisclosed.
   */
  clientCompany: z.string().default(""),
  /**
   * True only when the posting identifies the employer (or named agency client)
   * as a startup. False when that is unstated or only a candidate-experience ask.
   */
  isStartup: z.boolean().default(false),
  /**
   * Countries/regions where the candidate must live or be based, when the posting
   * explicitly requires it (e.g. "US only", "must be located in Canada").
   * Empty when unrestricted, worldwide, or unstated. Prefer English country names.
   */
  requiredBaseCountries: z.array(z.string()).default([]),
  summary: z.string().default(""),
  responsibilities: z.array(z.string()).default([]),
  mustHave: z.array(z.string()).default([]),
  niceToHave: z.array(z.string()).default([]),
  /** Exact surface forms an ATS would match on, e.g. "Kubernetes", "CI/CD". */
  keywords: z.array(z.string()).default([]),
  tech: z.array(z.string()).default([]),
  /**
   * Stated pay from the posting in plain language, e.g. "$90k–$110k / year" or
   * "COP 8M / month". Empty when the posting does not mention compensation.
   */
  salaryExpectation: z.string().default(""),
  /**
   * Lowest stated cash figure in the posting's own currency. Null when unstated.
   * Equal to salaryMax when the posting names one number, not a band.
   */
  salaryMin: z.number().nullable().default(null),
  /**
   * Highest stated cash figure in the posting's own currency. Null when pay is
   * unstated. Equal to salaryMin when the posting names one number, not a band.
   */
  salaryMax: z.number().nullable().default(null),
  /**
   * ISO 4217 code for the stated cash figures (USD, EUR, COP, GBP, …).
   * Empty when currency is unstated or only implied by a "$" with no code.
   */
  salaryCurrency: z.string().default(""),
  /**
   * Highest stated figure converted to monthly USD for eligibility gating.
   * Yearly ÷ 12, hourly × 160, weekly × 4.33. Null when pay is unstated or
   * cannot be converted (equity-only, "competitive", etc.).
   */
  salaryMonthlyUsd: z.number().nullable().default(null),
});

export type JobSpec = z.infer<typeof JobSpecSchema>;

/**
 * What the model is allowed to write. Company names, roles, dates, schools and
 * certifications are deliberately absent: those are copied from the profile at
 * render time, which makes inventing an employer structurally impossible.
 */
export const ResumeDraftSchema = z.object({
  headline: z.string().default(""),
  summary: z.string().default(""),
  experience: z
    .array(
      z.object({
        experienceId: z.string(),
        /**
         * Used only when the profile role title is blank. Employers/dates still
         * come from the profile; this fills the job-title line for ATS/layout.
         */
        role: z.string().default(""),
        /**
         * 1–2 sentences under the role line: employer context + core remit.
         * Rendered in italics above the bullets.
         */
        overview: z.string().default(""),
        bullets: z.array(z.string()).default([]),
        /** Tools for this role; rendered as "Technologies used: …" under bullets. */
        technologies: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  skillGroups: z
    .array(
      z.object({
        label: z.string().default(""),
        items: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  selectedProjectIds: z.array(z.string()).default([]),
});

export type ResumeDraft = z.infer<typeof ResumeDraftSchema>;

export const CoverLetterSchema = z.object({
  greeting: z.string().default("Dear Hiring Manager,"),
  paragraphs: z.array(z.string()).min(1),
  closing: z.string().default("Sincerely,"),
});

export type CoverLetter = z.infer<typeof CoverLetterSchema>;

/** Final render-ready resume, assembled from profile facts plus model prose. */
export interface ResumeDoc {
  name: string;
  headline: string;
  contactLine: string[];
  summary: string;
  experience: {
    company: string;
    role: string;
    location: string;
    period: string;
    /** Italic blurb between role line and bullets. */
    overview: string;
    bullets: string[];
    /** Shown as "Technologies used: a, b, c" under bullets. */
    technologies: string[];
  }[];
  skills: { label: string; items: string[] }[];
  education: { degree: string; school: string; location: string; period: string; gpa: string }[];
  certifications: { name: string; issuer: string; date: string; url: string }[];
  languages: { name: string; level: string }[];
  projects: { name: string; description: string; tech: string[]; link: string }[];
}

/**
 * Compact JSON Schema handed to the model alongside the prompt. zod v4 can emit
 * this directly, so the contract and the validator can never drift apart.
 */
export function describeSchema(schema: z.ZodType): string {
  return JSON.stringify(z.toJSONSchema(schema, { io: "input" }));
}
