import { fetchJson } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface SmartRecruitersPosting {
  name?: string;
  company?: { name?: string };
  location?: { city?: string; region?: string; country?: string };
  typeOfEmployment?: { label?: string };
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string } | undefined>;
  };
}

const SECTION_ORDER = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"];

export const smartRecruitersAdapter: Adapter = {
  id: "smartrecruiters",

  match(url) {
    return url.host.includes("smartrecruiters.com");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    // jobs.smartrecruiters.com/{Company}/{postingId}-{slug}
    const company = segments[0];
    const postingId = segments[1]?.split("-")[0];
    if (!company || !postingId || !/^\d+$/.test(postingId)) return null;

    const posting = await fetchJson<SmartRecruitersPosting>(
      `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${postingId}`,
      { signal: ctx.signal },
    );
    if (!posting?.jobAd?.sections) return null;

    const sections = posting.jobAd.sections;
    const parts: string[] = [];
    for (const key of SECTION_ORDER) {
      const section = sections[key];
      if (!section?.text) continue;
      if (section.title) parts.push(`\n${section.title}`);
      parts.push(htmlToText(section.text));
    }

    const text = normalizeWhitespace(parts.join("\n"));
    if (!text) return null;

    return {
      text,
      title: posting.name,
      company: posting.company?.name ?? company,
      location: [posting.location?.city, posting.location?.region, posting.location?.country]
        .filter(Boolean)
        .join(", "),
      employmentType: posting.typeOfEmployment?.label,
      method: "smartrecruiters-api",
    };
  },
};
