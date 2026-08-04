import { fetchJson, politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter, JdSource, ScrapeContext } from "../types";

interface ComeetDetail {
  name?: string;
  value?: string | null;
  order?: number;
}

interface ComeetPosition {
  uid?: string;
  name?: string;
  company_name?: string;
  location?: { name?: string; city?: string; country?: string };
  department?: string;
  employment_type?: string;
  url_active_page?: string;
  url_comeet_hosted_page?: string;
  url?: string;
  details?: ComeetDetail[];
  custom_fields?: { details?: ComeetDetail[] };
}

interface ComeetCompanyData {
  company_uid?: string;
  token?: string;
  name?: string;
  slug?: string;
}

/**
 * Comeet (Spark Hire Recruit) hosted URLs look like
 * /jobs/{slug}/{companyUid}/{positionSlug}/{positionUid}.
 *
 * The Careers API needs a company token that is not the UID. Hosted pages embed
 * that token in COMPANY_DATA, and single-job pages also ship the full posting as
 * POSITION_DATA — so prefer the page bootstrap over guessing credentials.
 */
export const comeetAdapter: Adapter = {
  id: "comeet",

  match(url) {
    return url.host.includes("comeet.com") || url.host.includes("comeet.co");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    const jobsIndex = segments.indexOf("jobs");
    if (jobsIndex < 0) return null;

    const companyUidFromPath = segments[jobsIndex + 2];
    const positionUid = segments[jobsIndex + 4];
    const boardUrl = companyUidFromPath
      ? `${url.origin}/jobs/${segments[jobsIndex + 1]}/${companyUidFromPath}`
      : url.toString();

    ctx.onProgress?.("Fetching Comeet page bootstrap");
    const page = await politeFetch(url.toString(), { signal: ctx.signal });
    if (!page.ok) return null;

    const fromPosition = parsePositionData(page.body);
    if (fromPosition) return fromPosition;

    const company = parseCompanyData(page.body);
    const companyUid = company?.company_uid ?? companyUidFromPath;
    const token = company?.token;
    if (!companyUid || !token) return null;

    ctx.onProgress?.("Fetching Comeet careers API");
    const positions = await fetchJson<ComeetPosition[]>(
      `https://www.comeet.co/careers-api/2.0/company/${encodeURIComponent(companyUid)}/positions?token=${encodeURIComponent(token)}&details=true`,
      {
        signal: ctx.signal,
        headers: { Referer: boardUrl, Accept: "application/json" },
      },
    );
    if (!Array.isArray(positions)) return null;

    const position =
      positions.find((entry) => entry.uid === positionUid) ??
      (positions.length === 1 ? positions[0] : undefined);
    if (!position) return null;

    return toSource(position, company?.name ?? segments[jobsIndex + 1], "comeet-api");
  },
};

function parsePositionData(html: string): JdSource | null {
  const position = readJsonAssignment<ComeetPosition>(html, "POSITION_DATA");
  if (!position) return null;
  return toSource(position, position.company_name, "comeet-page");
}

function parseCompanyData(html: string): ComeetCompanyData | null {
  return readJsonAssignment<ComeetCompanyData>(html, "COMPANY_DATA");
}

function toSource(position: ComeetPosition, company: string | undefined, method: string): JdSource | null {
  const details = position.details ?? position.custom_fields?.details ?? [];
  const text = normalizeWhitespace(
    [...details]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((detail) => [detail.name, htmlToText(detail.value ?? "")].filter(Boolean).join("\n"))
      .filter(Boolean)
      .join("\n\n"),
  );
  if (!text) return null;

  return {
    text,
    title: position.name,
    company,
    location:
      position.location?.name ??
      [position.location?.city, position.location?.country].filter(Boolean).join(", "),
    employmentType: position.employment_type,
    applyUrl: position.url_active_page ?? position.url_comeet_hosted_page ?? position.url,
    method,
  };
}

/** Pull `NAME = {...};` (or `NAME = null;`) out of an inline script block. */
function readJsonAssignment<T>(html: string, name: string): T | null {
  const marker = `${name} = `;
  const start = html.indexOf(marker);
  if (start < 0) return null;

  let index = start + marker.length;
  while (index < html.length && /\s/.test(html[index]!)) index += 1;

  if (html.slice(index, index + 4) === "null") return null;
  if (html[index] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let cursor = index; cursor < html.length; cursor += 1) {
    const char = html[cursor]!;
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(index, cursor + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
