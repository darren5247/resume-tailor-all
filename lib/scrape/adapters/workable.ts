import { fetchJson } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface WorkableJob {
  title?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
  company?: { name?: string } | string;
  location?: { city?: string; country?: string; region?: string } | string;
  employmentType?: string;
  shortcode?: string;
  url?: string;
}

export const workableAdapter: Adapter = {
  id: "workable",

  match(url) {
    return url.host.includes("workable.com");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    let account: string | null = null;
    let shortcode: string | null = null;

    if (url.host.startsWith("apply.")) {
      // apply.workable.com/{account}/j/{shortcode}
      const jIndex = segments.indexOf("j");
      if (jIndex >= 0) {
        account = jIndex > 0 ? segments[jIndex - 1] : null;
        shortcode = segments[jIndex + 1] ?? null;
      }
    } else {
      // {account}.workable.com/jobs/{shortcode}
      account = url.host.split(".")[0];
      const jobsIndex = segments.indexOf("jobs");
      shortcode = jobsIndex >= 0 ? segments[jobsIndex + 1] ?? null : null;
    }

    if (!shortcode) return null;

    const direct = account
      ? [`https://apply.workable.com/api/v1/accounts/${account}/jobs/${shortcode}`]
      : [`https://apply.workable.com/api/v1/jobs/${shortcode}`];

    const candidates: (WorkableJob | null)[] = [];
    for (const endpoint of direct) {
      candidates.push(await fetchJson<WorkableJob>(endpoint, { signal: ctx.signal }));
    }

    // The public careers feed still carries the posting after the per-job
    // endpoint starts refusing it, so it is worth one more look.
    if (account && !candidates.some((entry) => entry?.description)) {
      const feed = await fetchJson<{ jobs?: WorkableJob[] }>(
        `https://www.workable.com/api/accounts/${account}?details=true`,
        { signal: ctx.signal },
      );
      candidates.push(feed?.jobs?.find((entry) => entry.shortcode === shortcode) ?? null);
    }

    for (const job of candidates) {
      if (!job?.description) continue;

      const text = normalizeWhitespace(
        [job.description, job.requirements, job.benefits]
          .filter(Boolean)
          .map((part) => htmlToText(part as string))
          .join("\n\n"),
      );
      if (!text) continue;

      return {
        text,
        title: job.title,
        company: typeof job.company === "string" ? job.company : job.company?.name ?? account ?? undefined,
        location:
          typeof job.location === "string"
            ? job.location
            : [job.location?.city, job.location?.region, job.location?.country].filter(Boolean).join(", ") ||
              undefined,
        employmentType: job.employmentType,
        applyUrl: job.url,
        method: "workable-api",
      };
    }

    return null;
  },
};
