import { fetchJson } from "../http";
import { htmlToText } from "../html";
import type { Adapter } from "../types";

interface TeamtailorFeed {
  version?: string;
  items?: TeamtailorItem[];
}

interface TeamtailorItem {
  id?: string;
  title?: string;
  url?: string;
  content_html?: string;
  content_text?: string;
  _jobposting?: {
    hiringOrganization?: { name?: string };
    jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
    employmentType?: string;
  };
}

/**
 * Every Teamtailor career site serves a public JSON Feed at `/jobs.json` with
 * full HTML descriptions. Custom domains use the same path on their own host.
 */
export const teamtailorAdapter: Adapter = {
  id: "teamtailor",

  match(url) {
    return url.host.endsWith("teamtailor.com");
  },

  async fetch(url, ctx) {
    const feed = await fetchJson<TeamtailorFeed>(`${url.origin}/jobs.json`, { signal: ctx.signal });
    if (!feed?.items || !Array.isArray(feed.items)) return null;

    const segments = url.pathname.split("/").filter(Boolean);
    const jobsIndex = segments.indexOf("jobs");
    const slug = jobsIndex >= 0 ? segments[jobsIndex + 1] : null;
    if (!slug) return null;

    const numericId = slug.match(/^(\d+)/)?.[1];
    const item = feed.items.find((entry) => {
      if (entry.url && urlsMatch(entry.url, url)) return true;
      if (numericId && entry.url?.includes(`/jobs/${numericId}`)) return true;
      if (entry.id && (entry.id === slug || entry.url?.includes(slug))) return true;
      return false;
    });
    if (!item) return null;

    const text = item.content_text?.trim() || htmlToText(item.content_html ?? "");
    if (!text) return null;

    const location = item._jobposting?.jobLocation?.address;
    const companyHost = url.host.endsWith("teamtailor.com") ? url.host.split(".")[0] : undefined;

    return {
      text,
      title: item.title,
      company: item._jobposting?.hiringOrganization?.name ?? companyHost,
      location: [location?.addressLocality, location?.addressRegion, location?.addressCountry]
        .filter(Boolean)
        .join(", ") || undefined,
      employmentType: item._jobposting?.employmentType,
      applyUrl: item.url,
      method: "teamtailor-api",
    };
  },
};

function urlsMatch(left: string, right: URL): boolean {
  try {
    const a = new URL(left);
    return a.origin === right.origin && a.pathname.replace(/\/$/, "") === right.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}
