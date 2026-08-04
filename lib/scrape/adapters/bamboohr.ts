import { fetchJson } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface BambooDetail {
  result?: {
    jobOpening?: {
      jobOpeningName?: string;
      description?: string;
      requirements?: string;
      location?: { city?: string; state?: string; country?: string };
      employmentStatusLabel?: string;
      departmentLabel?: string;
    };
  };
}

export const bambooHrAdapter: Adapter = {
  id: "bamboohr",

  match(url) {
    return url.host.endsWith("bamboohr.com");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    const careersIndex = segments.indexOf("careers");
    const jobId = careersIndex >= 0 ? segments[careersIndex + 1] : null;
    if (!jobId) return null;

    const company = url.host.split(".")[0];
    const data = await fetchJson<BambooDetail>(`https://${url.host}/careers/${jobId}/detail`, {
      signal: ctx.signal,
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    });

    const opening = data?.result?.jobOpening;
    if (!opening?.description) return null;

    const text = normalizeWhitespace(
      [opening.description, opening.requirements].filter(Boolean).map((part) => htmlToText(part!)).join("\n\n"),
    );
    if (!text) return null;

    return {
      text,
      title: opening.jobOpeningName,
      company,
      location: [opening.location?.city, opening.location?.state, opening.location?.country]
        .filter(Boolean)
        .join(", "),
      employmentType: opening.employmentStatusLabel,
      method: "bamboohr-api",
    };
  },
};
