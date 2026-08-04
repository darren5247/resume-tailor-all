import { fetchJson } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface PinpointPosting {
  id?: string;
  title?: string;
  url?: string;
  path?: string;
  description?: string;
  key_responsibilities?: string;
  skills_knowledge_expertise?: string;
  benefits?: string;
  employment_type?: string;
  employment_type_text?: string;
  location?: { city?: string; name?: string; province?: string };
  job?: { company?: { name?: string } };
}

interface PinpointFeed {
  data?: PinpointPosting[];
}

/**
 * Pinpoint boards expose every public posting — full HTML sections included —
 * at `/postings.json` with no auth.
 */
export const pinpointAdapter: Adapter = {
  id: "pinpoint",

  match(url) {
    return url.host.endsWith("pinpointhq.com");
  },

  async fetch(url, ctx) {
    if (url.host.startsWith("app.") || url.host.startsWith("api.")) return null;

    const slug = boardSlug(url);
    if (!slug) return null;

    const feed = await fetchJson<PinpointFeed | PinpointPosting[]>(
      `https://${slug}.pinpointhq.com/postings.json`,
      {
        signal: ctx.signal,
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      },
    );

    const postings = Array.isArray(feed) ? feed : feed?.data;
    if (!postings?.length) return null;

    const marker = postingMarker(url);
    const posting = marker
      ? postings.find((entry) => matchesPosting(entry, marker))
      : null;
    // Board URLs without a posting id are not a single JD.
    if (!posting) return null;

    const text = normalizeWhitespace(
      [posting.description, posting.key_responsibilities, posting.skills_knowledge_expertise, posting.benefits]
        .filter(Boolean)
        .map((part) => htmlToText(part!))
        .join("\n\n"),
    );
    if (!text) return null;

    return {
      text,
      title: posting.title?.trim(),
      company: posting.job?.company?.name ?? slug,
      location: [posting.location?.name, posting.location?.city, posting.location?.province]
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index)
        .join(", ") || undefined,
      employmentType: posting.employment_type_text ?? posting.employment_type,
      applyUrl: posting.url,
      method: "pinpoint-api",
    };
  },
};

function boardSlug(url: URL): string | null {
  // {slug}.pinpointhq.com/...
  if (url.host.endsWith(".pinpointhq.com") && !url.host.startsWith("apply.") && !url.host.startsWith("www.")) {
    const slug = url.host.split(".")[0];
    return slug && slug !== "pinpointhq" ? slug : null;
  }
  // apply.pinpointhq.com/en/companies/{slug}/...
  const segments = url.pathname.split("/").filter(Boolean);
  const companiesIndex = segments.indexOf("companies");
  if (companiesIndex >= 0) return segments[companiesIndex + 1] ?? null;
  return null;
}

function postingMarker(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  const postingsIndex = segments.indexOf("postings");
  if (postingsIndex >= 0) return segments[postingsIndex + 1] ?? null;
  // Some boards use /jobs/{uuid}
  const jobsIndex = segments.indexOf("jobs");
  if (jobsIndex >= 0) return segments[jobsIndex + 1] ?? null;
  return null;
}

function matchesPosting(posting: PinpointPosting, marker: string): boolean {
  if (posting.id === marker) return true;
  if (posting.path?.includes(marker)) return true;
  if (posting.url?.includes(marker)) return true;
  return false;
}
