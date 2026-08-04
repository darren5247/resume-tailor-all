import { fetchJson, politeFetch } from "../http";
import { htmlToText } from "../html";
import type { Adapter, JdSource, ScrapeContext } from "../types";

interface GreenhouseJob {
  title?: string;
  content?: string;
  absolute_url?: string;
  company_name?: string;
  location?: { name?: string };
}

/**
 * Greenhouse is the most common board in the wild and also the easiest: one
 * unauthenticated GET returns the full description. The `gh_jid` branch matters
 * just as much, because plenty of companies embed a Greenhouse board on their
 * own careers domain and the only clue is that query parameter.
 */
export const greenhouseAdapter: Adapter = {
  id: "greenhouse",

  match(url) {
    return url.host.includes("greenhouse.io") || url.searchParams.has("gh_jid");
  },

  async fetch(url, ctx) {
    const eu = url.host.includes(".eu.");
    const apiHost = eu ? "boards-api.eu.greenhouse.io" : "boards-api.greenhouse.io";

    let token: string | null = null;
    let jobId: string | null = null;

    if (url.host.includes("greenhouse.io")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const jobsIndex = segments.indexOf("jobs");
      if (jobsIndex > 0) {
        token = segments[jobsIndex - 1];
        jobId = segments[jobsIndex + 1] ?? null;
      }
      // Embedded boards: /embed/job_app?for=token&token=12345
      token ??= url.searchParams.get("for");
      jobId ??= url.searchParams.get("token") ?? url.searchParams.get("gh_jid");
    }

    jobId ??= url.searchParams.get("gh_jid");
    if (!jobId) return null;

    if (token) {
      const job = await getJob(apiHost, token, jobId, ctx);
      return job ? toSource(job, token) : null;
    }

    // A gh_jid on a company domain names the job but not the board. Company
    // careers pages render the board client side, so the token is usually
    // absent from the served HTML; guessing from the domain and letting the API
    // confirm is both cheaper and far more reliable than parsing.
    for (const candidate of await candidateTokens(url, ctx)) {
      ctx.onProgress?.(`Trying Greenhouse board "${candidate}"`);
      const job = await getJob(apiHost, candidate, jobId, ctx);
      if (job?.content) return toSource(job, candidate);
    }

    return null;
  },
};

function toSource(job: GreenhouseJob, token: string): JdSource | null {
  if (!job.content) return null;
  return {
    text: htmlToText(job.content),
    title: job.title,
    company: job.company_name ?? token,
    location: job.location?.name,
    applyUrl: job.absolute_url,
    method: "greenhouse-api",
  };
}

function getJob(
  apiHost: string,
  token: string,
  jobId: string,
  ctx: ScrapeContext,
): Promise<GreenhouseJob | null> {
  return fetchJson<GreenhouseJob>(
    `https://${apiHost}/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(jobId)}`,
    { signal: ctx.signal, retries: 1 },
  );
}

async function candidateTokens(url: URL, ctx: ScrapeContext): Promise<string[]> {
  const candidates: string[] = [];
  const add = (value: string | null | undefined) => {
    const token = value?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (token && token !== "embed" && token.length >= 2 && !candidates.includes(token)) {
      candidates.push(token);
    }
  };

  const labels = url.host.replace(/^www\./, "").split(".");
  // "careers.acme-corp.com" contributes "acme-corp", "acmecorp" and "careers".
  // "trexsolutionsllc.com" also contributes "trexsolutions" after stripping legal suffixes.
  const domain = labels.length > 2 ? labels[labels.length - 2] : labels[0];
  add(domain);
  add(domain?.replace(/-/g, ""));
  for (const stripped of stripLegalSuffixes(domain)) add(stripped);
  if (labels.length > 2) add(labels[0]);

  const fromHtml = await tokenFromHtml(url, ctx);
  // A token found in the markup is the strongest signal, so try it first.
  if (fromHtml) candidates.unshift(fromHtml);

  return candidates.slice(0, 6);
}

/** Board tokens rarely include Inc/LLC/Corp; strip them before guessing. */
function stripLegalSuffixes(domain: string | undefined): string[] {
  if (!domain) return [];
  const out: string[] = [];
  let current = domain.toLowerCase();
  // Longer suffixes first so "solutionsllc" wins over bare "llc".
  const suffixes = ["solutionsllc", "llc", "inc", "corp", "ltd", "limited", "company", "solutions"];
  for (const suffix of suffixes) {
    if (current.length > suffix.length + 2 && current.endsWith(suffix)) {
      current = current.slice(0, -suffix.length);
      out.push(current);
      out.push(current.replace(/-/g, ""));
    }
  }
  return out;
}

async function tokenFromHtml(url: URL, ctx: ScrapeContext): Promise<string | null> {
  const response = await politeFetch(url.toString(), { signal: ctx.signal, retries: 1 }).catch(() => null);
  if (!response?.ok) return null;

  const patterns = [
    /embed\/job_board(?:\/js)?\?for=([a-z0-9_-]+)/i,
    /job-boards(?:\.eu)?\.greenhouse\.io\/([a-z0-9_-]+)/i,
    /["']?(?:boardToken|board_token|boardName)["']?\s*[:=]\s*["']([a-z0-9_-]+)["']/i,
    /Grnhse\.Settings\s*=\s*\{[^}]*for\s*:\s*["']([a-z0-9_-]+)["']/i,
    /boards(?:\.eu)?\.greenhouse\.io\/([a-z0-9_-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = response.body.match(pattern);
    if (match?.[1] && match[1] !== "embed") return match[1];
  }
  return null;
}
