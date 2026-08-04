import { z } from "zod";

const str = z.string().trim();

export const WORKING_METHODS = ["onsite", "hybrid", "remote"] as const;
export type WorkingMethod = (typeof WORKING_METHODS)[number];

export const WorkingMethodSchema = z.enum(WORKING_METHODS).or(z.literal("")).default("");

export const ExperienceSchema = z.object({
  id: str.min(1),
  company: str.default(""),
  /** Optional — leave blank when the title should come from the tailored draft. */
  role: str.default(""),
  location: str.default(""),
  /** Free-form as typed, e.g. "01/2020 - Present". Rendered verbatim. */
  period: str.default(""),
  /** How the role was performed: onsite, hybrid, or remote. */
  workingMethod: WorkingMethodSchema,
  /** What you actually did, in your words. The model rewrites this per job description. */
  description: str.default(""),
  /** Optional pre-written achievements the model may draw from. */
  highlights: z.array(str).default([]),
});

/** Combine city/region with working method for resume display lines. */
export function formatExperienceLocation(location: string, workingMethod: string): string {
  const place = location.trim();
  const method =
    workingMethod === "onsite" ? "On-site" : workingMethod === "hybrid" ? "Hybrid" : workingMethod === "remote" ? "Remote" : "";
  if (!method) return place;
  if (!place) return method;
  if (new RegExp(method.replace("-", "[-\\s]?"), "i").test(place)) return place;
  return `${place} · ${method}`;
}

export const EducationSchema = z.object({
  id: str.min(1),
  degree: str.default(""),
  school: str.default(""),
  location: str.default(""),
  period: str.default(""),
  gpa: str.default(""),
});

export const SkillGroupSchema = z.object({
  id: str.min(1),
  label: str.default(""),
  items: z.array(str).default([]),
});

export const LanguageSchema = z.object({
  id: str.min(1),
  name: str.default(""),
  level: str.default(""),
});

export const CertificationSchema = z.object({
  id: str.min(1),
  name: str.default(""),
  issuer: str.default(""),
  date: str.default(""),
  url: str.default(""),
});

export const ProjectSchema = z.object({
  id: str.min(1),
  name: str.default(""),
  description: str.default(""),
  tech: z.array(str).default([]),
  link: str.default(""),
});

/** Market the profile is targeting — drives which base-resume role tracks appear. */
export const PROFILE_COUNTRIES = ["US", "Colombia"] as const;
export type ProfileCountry = (typeof PROFILE_COUNTRIES)[number];

export const PROFILE_COUNTRY_LABELS: Record<ProfileCountry, string> = {
  US: "United States",
  Colombia: "Colombia",
};

/** US market: data / AI tracks. */
export const US_TARGET_ROLES = ["Data Engineer", "Data Analyst", "Data Scientist", "AI Engineer"] as const;

/**
 * Legacy Colombia shared-base key (kept in stored profiles / schema).
 * Colombia no longer uses base resumes — prefer Experience + resume prompt.
 */
export const COLOMBIA_BASE_ROLE = "Base" as const;

/** All role keys that can appear in `baseResumes` (union of every country). */
export const TARGET_ROLES = [
  "Data Engineer",
  "Data Analyst",
  "Data Scientist",
  "AI Engineer",
  "Base",
] as const;
export type TargetRole = (typeof TARGET_ROLES)[number];

/** Colombia market: no base-resume tracks. */
export const COLOMBIA_TARGET_ROLES = [] as const satisfies readonly TargetRole[];

export function targetRolesForCountry(country: ProfileCountry): readonly TargetRole[] {
  return country === "Colombia" ? COLOMBIA_TARGET_ROLES : US_TARGET_ROLES;
}

/** Infer country from a free-form location string (migration / import). */
export function inferCountryFromLocation(location: string): ProfileCountry {
  if (/colombia|bogot[aá]|medell[ií]n|cali|valledupar|barranquilla|cartagena/i.test(location)) {
    return "Colombia";
  }
  return "US";
}

export const BaseResumeEntrySchema = z.object({
  enabled: z.boolean().default(false),
  /** Free-form style/structure sample used when this role is detected (not content source). */
  content: str.default(""),
});

const emptyBaseEntry = (): { enabled: boolean; content: string } => ({ enabled: false, content: "" });

const emptyBaseResumes = (): Record<TargetRole, { enabled: boolean; content: string }> => {
  const entries = {} as Record<TargetRole, { enabled: boolean; content: string }>;
  for (const role of TARGET_ROLES) entries[role] = emptyBaseEntry();
  return entries;
};

export const BaseResumesSchema = z
  .object({
    "Data Engineer": BaseResumeEntrySchema.default(emptyBaseEntry),
    "Data Analyst": BaseResumeEntrySchema.default(emptyBaseEntry),
    "Data Scientist": BaseResumeEntrySchema.default(emptyBaseEntry),
    "AI Engineer": BaseResumeEntrySchema.default(emptyBaseEntry),
    Base: BaseResumeEntrySchema.default(emptyBaseEntry),
  })
  .default(emptyBaseResumes);
export const ProfileSchema = z.object({
  fullName: str.default(""),
  /** Blank means: let each job description drive the headline wording. */
  headline: str.default(""),
  email: str.default(""),
  phone: str.default(""),
  location: str.default(""),
  /**
   * Target market. US profiles use per-role base resume tracks;
   * Colombia profiles tailor from Experience and resume prompt only.
   */
  country: z.enum(PROFILE_COUNTRIES).default("US"),
  linkedin: str.default(""),
  website: str.default(""),
  github: str.default(""),
  yearsExperience: z.number().min(0).max(70).default(0),
  summary: str.default(""),
  /**
   * Optional per-profile instructions for resume generation.
   * US: style guidance subordinate to absolute ATS/fact rules.
   * Colombia: sole instruction set for generation (required).
   */
  resumePrompt: str.default(""),
  /**
   * Bullet counts for the three most recent companies (newest first).
   * Roles beyond the 3rd use the third value.
   */
  bulletsPerCompany: z
    .tuple([
      z.number().int().min(1).max(20),
      z.number().int().min(1).max(20),
      z.number().int().min(1).max(20),
    ])
    .default([5, 4, 3]),
  /**
   * Per-role base resumes. When a job matches an enabled role for this
   * profile's country, that role's content supplies style, structure, and
   * sentence pattern. The TARGET JOB drives tailored content.
   */
  baseResumes: BaseResumesSchema,
  experience: z.array(ExperienceSchema).default([]),
  education: z.array(EducationSchema).default([]),
  skills: z.array(SkillGroupSchema).default([]),
  languages: z.array(LanguageSchema).default([]),
  certifications: z.array(CertificationSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type SkillGroup = z.infer<typeof SkillGroupSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type Certification = z.infer<typeof CertificationSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type BaseResumeEntry = z.infer<typeof BaseResumeEntrySchema>;
export type BaseResumes = z.infer<typeof BaseResumesSchema>;

export function emptyProfile(country: ProfileCountry = "US"): Profile {
  return ProfileSchema.parse({ country });
}

/** Enabled roles (for this profile's country) that have non-empty base resume content. */
export function enabledBaseRoles(profile: Profile): TargetRole[] {
  return targetRolesForCountry(profile.country).filter((role) => {
    const entry = profile.baseResumes[role];
    return entry.enabled && entry.content.trim().length > 0;
  });
}

/** Base resume text for a role, or empty if disabled / blank. */
export function baseResumeForRole(profile: Profile, role: TargetRole | null): string {
  if (!role) return "";
  const entry = profile.baseResumes[role];
  if (!entry?.enabled) return "";
  return entry.content.trim();
}

export function firstName(profile: Profile): string {
  return profile.fullName.trim().split(/\s+/)[0] || "Candidate";
}

/**
 * Parse labeled skill groups from a base-resume TECHNICAL SKILLS block.
 * Lines look like: "- Programming: Python, SQL, Scala" or "• Analytics & BI: SQL, Tableau".
 */
export function skillGroupsFromBaseResume(content: string): { label: string; items: string[] }[] {
  const match = content.match(
    /(?:^|\n)\s*(?:TECHNICAL\s+)?SKILLS?\s*\n([\s\S]*?)(?=\n\s*(?:PROFESSIONAL\s+EXPERIENCE|WORK\s+EXPERIENCE|EXPERIENCE|EDUCATION|CERTIFICATIONS?|PROJECTS?|LANGUAGES?)\b|$)/i,
  );
  if (!match) return [];

  const groups: { label: string; items: string[] }[] = [];
  for (const raw of match[1].split(/\n/)) {
    const line = raw.replace(/^[\s•\-\*∙·]+/, "").trim();
    if (!line) continue;

    const colon = line.indexOf(":");
    if (colon > 0 && colon < 80) {
      const label = line.slice(0, colon).trim();
      const items = splitSkillItems(line.slice(colon + 1));
      if (items.length > 0) groups.push({ label, items });
      continue;
    }

    const items = splitSkillItems(line);
    if (items.length > 0) groups.push({ label: "Skills", items });
  }
  return groups;
}

function splitSkillItems(value: string): string[] {
  return value
    .split(/,|;|\|/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Skill groups for rendering when the model returns none: structured profile
 * skills first, otherwise the matched role's base-resume skills section.
 */
export function fallbackSkillGroups(
  profile: Profile,
  role?: TargetRole | null,
): { label: string; items: string[] }[] {
  const fromProfile = profile.skills
    .filter((group) => group.items.some((item) => item.trim()))
    .map((group) => ({
      label: group.label.trim() || "Skills",
      items: group.items.map((item) => item.trim()).filter(Boolean),
    }));
  if (fromProfile.length > 0) return fromProfile;

  // Colombia never falls back to base-resume skill dumps.
  if (profile.country === "Colombia") return [];

  const preferred = baseResumeForRole(profile, role ?? null);
  if (preferred) {
    const groups = skillGroupsFromBaseResume(preferred);
    if (groups.length > 0) return groups;
  }

  for (const track of targetRolesForCountry(profile.country)) {
    const content = baseResumeForRole(profile, track);
    if (!content) continue;
    const groups = skillGroupsFromBaseResume(content);
    if (groups.length > 0) return groups;
  }
  return [];
}

/**
 * Parse "Technology environment: a, b, c" lines from experience descriptions.
 * Colombia profiles keep owned tools here instead of embedding them in highlights.
 */
export function technologyEnvironmentPool(profile: Profile): string[] {
  const pool = new Set<string>();
  for (const experience of profile.experience) {
    const match = experience.description.match(/Technology environment:\s*([^\n.]+)/i);
    if (!match) continue;
    for (const item of splitSkillItems(match[1])) pool.add(item);
  }
  return [...pool];
}

/**
 * Every skill the profile knows about, flattened for validation and prompting.
 * Includes structured skills, project tech, Technology environment lines, and
 * TECHNICAL SKILLS from base resumes. When `role` is set, prefer that role's
 * base resume (still includes profile skills).
 */
export function skillPool(profile: Profile, role?: TargetRole | null): string[] {
  const pool = new Set<string>();
  for (const group of profile.skills) {
    for (const item of group.items) if (item.trim()) pool.add(item.trim());
  }
  for (const project of profile.projects) {
    for (const tech of project.tech) if (tech.trim()) pool.add(tech.trim());
  }
  for (const item of technologyEnvironmentPool(profile)) pool.add(item);

  const addFromContent = (content: string) => {
    for (const group of skillGroupsFromBaseResume(content)) {
      for (const item of group.items) pool.add(item);
    }
  };

  // Colombia: Experience + resume prompt only — never seed the pool from base resumes.
  if (profile.country !== "Colombia") {
    const preferred = role ? baseResumeForRole(profile, role) : "";
    if (preferred) {
      addFromContent(preferred);
    } else {
      for (const track of targetRolesForCountry(profile.country)) {
        const content = baseResumeForRole(profile, track);
        if (content) addFromContent(content);
      }
    }
  }

  return [...pool];
}

/** Prose blob of everything the profile asserts, used for loose fact checks. */
export function profileCorpus(profile: Profile): string {
  const parts: string[] = [profile.summary, profile.headline];
  if (profile.yearsExperience > 0) parts.push(String(profile.yearsExperience));
  for (const experience of profile.experience) {
    parts.push(
      experience.company,
      experience.role,
      experience.location,
      experience.workingMethod,
      experience.description,
      ...experience.highlights,
    );
  }
  for (const education of profile.education) parts.push(education.degree, education.school);
  for (const project of profile.projects) parts.push(project.name, project.description, ...project.tech);
  for (const certification of profile.certifications) {
    parts.push(certification.name, certification.issuer, certification.url);
  }
  for (const role of targetRolesForCountry(profile.country)) {
    const entry = profile.baseResumes[role];
    if (entry.enabled && entry.content.trim()) parts.push(entry.content);
  }
  parts.push(...skillPool(profile));
  return parts.filter(Boolean).join("\n");
}
