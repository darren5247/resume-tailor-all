import { htmlToText, normalizeWhitespace } from "../html";
import { politeFetch } from "../http";
import type { Adapter, JdSource, ScrapeContext } from "../types";

interface PaycomJobPosting {
  jobId?: number | string;
  jobTitle?: string;
  title?: string;
  description?: string;
  qualifications?: string;
  location?: string;
  locations?: string | string[];
  secondaryLocations?: string[] | { location?: string }[];
  positionType?: string;
  remoteType?: string;
  companyName?: string;
}

interface PaycomJobResponse {
  jobPosting?: PaycomJobPosting;
}

const DEFAULT_API_HOST = "portal-applicant-tracking.us-cent.paycomonline.net";

/**
 * Paycom career pages used to be server-rendered at ViewJobDetails. They now
 * 302 onto a portal SPA (`/portal/{clientkey}/jobs/{id}`) whose HTML is a
 * "Loading..." shell. The SPA mints an anonymous `sessionJWT` into
 * `configsFromHost` and loads the posting from the regional ATS API — the same
 * token any browser visitor uses, no login required.
 */
export const paycomAdapter: Adapter = {
  id: "paycom",

  match(url) {
    return url.host.endsWith("paycomonline.net") && /\/v4\/ats\//i.test(url.pathname);
  },

  async fetch(url, ctx) {
    const parsed = parsePaycomUrl(url);
    if (!parsed.jobId) {
      throw new Error("link points at the Paycom career board, not a single posting");
    }

    ctx.onProgress?.("Fetching Paycom career portal session");
    const page = await politeFetch(url.toString(), { signal: ctx.signal, retries: 1 });
    if (!page.ok) return null;

    const finalUrl = new URL(page.finalUrl || url.toString());
    const jobId = parsePaycomUrl(finalUrl).jobId ?? parsed.jobId;
    const jwt = readSessionJwt(page.body);
    if (!jwt) {
      throw new Error("career portal session token missing from page");
    }

    const apiBase = readApiBase(page.body);
    ctx.onProgress?.(`Fetching Paycom posting ${jobId}`);

    const origin = `${finalUrl.protocol}//${finalUrl.host}`;
    const endpoint = `${apiBase}api/ats/job-postings/${encodeURIComponent(jobId)}`;
    // The SPA sends the anonymous session JWT as Authorization with no "Bearer "
    // prefix; some gateways still expect the prefixed form.
    let lastStatus = 0;
    let lastBody = "";
    for (const authorization of [jwt, `Bearer ${jwt}`]) {
      const response = await politeFetch(endpoint, {
        signal: ctx.signal,
        retries: 1,
        accept: "application/json,text/plain,*/*",
        headers: {
          Authorization: authorization,
          Origin: origin,
          Referer: `${origin}/`,
          Locale: "en-US",
          "Translation-Highlights": "false",
          ...(page.cookie ? { Cookie: page.cookie } : {}),
        },
      }).catch((error) => {
        throw new Error(`job-postings request failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      lastStatus = response.status;
      lastBody = response.body.slice(0, 180).replace(/\s+/g, " ");
      if (!response.ok) continue;

      const job = parseJob(response.body);
      const source = job ? toSource(job, url) : null;
      if (source) return source;
    }

    if (lastBody.includes("not found")) {
      throw new Error("posting is not active on the Paycom career portal");
    }
    throw new Error(`job-postings API returned HTTP ${lastStatus || "unknown"}`);
  },
};

function parseJob(body: string): PaycomJobPosting | null {
  try {
    const data: unknown = JSON.parse(body);
    if (!data || typeof data !== "object") return null;
    if ("jobPosting" in data) {
      const nested = (data as PaycomJobResponse).jobPosting;
      return nested ?? null;
    }
    return data as PaycomJobPosting;
  } catch {
    return null;
  }
}

function parsePaycomUrl(url: URL): { jobId: string | null } {
  const params = url.searchParams;
  const jobFromQuery = params.get("job") || params.get("jobId") || params.get("jobid");
  const portal = url.pathname.match(/\/portal\/[A-Fa-f0-9]+\/jobs\/(\d+)/i);
  return { jobId: jobFromQuery || portal?.[1] || null };
}

function readSessionJwt(html: string): string | null {
  const match =
    html.match(/"sessionJWT"\s*:\s*"(eyJ[^"]+)"/) ||
    html.match(/'sessionJWT'\s*:\s*'(eyJ[^']+)'/);
  return match?.[1] || null;
}

function readApiBase(html: string): string {
  const fromConfig = html.match(/"atsPortalMantleServiceUrl"\s*:\s*"([^"]+)"/);
  if (fromConfig?.[1]) {
    const base = fromConfig[1].replace(/\\\//g, "/").replace(/\/?$/, "/");
    if (base.startsWith("https://")) return base;
  }
  const host = html.match(/https:\/\/(portal-applicant-tracking\.[a-z0-9-]+\.paycomonline\.net)\//i);
  return `https://${host?.[1] ?? DEFAULT_API_HOST}/`;
}

function toSource(job: PaycomJobPosting, url: URL): JdSource | null {
  const parts = [job.description, job.qualifications].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  const text = normalizeWhitespace(parts.map((part) => htmlToText(part)).join("\n\n"));
  if (!text) return null;

  return {
    text,
    title: (job.jobTitle || job.title)?.trim() || undefined,
    company: job.companyName?.trim() || undefined,
    location: locationOf(job),
    employmentType: [job.positionType, job.remoteType].filter(Boolean).join(" · ") || undefined,
    applyUrl: url.toString(),
    method: "paycom-api",
  };
}

function locationOf(job: PaycomJobPosting): string | undefined {
  const labels = flattenLocations([job.location, job.locations, job.secondaryLocations]);
  return [...new Set(labels)].join(" | ") || undefined;
}

function flattenLocations(values: unknown[]): string[] {
  const labels: string[] = [];
  for (const value of values) {
    if (typeof value === "string") {
      for (const part of value.split(/[;|]/)) {
        const trimmed = part.trim();
        if (trimmed) labels.push(trimmed);
      }
    } else if (Array.isArray(value)) {
      labels.push(...flattenLocations(value));
    } else if (value && typeof value === "object" && "location" in value) {
      labels.push(...flattenLocations([(value as { location?: unknown }).location]));
    }
  }
  return labels;
}
