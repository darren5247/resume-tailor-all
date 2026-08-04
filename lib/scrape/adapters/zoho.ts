import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
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
 * Zoho Recruit career portals embed the full openings array as JSON in a hidden
 * `#jobs` input on the board page. Detail URLs are SPA shells without that blob,
 * so we always resolve the numeric job id against `/jobs/{portal}`.
 */
export const zohoAdapter: Adapter = {
  id: "zoho",

  match(url) {
    return /(^|\.)zohorecruit\.(com|in|eu|com\.au)$/i.test(url.host);
  },

  async fetch(url, ctx) {
    const parsed = parseZohoPath(url);
    if (!parsed?.jobId) return null;

    const boardUrl = `https://${url.host}/jobs/${encodeURIComponent(parsed.portal)}`;
    ctx.onProgress?.(`Fetching Zoho board "${parsed.portal}"`);

    const response = await politeFetch(boardUrl, { signal: ctx.signal });
    if (!response.ok) return null;

    const jobs = extractJobs(response.body);
    const job = jobs.find((entry) => String(entry.id) === parsed.jobId);
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
      method: "zoho-board",
    } satisfies JdSource;
  },
};

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
  const value = $("#jobs").attr("value");
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as ZohoJob[]) : [];
  } catch {
    return [];
  }
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
