import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { collectJsonParseLiterals, decodeJsStringLiteral, htmlToText, normalizeWhitespace } from "../html";
import type { Adapter, JdSource } from "../types";

interface ZohoJob {
  id?: string;
  Job_Opening_Name?: string;
  Posting_Title?: string;
  Job_Description?: string;
  City?: string;
  State?: string;
  Country?: string;
  Job_Type?: string;
  Remote_Job?: boolean | string;
}

/**
 * Zoho Recruit career portals ship the openings array as JSON inside the page
 * rather than rendering the posting into the DOM: detail pages declare
 * `var jobs = JSON.parse('...')` with every quote escaped as `\x22`, and older
 * boards put the same array in a hidden `#jobs` input. Either way the visible
 * body is built client side, so both text extraction and readability come back
 * empty and the blob is the only source.
 *
 * Custom hosts (jobs.conkord.com and the like) serve the same page; they are
 * recognised from the `/jobs/{portal}/{18-digit-id}` URL and Zoho's own
 * `?source=CareerSite` query flag.
 */
export const zohoAdapter: Adapter = {
  id: "zoho",

  match(url) {
    if (isZohoRecruitHost(url.host)) return true;
    if (url.searchParams.get("source") === "CareerSite") return true;
    const parsed = parseZohoPath(url);
    return !!parsed && parsed.jobId.length >= 15;
  },

  async fetch(url, ctx) {
    const parsed = parseZohoPath(url);
    if (!parsed?.jobId) return null;

    ctx.onProgress?.("Fetching Zoho posting");
    let response = await politeFetch(url.toString(), { signal: ctx.signal });
    let job = response.ok ? findJob(response.body, parsed.jobId) : null;

    // Portals that still serve an SPA shell on detail URLs only carry the array
    // on the board page.
    if (!job?.Job_Description) {
      ctx.onProgress?.(`Fetching Zoho board "${parsed.portal}"`);
      response = await politeFetch(`https://${url.host}/jobs/${encodeURIComponent(parsed.portal)}`, {
        signal: ctx.signal,
      });
      job = response.ok ? findJob(response.body, parsed.jobId) : null;
    }
    if (!job?.Job_Description) return null;

    const text = normalizeWhitespace(htmlToText(job.Job_Description));
    if (!text) return null;

    const company =
      readMeta(response.body, "og:site_name") ??
      readCompanyName(response.body) ??
      companyFromHost(url.host);

    return {
      text,
      title: job.Job_Opening_Name || job.Posting_Title,
      company,
      location: formatLocation(job),
      employmentType: job.Job_Type && job.Job_Type !== "Any" ? job.Job_Type : undefined,
      applyUrl: url.toString(),
      method: "zoho-job-blob",
    } satisfies JdSource;
  },
};

function findJob(html: string, jobId: string): ZohoJob | null {
  const jobs = extractJobs(html);
  const byId = jobs.find((entry) => String(entry.id) === jobId);
  // A detail page carries the one posting it is about, and not always its id.
  return byId ?? (jobs.length === 1 ? jobs[0] : null);
}

function isZohoRecruitHost(host: string): boolean {
  return /(^|\.)zohorecruit\.(com|in|eu|com\.au)$/i.test(host);
}

function parseZohoPath(url: URL): { portal: string; jobId: string } | null {
  const segments = url.pathname.split("/").filter(Boolean);
  // /jobs/{portal}/{jobId}/{optional-slug}
  if (segments[0]?.toLowerCase() !== "jobs" || !segments[1]) return null;

  const portal = segments[1];
  const jobId = segments[2];
  if (!jobId || !/^\d+$/.test(jobId)) return null;
  return { portal, jobId };
}

function extractJobs(html: string): ZohoJob[] {
  const $ = cheerio.load(html);
  const candidates = [$("#jobs").attr("value"), ...collectJsonParseLiterals(html)];

  let fallback: ZohoJob[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!Array.isArray(parsed) || !parsed.some((entry) => entry && typeof entry === "object")) {
        continue;
      }
      const jobs = parsed as ZohoJob[];
      if (jobs.some((entry) => entry.Job_Description || entry.Job_Opening_Name || entry.Posting_Title)) {
        return jobs;
      }
      if (!fallback.length) fallback = jobs;
    } catch {
      // Another blob on the page; keep looking.
    }
  }
  return fallback;
}

function formatLocation(job: ZohoJob): string | undefined {
  const parts = [job.City, job.State, job.Country].map((part) => part?.trim()).filter(Boolean);
  if (parts.length) return parts.join(", ");
  if (job.Remote_Job === true || job.Remote_Job === "true") return "Remote";
  return undefined;
}

function readMeta(html: string, property: string): string | undefined {
  const $ = cheerio.load(html);
  const content = $(`meta[property="${property}"]`).attr("content")?.trim();
  return content || undefined;
}

function readCompanyName(html: string): string | undefined {
  const match = html.match(/"company_name"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!match?.[1]) return undefined;
  const name = decodeJsStringLiteral(match[1]).trim();
  return name || undefined;
}

function companyFromHost(host: string): string {
  const labels = host.replace(/^www\./, "").split(".");
  if (labels.length >= 2 && /^(jobs|careers|recruiting|talent)$/i.test(labels[0])) {
    return labels[1];
  }
  return labels[0] ?? host;
}
