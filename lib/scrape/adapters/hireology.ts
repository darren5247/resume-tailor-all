import { fetchJson, politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter, ScrapeContext } from "../types";

interface HireologyJob {
  id?: number | string;
  name?: string;
  job_description?: string;
  employment_status?: string;
  remote?: boolean;
  career_site_url?: string;
  organization?: { name?: string };
  locations?: { address?: string; city?: string; state?: string }[];
}

interface HireologyFeed {
  jobs?: HireologyJob[];
  data?: HireologyJob[];
}

/**
 * Hireology mints an anonymous bearer token into the careers page. With that
 * token, `/v2/public/careers/{slug}` returns full `job_description` HTML.
 */
export const hireologyAdapter: Adapter = {
  id: "hireology",

  match(url) {
    return url.host === "careers.hireology.com" || url.host.endsWith(".hireology.com");
  },

  async fetch(url, ctx) {
    if (!url.host.includes("hireology.com")) return null;

    const segments = url.pathname.split("/").filter(Boolean);
    const slug = segments[0];
    const jobId = segments.find((segment) => /^\d+$/.test(segment));
    if (!slug || !jobId) return null;

    const token = await bootstrapToken(slug, ctx);
    if (!token) return null;

    ctx.onProgress?.(`Hireology board "${slug}"`);
    const feed = await fetchJson<HireologyFeed>(
      `https://api.hireology.com/v2/public/careers/${encodeURIComponent(slug)}?page=1&page_size=100`,
      {
        signal: ctx.signal,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      },
    );

    const jobs = feed?.data ?? feed?.jobs ?? [];
    let job = jobs.find((entry) => String(entry.id) === jobId) ?? null;

    if (!job) {
      // Paginate a couple more pages when the board is large.
      for (let page = 2; page <= 8; page += 1) {
        const next = await fetchJson<HireologyFeed>(
          `https://api.hireology.com/v2/public/careers/${encodeURIComponent(slug)}?page=${page}&page_size=100`,
          {
            signal: ctx.signal,
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          },
        );
        const pageJobs = next?.data ?? next?.jobs ?? [];
        job = pageJobs.find((entry) => String(entry.id) === jobId) ?? null;
        if (job) break;
        if (pageJobs.length === 0) break;
      }
    }

    return job ? toSource(job, slug, url) : null;
  },
};

function toSource(job: HireologyJob, slug: string, url: URL) {
  const text = normalizeWhitespace(htmlToText(job.job_description ?? ""));
  if (!text) return null;

  const locations = (job.locations ?? [])
    .map((loc) => [loc.address, loc.city, loc.state].filter(Boolean).join(", "))
    .filter(Boolean);
  if (job.remote) locations.push("Remote");

  return {
    text,
    title: job.name,
    company: job.organization?.name ?? slug,
    location: locations.join(" | ") || undefined,
    employmentType: job.employment_status,
    applyUrl: job.career_site_url ?? url.toString(),
    method: "hireology-api",
  };
}

async function bootstrapToken(slug: string, ctx: ScrapeContext): Promise<string | null> {
  const response = await politeFetch(`https://careers.hireology.com/${encodeURIComponent(slug)}`, {
    signal: ctx.signal,
    retries: 1,
  }).catch(() => null);
  if (!response?.ok) return null;

  const patterns = [
    /"apiToken"\s*:\s*"([^"]+)"/,
    /apiToken\s*[:=]\s*["']([^"']+)["']/,
    /startingData\s*=\s*\{[\s\S]*?"apiToken"\s*:\s*"([^"]+)"/,
  ];
  for (const pattern of patterns) {
    const match = response.body.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
