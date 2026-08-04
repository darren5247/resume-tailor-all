import type { Profile, TargetRole } from "../profile/schema";
import {
  fallbackSkillGroups,
  formatExperienceLocation,
  profileCorpus,
  skillPool,
} from "../profile/schema";
import { containsTerm, normalize } from "./validate";
import type { JobSpec, ResumeDraft, ResumeDoc } from "./schemas";

/**
 * Merge model prose with profile facts. Company, dates, education and
 * certifications are read straight from the profile, never from the draft, so a
 * hallucinated employer cannot reach the document. Skills/tech may mirror the JD
 * for ATS. Role title uses the profile when set, otherwise the draft.
 *
 * Colombia: prose, skills, and technologies come from the draft as the resume
 * prompt directed — no JD injection, skill rewriting, or inventory fallbacks.
 */
export function assembleResume(
  profile: Profile,
  job: JobSpec,
  draft: ResumeDraft,
  detectedRole?: TargetRole | null,
): ResumeDoc {
  const colombia = profile.country === "Colombia";
  const draftById = new Map(draft.experience.map((entry) => [entry.experienceId, entry]));
  const pool = skillPool(profile, detectedRole ?? null);
  const poolNormalized = new Set(pool.map(normalize));
  const corpus = normalize(profileCorpus(profile));
  const jobHaystack = normalize(
    [...job.mustHave, ...job.niceToHave, ...job.keywords, ...job.tech].filter(Boolean).join("\n"),
  );
  const draftEvidence = normalize(
    [draft.summary, ...draft.experience.flatMap((entry) => [entry.overview, ...entry.bullets])]
      .filter(Boolean)
      .join("\n"),
  );
  // No inventory on the profile → keep model skillGroups (still required for ATS resumes).
  const poolEmpty = pool.length === 0;

  const allowItem = (item: string, roleEvidence?: string) => {
    if (!item) return false;
    // JD-first: posting terms are always allowed for ATS mirroring.
    if (jobHaystack && containsTerm(jobHaystack, item)) return true;
    if (poolEmpty) return true;
    return (
      poolNormalized.has(normalize(item)) ||
      containsTerm(corpus, item) ||
      containsTerm(draftEvidence, item) ||
      (roleEvidence ? containsTerm(roleEvidence, item) : false)
    );
  };

  const experience = profile.experience.map((entry) => {
    const drafted = draftById.get(entry.id);
    const overview = (drafted?.overview?.trim() || entry.description.trim()).replace(/\s+/g, " ");
    const bullets = (drafted?.bullets ?? entry.highlights)
      .map((bullet) => bullet.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    const roleEvidence = normalize([overview, ...bullets].filter(Boolean).join("\n"));
    const rawTech = (drafted?.technologies ?? []).map((item) => item.trim()).filter(Boolean);
    const technologies = [
      ...new Set(colombia ? rawTech : rawTech.filter((item) => allowItem(item, roleEvidence))),
    ];
    return {
      company: entry.company,
      role: entry.role.trim() || drafted?.role?.trim() || "",
      location: formatExperienceLocation(entry.location, entry.workingMethod),
      period: entry.period,
      overview,
      bullets,
      technologies,
    };
  });

  const skills = draft.skillGroups
    .map((group) => ({
      label: group.label.trim() || "Skills",
      items: group.items
        .map((item) => item.trim())
        .filter((item) => (colombia ? Boolean(item) : allowItem(item))),
    }))
    .filter((group) => group.items.length > 0);

  const selected = new Set(draft.selectedProjectIds);
  const projects = profile.projects
    .filter((project) => selected.size === 0 || selected.has(project.id))
    .map((project) => ({
      name: project.name,
      description: project.description,
      tech: project.tech,
      link: project.link,
    }));

  const fromFallback = fallbackSkillGroups(profile, detectedRole ?? null);
  const resolvedSkills = colombia
    ? skills
    : skills.length > 0
      ? mergeJobTermsIntoSkills(skills, job)
      : fromFallback.length > 0
        ? mergeJobTermsIntoSkills(fromFallback, job)
        : skillsFromJobEvidence(job, draft, profile);

  return {
    name: profile.fullName,
    headline: colombia
      ? draft.headline.trim() || profile.headline.trim() || job.title
      : profile.headline.trim() || draft.headline.trim() || job.title,
    contactLine: [profile.location, profile.phone, profile.email, profile.linkedin, profile.website, profile.github]
      .map((part) => part.trim())
      .filter(Boolean),
    summary: draft.summary.trim() || profile.summary,
    experience,
    skills: resolvedSkills,
    education: profile.education.map((entry) => ({
      degree: entry.degree,
      school: entry.school,
      location: entry.location,
      period: entry.period,
      gpa: entry.gpa,
    })),
    certifications: profile.certifications.map((entry) => ({
      name: entry.name,
      issuer: entry.issuer,
      date: entry.date,
      url: entry.url,
    })),
    languages: profile.languages.map((entry) => ({ name: entry.name, level: entry.level })),
    projects,
  };
}

/**
 * Ensure high-signal JD tech/mustHave terms appear in the skills section even when
 * the draft omitted a few — boosts must-have ATS coverage without inventing employers.
 */
function mergeJobTermsIntoSkills(
  groups: { label: string; items: string[] }[],
  job: JobSpec,
): { label: string; items: string[] }[] {
  const existing = normalize(groups.flatMap((group) => group.items).join("\n"));
  const extras: string[] = [];
  const seen = new Set(groups.flatMap((group) => group.items.map((item) => normalize(item))));

  for (const raw of [...job.tech, ...job.mustHave, ...job.keywords]) {
    const item = raw.trim();
    if (!item || item.length < 2 || item.length > 48) continue;
    // Skip soft multi-word phrases that read as responsibilities, not skills.
    if (/\s/.test(item) && item.split(/\s+/).length > 3) continue;
    const key = normalize(item);
    if (!key || seen.has(key) || containsTerm(existing, item)) continue;
    seen.add(key);
    extras.push(item);
    if (extras.length >= 12) break;
  }

  if (extras.length === 0) return groups;

  const next = groups.map((group) => ({ ...group, items: [...group.items] }));
  const target = next[0] ?? { label: "Core Skills", items: [] as string[] };
  if (!next[0]) next.unshift(target);
  target.items = [...target.items, ...extras];
  return next;
}

/**
 * Last-resort skills section: job tech/keywords that also appear in the draft
 * or profile, plus any certification product names (e.g. AWS).
 */
function skillsFromJobEvidence(
  job: JobSpec,
  draft: ResumeDraft,
  profile: Profile,
): { label: string; items: string[] }[] {
  const evidence = normalize(
    [
      draft.summary,
      ...draft.experience.flatMap((entry) => entry.bullets),
      profileCorpus(profile),
      ...profile.certifications.map((entry) => `${entry.name} ${entry.issuer}`),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of [...job.tech, ...job.keywords, ...job.mustHave]) {
    const item = raw.trim();
    if (!item || item.length < 2) continue;
    const key = normalize(item);
    if (seen.has(key)) continue;
    // Prefer terms grounded in draft/profile; still accept pure JD tech for ATS when sparse.
    if (!containsTerm(evidence, item) && items.length >= 8) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= 28) break;
  }

  // Cert-derived tokens when the draft is sparse (e.g. "AWS" from an AWS cert).
  if (items.length < 6) {
    for (const cert of profile.certifications) {
      for (const token of cert.name.split(/[\s–—/,|]+/)) {
        const item = token.trim();
        if (item.length < 3 || /^(certified|associate|professional|fundamentals|specialization)$/i.test(item)) {
          continue;
        }
        const key = normalize(item);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
      }
    }
  }

  if (items.length === 0) return [];
  return [{ label: "Core Skills", items }];
}

/** Flat text of the finished resume, used for keyword scoring. */
export function resumeToText(resume: ResumeDoc): string {
  return [
    resume.name,
    resume.headline,
    resume.contactLine.join(" "),
    resume.summary,
    ...resume.experience.flatMap((entry) => [
      entry.role,
      entry.company,
      entry.period,
      entry.overview,
      ...entry.bullets,
      ...entry.technologies,
    ]),
    ...resume.skills.flatMap((group) => [group.label, ...group.items]),
    ...resume.education.map((entry) => `${entry.degree} ${entry.school}`),
    ...resume.certifications.map((entry) => `${entry.name} ${entry.issuer} ${entry.url}`),
    ...resume.languages.map((entry) => `${entry.name} ${entry.level}`),
    ...resume.projects.flatMap((project) => [project.name, project.description, ...project.tech]),
  ]
    .filter(Boolean)
    .join("\n");
}
