import { fetchJson } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface RecruiteeOffer {
  title?: string;
  description?: string;
  requirements?: string;
  location?: string;
  city?: string;
  country?: string;
  employment_type_code?: string;
  careers_url?: string;
  company_name?: string;
}

export const recruiteeAdapter: Adapter = {
  id: "recruitee",

  match(url) {
    return url.host.endsWith("recruitee.com");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    const offerIndex = segments.indexOf("o");
    const slug = offerIndex >= 0 ? segments[offerIndex + 1] : segments.at(-1);
    if (!slug) return null;

    const data = await fetchJson<{ offer?: RecruiteeOffer }>(
      `https://${url.host}/api/offers/${encodeURIComponent(slug)}`,
      { signal: ctx.signal },
    );
    const offer = data?.offer;
    if (!offer?.description) return null;

    const text = normalizeWhitespace(
      [offer.description, offer.requirements].filter(Boolean).map((part) => htmlToText(part!)).join("\n\n"),
    );
    if (!text) return null;

    return {
      text,
      title: offer.title,
      company: offer.company_name ?? url.host.split(".")[0],
      location: offer.location ?? [offer.city, offer.country].filter(Boolean).join(", "),
      employmentType: offer.employment_type_code,
      applyUrl: offer.careers_url,
      method: "recruitee-api",
    };
  },
};
