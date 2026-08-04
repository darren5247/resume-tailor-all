import type { ResumeDoc } from "../llm/schemas";
import { fallbackSkillGroups, formatExperienceLocation, type Profile } from "../profile/schema";

/** Alex Rivera sample used when the active profile is still empty. */
export const SAMPLE_RESUME: ResumeDoc = {
  name: "Alex Rivera",
  headline: "Senior Backend Engineer",
  contactLine: [
    "Austin, TX",
    "alex.rivera@email.com",
    "(512) 555-0142",
    "linkedin.com/in/alexrivera",
  ],
  summary:
    "Senior backend engineer with 8+ years building payment platforms and data services on AWS. Known for turning ambiguous product asks into reliable APIs, clear ownership, and measurable latency wins.",
  experience: [
    {
      company: "Payment Flow",
      role: "Lead Backend Engineer",
      location: "Austin, TX",
      period: "01/2022 – Present",
      overview:
        "Payment Flow builds real-time settlement infrastructure for fintech platforms. Led backend architecture for high-throughput payment APIs and event-driven services.",
      bullets: [
        "Led a team of 6 engineers shipping settlement services that cut end-to-end latency by 35%",
        "Designed event-driven pipelines on Kafka and AWS Lambda processing 2M+ transactions daily",
        "Introduced contract testing and on-call runbooks that dropped P1 incidents by half",
      ],
      technologies: ["Go", "Python", "Kafka", "AWS Lambda", "PostgreSQL"],
    },
    {
      company: "Northwood Payments",
      role: "Backend Engineer",
      location: "Remote",
      period: "03/2019 – 12/2021",
      overview:
        "Northwood Payments operates merchant acquiring software across North America. Owned Django and Go services for onboarding and ledger-adjacent workloads.",
      bullets: [
        "Built Django and Go services powering merchant onboarding across 12 markets",
        "Migrated core Postgres workloads to read replicas, improving p95 query time by 40%",
      ],
      technologies: ["Django", "Go", "PostgreSQL", "Redis"],
    },
    {
      company: "Delta Labs",
      role: "Software Engineer",
      location: "Dallas, TX",
      period: "06/2016 – 02/2019",
      overview:
        "Delta Labs builds analytics products for enterprise operations teams. Delivered APIs and CI pipelines supporting multi-tenant customer deployments.",
      bullets: [
        "Delivered REST APIs and CI pipelines for an analytics product used by 40+ enterprise clients",
      ],
      technologies: ["Python", "TypeScript", "CI/CD"],
    },
  ],
  skills: [
    { label: "Languages & Frameworks", items: ["Python", "Go", "TypeScript", "Django", "FastAPI"] },
    { label: "Cloud & DevOps", items: ["AWS", "Kubernetes", "Docker", "Terraform", "CI/CD"] },
    { label: "Data", items: ["PostgreSQL", "Kafka", "Redis", "Elasticsearch"] },
  ],
  education: [
    {
      degree: "B.S. Computer Science",
      school: "University of Texas at Austin",
      location: "Austin, TX",
      period: "2012 – 2016",
      gpa: "3.8",
    },
  ],
  certifications: [{ name: "AWS Certified Solutions Architect", issuer: "Amazon", date: "2024", url: "" }],
  languages: [
    { name: "English", level: "Native" },
    { name: "Spanish", level: "Professional" },
  ],
  projects: [],
};

/** Prefer the active profile when it has enough content; otherwise show the sample. */
export function resumeForPreview(profile: Profile): ResumeDoc {
  if (!profile.fullName.trim() || profile.experience.length === 0) return SAMPLE_RESUME;

  return {
    name: profile.fullName,
    headline: profile.headline || "Professional",
    contactLine: [profile.location, profile.phone, profile.email, profile.linkedin, profile.website]
      .map((part) => part.trim())
      .filter(Boolean),
    summary:
      profile.summary ||
      "Experienced professional with a track record of shipping reliable software and collaborating across product and engineering.",
    experience: profile.experience.map((entry) => ({
      company: entry.company,
      role: entry.role,
      location: formatExperienceLocation(entry.location, entry.workingMethod),
      period: entry.period,
      overview: entry.description.trim(),
      bullets:
        entry.highlights.length > 0
          ? entry.highlights
          : entry.description
            ? [entry.description]
            : ["Contributed to product delivery and engineering quality."],
      technologies: [],
    })),
    skills: (() => {
      const fromProfile = fallbackSkillGroups(profile);
      return fromProfile.length > 0 ? fromProfile : SAMPLE_RESUME.skills;
    })(),
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
    projects: profile.projects.map((entry) => ({
      name: entry.name,
      description: entry.description,
      tech: entry.tech,
      link: entry.link,
    })),
  };
}
