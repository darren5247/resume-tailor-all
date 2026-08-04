import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

/**
 * Jobvite career pages are server-rendered. There is no reliable public per-job
 * JSON API; `.jv-job-detail-description` is the stable HTML surface.
 */
export const jobviteAdapter: Adapter = {
  id: "jobvite",

  match(url) {
    return url.host === "jobs.jobvite.com" || url.host.endsWith(".jobvite.com");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    // /{company}/job/{id} or /careers/{company}/job/{id}
    const jobIndex = segments.indexOf("job");
    if (jobIndex < 1) return null;
    const company = segments[0] === "careers" ? segments[1] : segments[0];
    const jobId = segments[jobIndex + 1];
    if (!company || !jobId) return null;

    const response = await politeFetch(url.toString(), { signal: ctx.signal });
    if (!response.ok) return null;

    const $ = cheerio.load(response.body);
    const description =
      $("div.jv-job-detail-description").html() ||
      $("[class*='job-detail-description']").html() ||
      $("[class*='jobDescription']").html() ||
      "";
    const text = normalizeWhitespace(htmlToText(description));
    if (!text) return null;

    const title =
      $("h2.jv-header").first().text().trim() ||
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content")?.trim() ||
      undefined;
    const meta = $("p.jv-job-detail-meta").first().text().replace(/\s+/g, " ").trim();
    const metaParts = meta
      ? meta
          .split("|")
          .map((part) => part.trim())
          .filter(Boolean)
      : [];

    return {
      text,
      title: title || undefined,
      company,
      location: metaParts[1] || metaParts[0] || undefined,
      applyUrl: response.finalUrl || url.toString(),
      method: "jobvite-html",
    };
  },
};
