import { fetchJson } from "../http";
import { normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface JoinJob {
  id?: number | string;
  title?: string;
  description?: string | null;
  intro?: string | null;
  tasks?: string | null;
  requirements?: string | null;
  benefits?: string | null;
  outro?: string | null;
  status?: string;
  companyName?: string;
  company?: { name?: string; id?: number };
  city?: string;
  countryCode?: string;
  workplaceType?: string;
  employmentType?: string;
  contactName?: string;
}

/**
 * JOIN (join.com) publishes unauthenticated job detail JSON at
 * `/api/public/jobs/{id}`. Company career URLs embed the numeric id.
 */
export const joinAdapter: Adapter = {
  id: "join",

  match(url) {
    return url.host === "join.com" || url.host.endsWith(".join.com");
  },

  async fetch(url, ctx) {
    if (url.host !== "join.com") return null;

    const jobId = extractJobId(url);
    if (!jobId) return null;

    const job = await fetchJson<JoinJob>(`https://join.com/api/public/jobs/${encodeURIComponent(jobId)}`, {
      signal: ctx.signal,
      headers: { Accept: "application/json" },
    });
    if (!job || (job.status && job.status !== "ONLINE" && !job.title)) return null;

    const text = composeDescription(job);
    if (!text) return null;

    return {
      text,
      title: job.title,
      company: job.companyName ?? job.company?.name,
      location: [job.city, job.countryCode, job.workplaceType].filter(Boolean).join(", ") || undefined,
      employmentType: job.employmentType,
      applyUrl: url.toString(),
      method: "join-api",
    };
  },
};

function extractJobId(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  const jobsIndex = segments.indexOf("jobs");
  if (jobsIndex >= 0) {
    const raw = segments[jobsIndex + 1] ?? "";
    const match = raw.match(/^(\d+)/);
    if (match) return match[1];
  }
  // Fallback: any path segment that is purely numeric and long enough.
  const numeric = segments.find((segment) => /^\d{5,}$/.test(segment));
  return numeric ?? null;
}

function composeDescription(job: JoinJob): string {
  if (job.description?.trim()) return normalizeWhitespace(job.description);

  const parts: string[] = [];
  if (job.intro) parts.push(job.intro);
  if (job.tasks) parts.push(`## Tasks\n\n${job.tasks}`);
  if (job.requirements) parts.push(`## Requirements\n\n${job.requirements}`);
  if (job.benefits) parts.push(`## Benefits\n\n${job.benefits}`);
  if (job.outro) parts.push(job.outro);
  return normalizeWhitespace(parts.join("\n\n"));
}
