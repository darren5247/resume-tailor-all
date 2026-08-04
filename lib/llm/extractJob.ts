import type { JdSource } from "../scrape/types";
import type { LlmClient } from "./client";
import { JobSpecSchema, type JobSpec } from "./schemas";

const SYSTEM = `You turn a raw job posting into structured data for a resume tailoring system.

Rules:
- Extract only what the posting actually says. Never invent requirements.
- Copy keywords verbatim in the posting's own surface form ("CI/CD", "Node.js", "AWS"), because an ATS matches on literal strings.
- mustHave is what the posting frames as required. niceToHave is preferred, bonus or optional.
- mustHave and niceToHave entries must be atomic and matchable: a skill, tool, platform, method or
  domain noun, written as it would literally appear in a resume, at most four words long. Postings
  often state requirements as section labels or marketing phrases; extract the underlying terms
  instead. "Proven Kafka Expertise" becomes "Apache Kafka". "Dual-Language Proficiency (Golang +
  Node.js)" becomes "Golang" and "Node.js". "GCP & Kubernetes (K8s) Production Chops" becomes "GCP",
  "Kubernetes" and "K8s". Split every compound requirement into separate entries.
- Leave non-skill requirements out of mustHave and niceToHave: years of experience, degrees,
  location, work authorization, language fluency, timezone and availability. They belong in
  responsibilities or summary, and a resume cannot mirror them as keywords.
- keywords should hold 15 to 30 of the most match-relevant terms across skills, tools, methods and domain nouns.
- seniority is one short word or phrase such as "Junior", "Mid", "Senior", "Staff", "Lead", or "" when unstated.
- Strip application instructions, EEO statements, benefits boilerplate and legal text.`;

export async function extractJobSpec(
  llm: LlmClient,
  source: JdSource,
  url: string,
  signal?: AbortSignal,
): Promise<JobSpec> {
  const hints = [
    source.title ? `Scraped title: ${source.title}` : "",
    source.company ? `Scraped company: ${source.company}` : "",
    source.location ? `Scraped location: ${source.location}` : "",
    source.employmentType ? `Scraped employment type: ${source.employmentType}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const spec = await llm.json({
    schema: JobSpecSchema,
    label: "job spec",
    temperature: 0.1,
    signal,
    system: SYSTEM,
    user: `Posting URL: ${url}\n${hints}\n\n--- POSTING TEXT ---\n${source.text}`,
  });

  // Scraper metadata is structured data straight from the ATS, so prefer it.
  return {
    ...spec,
    title: source.title?.trim() || spec.title,
    company: source.company?.trim() || spec.company,
    location: source.location?.trim() || spec.location,
  };
}
