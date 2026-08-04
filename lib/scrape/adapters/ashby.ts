import { fetchJson } from "../http";
import { htmlToText } from "../html";
import type { Adapter } from "../types";

interface AshbyJob {
  id?: string;
  jobId?: string;
  title?: string;
  location?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  jobUrl?: string;
  employmentType?: string;
}

/**
 * Ashby publishes the whole board rather than a single posting, so pull the
 * board and match on the id in the URL. Embedded boards on company domains only
 * expose `?ashby_jid=`; the org slug is guessed from the host the same way
 * Greenhouse guesses board tokens.
 */
export const ashbyAdapter: Adapter = {
  id: "ashby",

  match(url) {
    return url.host.includes("ashbyhq.com") || url.searchParams.has("ashby_jid");
  },

  async fetch(url, ctx) {
    let org: string | null = null;
    let jobId: string | null = url.searchParams.get("ashby_jid");

    if (url.host.includes("ashbyhq.com")) {
      const segments = url.pathname.split("/").filter(Boolean);
      org = segments[0] ?? null;
      jobId ??= segments[1] ?? null;
    } else {
      org = guessAshbyOrg(url);
    }

    if (!org || !jobId) return null;

    const board = await fetchJson<{ jobs?: AshbyJob[] }>(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`,
      { signal: ctx.signal },
    );

    const job = board?.jobs?.find((entry) => entry.id === jobId || entry.jobId === jobId);
    if (!job) return null;

    const text = job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml ?? "");
    if (!text) return null;

    return {
      text,
      title: job.title,
      company: org,
      location: job.location,
      employmentType: job.employmentType,
      applyUrl: job.jobUrl,
      method: "ashby-api",
    };
  },
};

function guessAshbyOrg(url: URL): string | null {
  const host = url.host.replace(/^www\./, "");
  const labels = host.split(".");
  if (labels.length < 2) return null;
  const domain = labels.length > 2 ? labels[labels.length - 2] : labels[0];
  return domain?.toLowerCase() || null;
}
