import { fetchJson } from "../http";
import { htmlToText } from "../html";
import type { Adapter } from "../types";

interface WorkdayJobResponse {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    timeType?: string;
    externalUrl?: string;
  };
  hiringOrganization?: { name?: string };
}

/**
 * Workday has no documented public API, but every career site is a single-page
 * app talking to a `/wday/cxs/` JSON endpoint that mirrors the visible URL.
 * The tenant and site cannot be guessed from a company name; they only exist in
 * the URL, which is exactly what we have.
 */
export const workdayAdapter: Adapter = {
  id: "workday",

  match(url) {
    return url.host.includes("myworkdayjobs.com") || url.host.includes("myworkdaysite.com");
  },

  async fetch(url, ctx) {
    const tenant = url.host.split(".")[0];
    const segments = url.pathname.split("/").filter(Boolean);

    const jobIndex = segments.indexOf("job");
    if (jobIndex < 1) return null;

    // Path is [locale?]/{site}/job/{...}. The locale segment is optional.
    const site = segments[jobIndex - 1];
    const tail = segments.slice(jobIndex).join("/");
    if (!site || !tail) return null;

    const endpoint = `https://${url.host}/wday/cxs/${tenant}/${site}/${tail}`;
    ctx.onProgress?.(`Workday tenant ${tenant}, site ${site}`);

    const data = await fetchJson<WorkdayJobResponse>(endpoint, {
      signal: ctx.signal,
      headers: { Accept: "application/json" },
    });

    const info = data?.jobPostingInfo;
    if (!info?.jobDescription) return null;

    const text = htmlToText(info.jobDescription);
    if (!text) return null;

    return {
      text,
      title: info.title,
      company: data?.hiringOrganization?.name ?? tenant,
      location: [info.location, ...(info.additionalLocations ?? [])].filter(Boolean).join(" | "),
      employmentType: info.timeType,
      applyUrl: info.externalUrl,
      method: "workday-api",
    };
  },
};
