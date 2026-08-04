import { fetchJson } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface ComeetPosition {
  uid?: string;
  name?: string;
  location?: { name?: string; city?: string; country?: string };
  department?: string;
  employment_type?: string;
  url?: string;
  details?: { name?: string; value?: string }[];
}

/**
 * Comeet URLs look like /jobs/{company}/{companyUid}/{slug}/{positionUid}.
 * The careers API is public but keyed by the company uid, which the URL carries.
 */
export const comeetAdapter: Adapter = {
  id: "comeet",

  match(url) {
    return url.host.includes("comeet.com");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    const jobsIndex = segments.indexOf("jobs");
    if (jobsIndex < 0) return null;

    const companyUid = segments[jobsIndex + 2];
    const positionUid = segments[jobsIndex + 4];
    if (!companyUid) return null;

    const positions = await fetchJson<ComeetPosition[]>(
      `https://www.comeet.co/careers-api/2.0/company/${encodeURIComponent(companyUid)}/positions?token=${encodeURIComponent(companyUid)}&details=true`,
      { signal: ctx.signal },
    );
    if (!Array.isArray(positions)) return null;

    const position =
      positions.find((entry) => entry.uid === positionUid) ??
      (positions.length === 1 ? positions[0] : undefined);
    if (!position?.details?.length) return null;

    const text = normalizeWhitespace(
      position.details
        .map((detail) => [detail.name, htmlToText(detail.value ?? "")].filter(Boolean).join("\n"))
        .join("\n\n"),
    );
    if (!text) return null;

    return {
      text,
      title: position.name,
      company: segments[jobsIndex + 1],
      location: position.location?.name ?? [position.location?.city, position.location?.country].filter(Boolean).join(", "),
      employmentType: position.employment_type,
      applyUrl: position.url,
      method: "comeet-api",
    };
  },
};
