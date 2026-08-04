import { z } from "zod";

/** Structured job description, the output of the Extract step. */
export const JobSpecSchema = z.object({
  title: z.string().default(""),
  company: z.string().default(""),
  location: z.string().default(""),
  seniority: z.string().default(""),
  employmentType: z.string().default(""),
  summary: z.string().default(""),
  responsibilities: z.array(z.string()).default([]),
  mustHave: z.array(z.string()).default([]),
  niceToHave: z.array(z.string()).default([]),
  /** Exact surface forms an ATS would match on, e.g. "Kubernetes", "CI/CD". */
  keywords: z.array(z.string()).default([]),
  tech: z.array(z.string()).default([]),
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
