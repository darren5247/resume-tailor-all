import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { collectJsonParseLiterals, htmlToText, normalizeWhitespace } from "../html";
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
 */
export const zohoAdapter: Adapter = {
  id: "zoho",

  match(url) {
    return /(^|\.)zohorecruit\.(com|in|eu|com\.au)$/i.test(url.host);
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
      url.host.replace(/^www\./, "").split(".")[0];

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

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed) && parsed.some((entry) => entry && typeof entry === "object")) {
        return parsed as ZohoJob[];
      }
    } catch {
      // Another blob on the page; keep looking.
    }
  }
  return [];
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
