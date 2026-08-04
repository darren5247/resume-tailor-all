import { fetchJson } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface DoverJob {
  id?: string;
  internal_job_id?: string;
  title?: string;
  company_name?: string;
  absolute_url?: string;
  content?: string;
  location?: { name?: string } | string;
  remote?: string | boolean | null;
  offices?: { name?: string }[];
  employment_type?: string;
}

interface DoverFeed {
  jobs?: DoverJob[];
}

/**
 * Dover careers pages are SPAs, but every board publishes a public JSON feed
 * at `/feed/v1/boards/{slug}/jobs` with the full HTML description inline.
 */
export const doverAdapter: Adapter = {
  id: "dover",

  match(url) {
    return url.host === "app.dover.com" || url.host === "app.dover.io";
  },

  async fetch(url, ctx) {
    const { slug, jobId } = parseDoverUrl(url);
    if (!slug || !jobId) return null;

    ctx.onProgress?.(`Dover board "${slug}"`);
    const feed = await fetchJson<DoverFeed>(
      `https://app.dover.com/feed/v1/boards/${encodeURIComponent(slug.toLowerCase())}/jobs`,
      {
        signal: ctx.signal,
        headers: { Accept: "application/json" },
      },
    );

    const job = feed?.jobs?.find(
      (entry) => entry.id === jobId || entry.internal_job_id === jobId,
    );
    if (!job?.content) return null;

    const text = normalizeWhitespace(htmlToText(job.content));
    if (!text) return null;

    const location =
      typeof job.location === "string"
        ? job.location
        : job.location?.name ||
          (job.offices ?? [])
            .map((office) => office.name)
            .filter(Boolean)
            .join(" | ") ||
          undefined;

    return {
      text,
      title: job.title,
      company: job.company_name ?? slug,
      location: [location, remoteLabel(job.remote)].filter(Boolean).join(" · ") || undefined,
      employmentType: job.employment_type,
      applyUrl: job.absolute_url ?? `https://app.dover.com/apply/${slug}/${jobId}`,
      method: "dover-api",
    };
  },
};

function parseDoverUrl(url: URL): { slug: string | null; jobId: string | null } {
  const segments = url.pathname.split("/").filter(Boolean);

  // app.dover.com/apply/{slug}/{uuid}
  const applyIndex = segments.indexOf("apply");
  if (applyIndex >= 0) {
    return {
      slug: segments[applyIndex + 1] ?? null,
      jobId: segments[applyIndex + 2] ?? null,
    };
  }

  // app.dover.io/{slug}/careers/{uuid} (legacy host)
  const careersIndex = segments.indexOf("careers");
  if (careersIndex > 0) {
    return {
      slug: segments[0] ?? null,
      jobId: segments[careersIndex + 1] ?? null,
    };
  }

  // /jobs/{slug}/{uuid} or /{slug}/jobs/{uuid}
  const jobsIndex = segments.indexOf("jobs");
  if (jobsIndex >= 0) {
    if (jobsIndex === 0) {
      return { slug: segments[1] ?? null, jobId: segments[2] ?? null };
    }
    return { slug: segments[0] ?? null, jobId: segments[jobsIndex + 1] ?? null };
  }

  return { slug: null, jobId: null };
}

function remoteLabel(remote: DoverJob["remote"]): string | undefined {
  if (remote === true || remote === "only") return "Remote";
  if (remote === "hybrid") return "Hybrid";
  return undefined;
}
