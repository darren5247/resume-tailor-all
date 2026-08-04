import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

/**
 * JazzHR career pages on applytojob.com are server-rendered. There is no public
 * per-job JSON API, but `#job-description` is reliable HTML.
 */
export const jazzHrAdapter: Adapter = {
  id: "jazzhr",

  match(url) {
    return url.host.endsWith("applytojob.com");
  },

  async fetch(url, ctx) {
    // Listing pages are not a single JD.
    if (/\/apply\/?$/.test(url.pathname) || /\/apply\/jobs\/?$/i.test(url.pathname)) return null;

    const response = await politeFetch(url.toString(), { signal: ctx.signal });
    if (!response.ok) return null;

    const $ = cheerio.load(response.body);
    const description =
      $("#job-description").html() ||
      $(".job-details .description").html() ||
      $("[id*='job-description']").first().html() ||
      "";
    const text = normalizeWhitespace(htmlToText(description));
    if (!text) return null;

    const title =
      $("div.job-header h1").first().text().trim() ||
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content")?.trim() ||
      $("title").first().text().trim().replace(/\s*[|\-–].*$/, "").trim() ||
      undefined;
    const location =
      $("div.job-attributes-container div[title='Location']").first().text().trim() ||
      $("[class*='location']").first().text().trim() ||
      undefined;
    const company = url.host.split(".")[0];

    return {
      text,
      title: title || undefined,
      company: company !== "www" && company !== "landing" ? company : undefined,
      location: location || undefined,
      applyUrl: response.finalUrl || url.toString(),
      method: "jazzhr-html",
    };
  },
};
