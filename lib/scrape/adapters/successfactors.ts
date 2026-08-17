import * as cheerio from "cheerio";
import { htmlToText, normalizeWhitespace } from "../html";
import { politeFetch } from "../http";
import type { Adapter, JdSource, ScrapeContext } from "../types";

const CLOSED_POSTING =
  /this job cannot be viewed at this time|no longer available for application|has either been deleted/i;

/**
 * SAP SuccessFactors Recruiting (career*.sapsf.com / career*.successfactors.*)
 * is a JSF app. The posting is server-rendered inside `<form id="careerform">`,
 * which the generic HTML rungs drop, so they never see `.joqReqDescription`
 * (SAP's own class name). The public XML listing feed is the fallback when a
 * tenant serves an empty shell instead of the description.
 */
export const successFactorsAdapter: Adapter = {
  id: "successfactors",

  match(url) {
    if (!isSuccessFactorsHost(url.host)) return false;
    return (
      /\/(sf)?career/i.test(url.pathname) ||
      url.searchParams.has("career_job_req_id") ||
      url.searchParams.has("jobId")
    );
  },

  async fetch(url, ctx) {
    const jobId = jobIdOf(url);
    const company = companyOf(url);
    if (!jobId) {
      throw new Error("link points at the SuccessFactors career site, not a single posting");
    }
    if (!company) {
      throw new Error("SuccessFactors link is missing the company id");
    }

    ctx.onProgress?.(`Fetching SuccessFactors requisition ${jobId}`);
    const page = await politeFetch(url.toString(), { signal: ctx.signal, retries: 1 });
    if (page.ok) {
      const fromHtml = parseHtml(page.body, url, company);
      if (fromHtml) return fromHtml;
      if (CLOSED_POSTING.test(page.body)) {
        throw new Error("posting is closed or no longer accepting applications");
      }
    }

    ctx.onProgress?.("Fetching SuccessFactors XML job feed");
    return parseXmlFeed(url, company, jobId, ctx);
  },
};

function isSuccessFactorsHost(host: string): boolean {
  return /(?:^|\.)(?:sapsf|successfactors)\.(?:com|eu|cn)$/i.test(host);
}

function jobIdOf(url: URL): string | null {
  return (
    url.searchParams.get("career_job_req_id") ||
    url.searchParams.get("jobId") ||
    url.searchParams.get("jobReqId") ||
    null
  );
}

function companyOf(url: URL): string | null {
  return url.searchParams.get("company") || url.searchParams.get("career_company") || null;
}

function parseHtml(html: string, url: URL, company: string): JdSource | null {
  const $ = cheerio.load(html);
  const description =
    $(".joqReqDescription").first().html() ||
    $("div.externalPosting").first().html() ||
    "";
  const text = normalizeWhitespace(htmlToText(description));
  if (!text) return null;

  const rawTitle =
    $("div.pagetitle h1").first().text().trim() ||
    $("#candidateProfileTitle").first().text().trim() ||
    $("h1").first().text().trim();

  return {
    text,
    title: cleanSfTitle(rawTitle) || undefined,
    company,
    location: locationFromHtml($) || undefined,
    applyUrl: url.toString(),
    method: "successfactors-html",
  };
}

function locationFromHtml($: ReturnType<typeof cheerio.load>): string | undefined {
  const subtitle = $("div.pagetitle").first().next("div").text().replace(/\s+/g, " ").trim();
  if (!subtitle) return undefined;
  const parts = subtitle
    .split(/\s*[-–—]\s*/)
    .map((part) => part.replace(/Requisition ID\s*\d+/i, "").replace(/^Posted\b/i, "").trim())
    .filter((part) => part && !/^\d+$/.test(part) && !/^posted$/i.test(part));
  // Department / function crumbs are not a place; keep a value only when it looks geographic.
  const geo = parts.filter((part) =>
    /\b(remote|hybrid|united states|usa|uk|canada|city|county|[A-Z]{2}\b)/i.test(part),
  );
  return geo.join(" | ") || undefined;
}

async function parseXmlFeed(
  url: URL,
  company: string,
  jobId: string,
  ctx: ScrapeContext,
): Promise<JdSource | null> {
  const feedUrl = new URL("/career", url.origin);
  feedUrl.searchParams.set("company", company);
  feedUrl.searchParams.set("career_ns", "job_listing_summary");
  feedUrl.searchParams.set("resultType", "XML");
  const locale = url.searchParams.get("rcm_site_locale");
  if (locale) feedUrl.searchParams.set("rcm_site_locale", locale);

  const response = await politeFetch(feedUrl.toString(), {
    signal: ctx.signal,
    retries: 0,
    accept: "application/xml,text/xml,*/*",
  }).catch(() => null);
  if (!response?.ok) return null;

  const $ = cheerio.load(response.body, { xmlMode: true });
  const job = $("Job")
    .toArray()
    .find((element) => $(element).find("ReqId").first().text().trim() === jobId);
  if (!job) return null;

  const node = $(job);
  const text = normalizeWhitespace(htmlToText(node.find("Job-Description").first().text()));
  if (!text) return null;

  return {
    text,
    title: cleanSfTitle(node.find("JobTitle").first().text()) || undefined,
    company,
    applyUrl: url.toString(),
    method: "successfactors-xml",
  };
}

/** "Career Opportunities: Role (12345)" → "Role" */
function cleanSfTitle(raw: string): string {
  return raw
    .replace(/^Career Opportunities:\s*/i, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
