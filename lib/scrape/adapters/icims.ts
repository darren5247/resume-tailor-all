import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { extractJsonLdJob, htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

/**
 * iCIMS career sites (careers-*.icims.com and vanity hosts that still live on
 * *.icims.com) render the real posting inside an iframe. The outer URL is mostly
 * chrome; `?in_iframe=1` returns the JobPosting JSON-LD / expandable HTML that
 * actually contains the description. There is no public per-job JSON API.
 */
export const icimsAdapter: Adapter = {
  id: "icims",

  match(url) {
    return url.host.endsWith("icims.com") || url.host.endsWith("jibeapply.com");
  },

  async fetch(url, ctx) {
    if (!/\/jobs\/\d+/i.test(url.pathname)) return null;

    const detail = withInIframe(url);
    ctx.onProgress?.("Fetching iCIMS job iframe");

    const response = await politeFetch(detail.toString(), {
      signal: ctx.signal,
      retries: 1,
    });
    if (!response.ok) return null;

    const fromJsonLd = extractJsonLdJob(response.body);
    if (fromJsonLd?.text) {
      return {
        ...fromJsonLd,
        applyUrl: fromJsonLd.applyUrl ?? url.toString(),
        method: "icims-jsonld",
      };
    }

    const $ = cheerio.load(response.body);
    const sections = $(".iCIMS_InfoMsg_Job .iCIMS_Expandable_Text, .iCIMS_Expandable_Text")
      .toArray()
      .map((el) => $(el).html() || "")
      .filter(Boolean);
    const descriptionHtml = sections.join("\n") || $(".iCIMS_JobContent").html() || "";
    const text = normalizeWhitespace(htmlToText(descriptionHtml));
    if (!text) return null;

    const title =
      $("h1.iCIMS_Header").first().text().trim() ||
      $("h1").first().text().trim() ||
      undefined;
    const location =
      $(".iCIMS_JobHeaderData span[itemprop='address']").first().text().trim() ||
      $("[class*='iCIMS_JobLocation']").first().text().trim() ||
      undefined;
    const company =
      $("meta[property='og:site_name']").attr("content")?.trim() ||
      $(".iCIMS_Logo img").attr("alt")?.trim() ||
      companyFromHost(url.host);

    return {
      text,
      title: title || undefined,
      company: company || undefined,
      location: cleanIcimsLocation(location) || undefined,
      applyUrl: url.toString(),
      method: "icims-html",
    };
  },
};

function withInIframe(url: URL): URL {
  const next = new URL(url.toString());
  // Strip board chrome query noise; keep only what the iframe renderer needs.
  next.search = "";
  next.searchParams.set("in_iframe", "1");
  return next;
}

function companyFromHost(host: string): string | undefined {
  const label = host.replace(/^www\./, "").split(".")[0] ?? "";
  const stripped = label.replace(/^(careers|jobs|jobs2|staff|internal)-?/i, "");
  return stripped || undefined;
}

/** iCIMS often encodes locations as `US-Remote` or `US-CA-San Francisco`. */
function cleanIcimsLocation(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || /^unavailable$/i.test(value)) return undefined;
  const match = value.match(/^[A-Z]{2}-(?:[A-Z]{2}-)?(.+)$/);
  return match?.[1]?.replace(/-/g, " ") || value;
}
