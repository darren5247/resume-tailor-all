import type { JdSource } from "../scrape/types";
import type { LlmClient } from "./client";
import { classifyCompanySignals } from "./companySignals";
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
- title: the job title only (role name as posted). Do not append company, location, workplace ("Remote"),
  or requisition / job codes (REQ-1234). Prefer "Senior Data Engineer" over
  "Senior Data Engineer - Remote (United States) | Acme | REQ-42".
- company: the hiring organization's brand or legal name from the posting text, logo/header, or URL.
  Prefer a real name ("Acme", "Acme Corp") over ATS board tokens, path slugs, or hostnames
  ("acmecorp", "boards.greenhouse.io", "jobs.lever.co/acme"). Never use the ATS product name
  as the company. When the poster is a staffing/recruiting agency, company is the agency name
  (not the end client).
- hiringChannel: prefer "unknown" unless the posting is unmistakable. "agency" only for a
  recruiter / staffing / search firm posting for a client ("our client is", "on behalf of",
  "staffing agency", "recruiting firm"). "direct" only for the named company hiring itself
  ("direct hire", "join us at <Company>", the company's own careers site). Do NOT treat
  "we are hiring", "about us", "join our team", or a third-party ATS (Greenhouse, Lever)
  as proof of either side. Agencies use those phrases too.
- clientCompany: when hiringChannel is "agency", the end client's brand if the posting names
  it (e.g. "our client, Acme"). Leave "" for direct hires or when the client is undisclosed.
- isStartup: true only when the posting identifies the employer or named client as a startup
  ("we are a startup", "early-stage startup", "YC-backed", "we raised a seed/Series A").
  False when it only asks for startup experience or mentions "startup culture" as a value.
- salaryExpectation: copy the posting's stated pay briefly (range, currency, and period when given).
  Leave "" when compensation is absent, "competitive", "DOE", or equity-only with no cash figure.
- salaryMin / salaryMax: numeric cash figures in the posting's own currency, not converted.
  Use the same unit the posting uses (do not yearly-ize a monthly figure). Range → min and max;
  a single figure → both set to that number. Null when pay is unstated or not a cash number.
- salaryCurrency: ISO 4217 code (USD, EUR, COP, GBP, …). Infer USD from "$" / "dollars" when
  the posting is clearly US; otherwise leave "" if the currency is ambiguous.
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

  // Scraper metadata is structured ATS data — prefer it when it looks like a real
  // title/company. Board tokens / hostnames lose to the model when the posting
  // text names the employer clearly.
  const location = source.location?.trim() || spec.location;
  const enriched = enrichWorkplaceFromLocation(spec, location, source.employmentType);
  const company = pickCompany(source.company, enriched.company, url);
  const title = pickTitle(source.title, enriched.title);
  const signals = classifyCompanySignals({
    text: source.text,
    company,
    url,
    llmClientCompany: enriched.clientCompany,
  });
  return {
    ...enriched,
    title,
    company,
    location,
    hiringChannel: signals.hiringChannel,
    // Keep the model's client name when the first pass is not yet agency so a
    // later re-classify (after folder identity) can still attach it.
    clientCompany:
      signals.hiringChannel === "agency" ? signals.clientCompany : enriched.clientCompany.trim(),
    isStartup: signals.isStartup,
  };
}

function pickTitle(scraped: string | undefined, extracted: string): string {
  const a = scraped?.trim() ?? "";
  const b = extracted.trim();
  if (a && b) {
    // Prefer scraped when it is not obviously noisier (long geo/req suffixes).
    const aNoise = /(?:remote|hybrid|REQ[-_]?\d+|,\s*[A-Z]{2}\s*$)/i.test(a);
    const bNoise = /(?:remote|hybrid|REQ[-_]?\d+)/i.test(b);
    if (aNoise && !bNoise) return b;
    return a;
  }
  return a || b;
}

function pickCompany(scraped: string | undefined, extracted: string, url: string): string {
  const a = scraped?.trim() ?? "";
  const b = extracted.trim();
  if (a && !isWeakScrapedCompany(a, url)) return a;
  if (b) return b;
  return a;
}

/** Board tokens, hostnames, and ATS product names are weak vs posting text. */
function isWeakScrapedCompany(name: string, url: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (/^[\w-]+(\.[\w-]+)+$/.test(n)) return true;
  if (/^(greenhouse|lever|ashby|workday|bamboohr|jobvite|careers|jobs|boards?)$/i.test(n)) {
    return true;
  }
  try {
    const path = new URL(url).pathname.toLowerCase();
    const slug = n.toLowerCase();
    if (/^[a-z0-9_-]+$/.test(n) && path.split("/").includes(slug)) return true;
  } catch {
    /* ignore */
  }
  return /^[a-z0-9_-]{2,40}$/.test(n) && !n.includes(" ");
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
