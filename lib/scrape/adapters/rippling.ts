import { politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface RipplingJobPost {
  uuid?: string;
  name?: string;
  companyName?: string;
  url?: string;
  employmentType?: string | { label?: string };
  description?: { company?: string; role?: string } | string;
  workLocations?: { label?: string }[] | string[];
}

/**
 * Rippling's board list API has titles but no descriptions. The job page is a
 * Next.js app that SSR's the full posting into `__NEXT_DATA__`.
 */
export const ripplingAdapter: Adapter = {
  id: "rippling",

  match(url) {
    return url.host === "ats.rippling.com";
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    const jobsIndex = segments.indexOf("jobs");
    const board = jobsIndex > 0 ? segments[0] : null;
    const jobId = jobsIndex >= 0 ? segments[jobsIndex + 1] : null;
    if (!board || !jobId) return null;

    const response = await politeFetch(url.toString(), { signal: ctx.signal });
    if (!response.ok) return null;

    const job = readJobPost(response.body);
    if (!job) return null;

    const description = job.description;
    const parts =
      typeof description === "string"
        ? [description]
        : [description?.role, description?.company].filter(Boolean);
    const text = normalizeWhitespace(parts.map((part) => htmlToText(part as string)).join("\n\n"));
    if (!text) return null;

    const locations = (job.workLocations ?? [])
      .map((entry) => (typeof entry === "string" ? entry : entry.label))
      .filter(Boolean);

    return {
      text,
      title: job.name,
      company: job.companyName ?? board,
      location: locations.join(" | ") || undefined,
      employmentType:
        typeof job.employmentType === "string" ? job.employmentType : job.employmentType?.label,
      applyUrl: job.url ?? url.toString(),
      method: "rippling-next",
    };
  },
};

function readJobPost(html: string): RipplingJobPost | null {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try {
    const data = JSON.parse(match[1]) as {
      props?: { pageProps?: { apiData?: { jobPost?: RipplingJobPost } } };
    };
    return data.props?.pageProps?.apiData?.jobPost ?? null;
  } catch {
    return null;
  }
}
