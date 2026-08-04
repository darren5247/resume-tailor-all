import { randomUUID } from "crypto";
import { politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter, JdSource, ScrapeContext } from "../types";

interface OracleJobDetails {
  Id?: string | number;
  Title?: string;
  PrimaryLocation?: string;
  Category?: string;
  Organization?: string;
  WorkplaceType?: string;
  ExternalDescriptionStr?: string;
  ExternalQualificationsStr?: string;
  ExternalResponsibilitiesStr?: string;
  ShortDescriptionStr?: string;
  workLocation?: Array<{ Name?: string; AddressLine1?: string; City?: string; Region?: string }>;
  skills?: Array<{ Skill?: string }>;
}

/**
 * Oracle Fusion HCM Candidate Experience boards are SPAs. The public CE REST
 * surface (`recruitingCEJobRequisitionDetails`) returns the full description
 * without a browser — but only if the finder string keeps its `;`, `=`, `,`
 * and quotes literal. Encoding them with URLSearchParams makes Oracle return
 * an empty collection.
 */
export const oracleCloudAdapter: Adapter = {
  id: "oraclecloud",

  match(url) {
    return (
      url.host.includes("oraclecloud.com") &&
      /\/hcmUI\/CandidateExperience\//i.test(url.pathname) &&
      /\/job\/[^/]+/i.test(url.pathname)
    );
  },

  async fetch(url, ctx) {
    const jobId = jobIdFromPath(url.pathname);
    if (!jobId) return null;

    const siteNumber = await resolveSiteNumber(url, ctx);
    ctx.onProgress?.(`Oracle HCM site ${siteNumber}, job ${jobId}`);

    const details = await fetchDetails(url.host, siteNumber, jobId, ctx);
    if (!details) return null;

    const text = buildDescription(details);
    if (!text) return null;

    return {
      text,
      title: details.Title,
      company: details.Organization,
      location: locationFrom(details),
      employmentType: details.WorkplaceType || details.Category,
      applyUrl: url.toString(),
      method: "oraclecloud-api",
    } satisfies JdSource;
  },
};

function jobIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/job\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function resolveSiteNumber(url: URL, ctx: ScrapeContext): Promise<string> {
  const siteMatch = url.pathname.match(/\/sites\/([^/?#]+)/i);
  const segment = siteMatch?.[1];
  if (segment && /^CX[_-]?\w+/i.test(segment)) return segment;

  // Vanity /sites/jobsearch paths embed the real siteNumber in page HTML.
  if (segment) {
    const response = await politeFetch(url.toString(), { signal: ctx.signal, retries: 0 }).catch(() => null);
    if (response?.ok) {
      const patterns = [
        /siteNumber\s*[:=]\s*['"]([^'"]+)['"]/i,
        /"siteNumber"\s*:\s*"([^"]+)"/i,
        /siteNumber=(CX_[^&"'=\s]+)/i,
      ];
      for (const pattern of patterns) {
        const found = response.body.match(pattern);
        if (found?.[1]) return found[1];
      }
    }
  }

  return "CX_1";
}

async function fetchDetails(
  host: string,
  siteNumber: string,
  jobId: string,
  ctx: ScrapeContext,
): Promise<OracleJobDetails | null> {
  // Keep finder separators unencoded — URLSearchParams would percent-encode them.
  const finder = `ById;Id="${jobId}",siteNumber=${siteNumber}`;
  const endpoint =
    `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails` +
    `?expand=all&onlyData=true&finder=${finder}`;

  const response = await politeFetch(endpoint, {
    signal: ctx.signal,
    retries: 1,
    accept: "application/json",
    headers: {
      "ora-irc-cx-userid": randomUUID(),
      "ora-irc-language": "en",
      "Content-Type": "application/vnd.oracle.adf.resourceitem+json;charset=utf-8",
    },
  }).catch(() => null);

  if (!response?.ok) return null;

  try {
    const data = JSON.parse(response.body) as { items?: OracleJobDetails[] };
    return data.items?.[0] ?? null;
  } catch {
    return null;
  }
}

function buildDescription(details: OracleJobDetails): string {
  const parts: string[] = [];

  const description = stripHtml(details.ExternalDescriptionStr || details.ShortDescriptionStr);
  if (description) parts.push(description);

  const responsibilities = stripHtml(details.ExternalResponsibilitiesStr);
  if (responsibilities) parts.push("Responsibilities\n" + responsibilities);

  const qualifications = stripHtml(details.ExternalQualificationsStr);
  if (qualifications) parts.push("Qualifications\n" + qualifications);

  const skills = (details.skills ?? []).map((s) => s.Skill).filter(Boolean) as string[];
  if (skills.length) parts.push("Skills\n- " + skills.join("\n- "));

  return normalizeWhitespace(parts.join("\n\n"));
}

function stripHtml(value: string | undefined): string {
  if (!value?.trim()) return "";
  return htmlToText(value);
}

function locationFrom(details: OracleJobDetails): string | undefined {
  if (details.PrimaryLocation?.trim()) return details.PrimaryLocation.trim();
  const first = details.workLocation?.[0];
  if (!first) return undefined;
  return [first.City, first.Region, first.Name].filter(Boolean).join(", ") || undefined;
}
