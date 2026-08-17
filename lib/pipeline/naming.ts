import type { JobSpec } from "../llm/schemas";
import type { JdSource } from "../scrape/types";

/** Clean company + role used for UI labels and output folder / zip names. */
export interface FolderIdentity {
  company: string;
  role: string;
  /** Human label, e.g. "Senior Data Engineer at Acme". */
  title: string;
}

const ATS_HOST_MARKERS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "workdayjobs.com",
  "bamboohr.com",
  "jobvite.com",
  "smartrecruiters.com",
  "icims.com",
  "taleo.net",
  "ultipro.com",
  "ukg.com",
  "paylocity.com",
  "paycomonline.net",
  "sapsf.com",
  "sapsf.eu",
  "successfactors.com",
  "successfactors.eu",
  "recruitee.com",
  "personio.de",
  "personio.com",
  "teamtailor.com",
  "join.com",
  "rippling.com",
  "hireology.com",
  "jazzhr.com",
  "applytojob.com",
  "gem.com",
  "wellfound.com",
  "angel.co",
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
];

const CAREER_SUBDOMAINS = new Set([
  "careers",
  "career",
  "jobs",
  "job",
  "apply",
  "talent",
  "recruiting",
  "recruit",
  "hire",
  "hiring",
  "boards",
  "job-boards",
  "www",
]);

const LEGAL_SUFFIX =
  /\b(,?\s*)?\b(incorporated|inc\.?|llc\.?|l\.?l\.?c\.?|corp\.?|corporation|ltd\.?|limited|co\.?|company|plc\.?|gmbh|s\.?a\.?|pty\.?)\s*$/i;

/**
 * Deeply reconcile URL path/host, scraper metadata, and LLM JobSpec into a
 * stable company + role used for the dated output folder name.
 */
export function resolveFolderIdentity(input: {
  url: string;
  source: JdSource;
  spec: JobSpec;
  fallbackLabel?: string;
}): FolderIdentity {
  const urlCompany = companyFromUrl(input.url);
  const company = pickCompany({
    scraped: input.source.company,
    extracted: input.spec.company,
    fromUrl: urlCompany,
    fallback: input.fallbackLabel,
    url: input.url,
  });
  const role = pickRole({
    scraped: input.source.title,
    extracted: input.spec.title,
    seniority: input.spec.seniority,
  });

  const cleanCompany = company || "company";
  const cleanRole = role || "role";
  return {
    company: cleanCompany,
    role: cleanRole,
    title: `${cleanRole} at ${cleanCompany}`,
  };
}

/**
 * Prefer a real hiring-org name over ATS board tokens / hostnames.
 * Order: strong scraped → strong LLM → URL guess → weak scraped/LLM → host label.
 * Weakness is judged on the raw string before humanizeSlug so "acme" does not
 * beat LLM "Acme Corp" after becoming "Acme".
 */
function pickCompany(args: {
  scraped?: string;
  extracted?: string;
  fromUrl: string | null;
  fallback?: string;
  url: string;
}): string {
  const scrapedRaw = args.scraped?.trim() ?? "";
  const extractedRaw = args.extracted?.trim() ?? "";
  const fromUrlRaw = args.fromUrl?.trim() ?? "";
  const fallbackRaw = args.fallback?.trim() ?? "";

  const scrapedWeak = !scrapedRaw || isWeakCompany(scrapedRaw, args.url);
  const extractedWeak = !extractedRaw || isWeakCompany(extractedRaw, args.url);

  if (!scrapedWeak) return normalizeCompany(scrapedRaw);
  if (!extractedWeak) return normalizeCompany(extractedRaw);
  if (fromUrlRaw && !isWeakCompany(fromUrlRaw, args.url)) return normalizeCompany(fromUrlRaw);
  if (scrapedRaw) return normalizeCompany(scrapedRaw);
  if (extractedRaw) return normalizeCompany(extractedRaw);
  if (fromUrlRaw) return normalizeCompany(fromUrlRaw);
  if (fallbackRaw && !looksLikeHostname(fallbackRaw)) return normalizeCompany(fallbackRaw);
  return normalizeCompany(fromUrlRaw) || "company";
}

function pickRole(args: {
  scraped?: string;
  extracted?: string;
  seniority?: string;
}): string {
  const scraped = cleanRoleTitle(args.scraped ?? "");
  const extracted = cleanRoleTitle(args.extracted ?? "");
  // Prefer the longer concrete title when both look real; scraped ATS titles are usually clean.
  let role = "";
  if (scraped && extracted) {
    role = scraped.length >= extracted.length * 0.6 ? scraped : extracted;
  } else {
    role = scraped || extracted;
  }
  return applySeniority(role, args.seniority ?? "");
}

/** Strip legal suffixes and collapse whitespace; keep brand casing when present. */
export function normalizeCompany(raw?: string): string {
  if (!raw?.trim()) return "";
  let name = raw
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (looksLikeHostname(name)) {
    name = companyFromHost(name) || name;
  }

  name = name.replace(LEGAL_SUFFIX, "").replace(/[,\s]+$/g, "").trim();
  // Board tokens arrive as "acmecorp" — make them folder-friendly.
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/i.test(name) && name === name.toLowerCase()) {
    name = humanizeSlug(name);
  }
  return name.slice(0, 80);
}

/** Remove location / remote / requisition noise from a posting title. */
export function cleanRoleTitle(raw: string): string {
  let title = raw.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!title) return "";

  // "Role - Company" / "Role | Company Hiring" when company is trailing.
  title = title.replace(/\s+[\-|–—]\s+hiring\s+now\b.*$/i, "");
  title = title.replace(/\s*\|\s*[^|]+$/i, (tail) =>
    /\b(remote|hybrid|onsite|on-site|united states|usa|uk|canada|emea)\b/i.test(tail) ? "" : tail,
  );

  // Trailing workplace / geo after dash or en-dash.
  title = title.replace(
    /\s*[-–—|:]\s*(remote|hybrid|on[\s-]?site|work\s*from\s*home|wfh)\b.*$/i,
    "",
  );
  title = title.replace(
    /\s*[-–—|:]\s*.*\b(united states|usa|u\.s\.a?\.?|uk|u\.k\.|canada|emea|apac|latam)\b.*$/i,
    "",
  );
  title = title.replace(
    /\s*\((?:remote|hybrid|on[\s-]?site|[^)]*\b(?:CA|NY|TX|WA|FL|IL|MA|CO|OR|AZ|GA|NC|remote|hybrid)\b[^)]*)\)\s*$/i,
    "",
  );

  // Requisition / job codes.
  title = title.replace(/\s*[-–—|:]\s*(?:REQ|JR|JOB|R|ID)[-_#\s]?\d+\w*\s*$/i, "");
  title = title.replace(/\s*[\[(](?:REQ|JR|JOB|R|ID)[-_#\s]?\d+\w*[\])]\s*$/i, "");
  title = title.replace(/\s*#\d{3,}\s*$/g, "");

  // "Senior Engineer at Acme" → keep role only for folder segment.
  title = title.replace(/\s+at\s+[A-Z][\w.&'\s-]{1,40}$/u, "");

  return title.replace(/\s+/g, " ").trim().slice(0, 100);
}

function applySeniority(role: string, seniority: string): string {
  if (!role) return role;
  const level = seniority.trim();
  if (!level) return role;
  if (new RegExp(`\\b${escapeRegExp(level)}\\b`, "i").test(role)) return role;
  // Only prepend short level words we extracted (Junior/Mid/Senior/Staff/Lead/Principal).
  if (!/^(junior|jr\.?|mid|middle|senior|sr\.?|staff|lead|principal|head|director|intern)$/i.test(level)) {
    return role;
  }
  return `${capitalizeWord(level)} ${role}`.replace(/\s+/g, " ").trim();
}

/** Derive a company guess from common ATS URL shapes and careers hosts. */
export function companyFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.host.replace(/^www\./i, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host.includes("greenhouse.io")) {
    const token = segments.find((s) => s && s !== "embed" && s !== "jobs" && !/^\d+$/.test(s));
    if (token && !/^(job_app|embed)$/i.test(token)) return humanizeSlug(token);
  }

  if (host.endsWith("lever.co")) {
    if (segments[0] && segments[0] !== "v0") return humanizeSlug(segments[0]);
  }

  if (host.includes("ashbyhq.com")) {
    if (segments[0]) return humanizeSlug(segments[0]);
  }

  if (host.includes("myworkdayjobs.com") || host.includes("workdayjobs.com")) {
    const tenant = host.match(/^([a-z0-9-]+)\.wd\d+\./i)?.[1];
    if (tenant) return humanizeSlug(tenant);
    if (segments[0] && !/^(en-US|job|jobs)$/i.test(segments[0])) return humanizeSlug(segments[0]);
  }

  if (host.endsWith("bamboohr.com") || host.endsWith("personio.de") || host.endsWith("personio.com")) {
    const sub = host.split(".")[0];
    if (sub && !CAREER_SUBDOMAINS.has(sub)) return humanizeSlug(sub);
  }

  if (host.includes("smartrecruiters.com") && segments[0]) {
    return humanizeSlug(segments[0]);
  }

  if (host.includes("jobvite.com")) {
    const company = segments[0] === "careers" ? segments[1] : segments[0];
    if (company) return humanizeSlug(company);
  }

  if (host.includes("recruitee.com") || host.includes("teamtailor.com")) {
    const sub = host.split(".")[0];
    if (sub && !CAREER_SUBDOMAINS.has(sub)) return humanizeSlug(sub);
  }

  if (host.includes("sapsf.") || host.includes("successfactors.")) {
    const company = url.searchParams.get("company") || url.searchParams.get("career_company");
    if (company) return humanizeSlug(company);
  }

  // careers.acme.com / jobs.acme.io
  const labels = host.split(".");
  if (labels.length >= 3 && CAREER_SUBDOMAINS.has(labels[0])) {
    return humanizeSlug(stripLegalDomain(labels[1]));
  }

  // Company career site: acme.com/careers/...
  if (!isAtsHost(host) && labels.length >= 2) {
    const domain = labels[labels.length - 2];
    if (domain && !CAREER_SUBDOMAINS.has(domain) && domain !== "co") {
      return humanizeSlug(stripLegalDomain(domain));
    }
  }

  return null;
}

function isWeakCompany(name: string, url: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (looksLikeHostname(n)) return true;
  if (isAtsHost(n.toLowerCase())) return true;
  if (/^(greenhouse|lever|ashby|workday|bamboohr|jobvite|careers|jobs|boards?)$/i.test(n)) {
    return true;
  }
  // Bare slug matching an ATS path token is a board id, not a brand name.
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const slug = n.toLowerCase().replace(/[\s_-]+/g, "");
    const matchesPath = segments.some((s) => {
      const seg = s.toLowerCase().replace(/[\s_-]+/g, "");
      return s.toLowerCase() === n.toLowerCase() || seg === slug;
    });
    if (/^[a-z0-9_-]+$/.test(n) && matchesPath) return true;
  } catch {
    /* ignore */
  }
  // Single-token board-style slug (no spaces) → weak vs a proper LLM company name.
  if (/^[a-z0-9_-]{2,40}$/.test(n) && !n.includes(" ")) return true;
  return false;
}

function looksLikeHostname(value: string): boolean {
  return /^[\w-]+(\.[\w-]+)+$/.test(value.trim());
}

function isAtsHost(host: string): boolean {
  return ATS_HOST_MARKERS.some((marker) => host === marker || host.endsWith(`.${marker}`) || host.includes(marker));
}

function companyFromHost(hostish: string): string | null {
  const host = hostish.replace(/^www\./i, "").toLowerCase();
  if (isAtsHost(host)) return null;
  const labels = host.split(".");
  if (labels.length >= 3 && CAREER_SUBDOMAINS.has(labels[0])) {
    return humanizeSlug(stripLegalDomain(labels[1]));
  }
  if (labels.length >= 2) return humanizeSlug(stripLegalDomain(labels[labels.length - 2]));
  return null;
}

function stripLegalDomain(domain: string): string {
  let current = domain.toLowerCase();
  for (const suffix of ["solutionsllc", "llc", "inc", "corp", "ltd", "limited", "company", "solutions"]) {
    if (current.length > suffix.length + 2 && current.endsWith(suffix)) {
      current = current.slice(0, -suffix.length);
      break;
    }
  }
  return current;
}

/** "acme-corp" / "acmecorp" → "Acme Corp" / "Acmecorp". */
export function humanizeSlug(slug: string): string {
  const cleaned = slug.replace(/[_\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!cleaned) return "";
  if (cleaned.includes("-")) {
    return cleaned
      .split("-")
      .filter(Boolean)
      .map(capitalizeWord)
      .join(" ");
  }
  return capitalizeWord(cleaned);
}

function capitalizeWord(word: string): string {
  if (!word) return word;
  if (/^(ii|iii|iv|usa|uk|ai|ml|sre|it|hr|qa)$/i.test(word)) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
