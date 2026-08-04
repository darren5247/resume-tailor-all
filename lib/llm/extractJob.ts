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
- workplaceType: "remote" when a fully remote option exists (even if hybrid/onsite alternatives
  are also offered); "hybrid" or "onsite" only when in-office presence is required with no fully
  remote option; "unspecified" when the posting does not say. Phrases like "Remote — United States",
  "WFH", "work from home", or "distributed" count as remote when no office days are required.
- requiredBaseCountries: countries or clear regions where the candidate must live / be based /
  reside, only when the posting explicitly requires it (e.g. "US only", "must be located in the
  United Kingdom", "Remote (Canada)", "candidates based in the EU"). Use English country or region
  names. Leave empty for worldwide, unrestricted remote, unstated location, timezone-only
  preferences, company HQ location, or work-authorization rules that do not require living there.
  Do not put city/office addresses here unless they imply a required residence country.
- keywords should hold 15 to 30 of the most match-relevant terms across skills, tools, methods and domain nouns.
- seniority is one short word or phrase such as "Junior", "Mid", "Senior", "Staff", "Lead", or "" when unstated.
- salaryExpectation: copy the posting's stated pay briefly (range, currency, and period when given).
  Leave "" when compensation is absent, "competitive", "DOE", or equity-only with no cash figure.
- salaryMonthlyUsd: convert the highest stated cash figure to approximate monthly USD.
  Yearly ÷ 12, weekly × 4.33, hourly × 160 (full-time month). Non-USD: convert at a rough
  market rate when the currency is clear; otherwise null. Use null when pay is unstated or
  not convertible. Do not invent a number from role seniority alone.
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
  const location = source.location?.trim() || spec.location;
  const enriched = enrichWorkplaceFromLocation(spec, location, source.employmentType);
  return {
    ...enriched,
    title: source.title?.trim() || enriched.title,
    company: source.company?.trim() || enriched.company,
    location,
  };
}

/**
 * Fill workplaceType / requiredBaseCountries from location labels when the model
 * left them empty but the ATS string is explicit (e.g. "Remote - United States").
 */
function enrichWorkplaceFromLocation(
  spec: JobSpec,
  location: string,
  employmentType?: string,
): JobSpec {
  const haystack = [location, employmentType ?? "", spec.employmentType].filter(Boolean).join(" · ");
  if (!haystack.trim()) return spec;

  let workplaceType = spec.workplaceType;
  if (workplaceType === "unspecified") {
    if (/\bhybrid\b/i.test(haystack)) workplaceType = "hybrid";
    else if (/\b(on[\s-]?site|in[\s-]?office|office[\s-]?based)\b/i.test(haystack)) workplaceType = "onsite";
    else if (/\b(remote|work\s*from\s*home|wfh|distributed)\b/i.test(haystack)) workplaceType = "remote";
  }

  let requiredBaseCountries = spec.requiredBaseCountries;
  if (requiredBaseCountries.length === 0) {
    const fromLocation = inferRequiredCountriesFromLocation(location);
    if (fromLocation.length > 0) requiredBaseCountries = fromLocation;
  }

  return { ...spec, workplaceType, requiredBaseCountries };
}

/** Parse "Remote - United States", "US only", "Canada (Remote)" style location lines. */
function inferRequiredCountriesFromLocation(location: string): string[] {
  const text = location.trim();
  if (!text) return [];
  if (/\b(world\s*wide|anywhere|global|unrestricted)\b/i.test(text)) return [];

  // "Remote — United States", "Remote (UK)", "Hybrid - New York, NY"
  const afterRemote = text.match(
    /\bremote\b\s*[-–—:,|(]\s*([A-Za-z][A-Za-z\s.',-]+?)(?:\)|$)/i,
  );
  if (afterRemote?.[1]) {
    const place = afterRemote[1].trim().replace(/\.$/, "");
    if (place && !/^(only|yes|ok|preferred)$/i.test(place)) return [place];
  }

  if (/\b(us|u\.s\.|usa|u\.s\.a\.|united states)\s*only\b/i.test(text)) {
    return ["United States"];
  }
  if (/\b(uk|u\.k\.|united kingdom)\s*only\b/i.test(text)) {
    return ["United Kingdom"];
  }
  if (/\bcanada\s*only\b/i.test(text)) return ["Canada"];

  return [];
}
