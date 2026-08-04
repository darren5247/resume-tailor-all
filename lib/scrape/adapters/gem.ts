import { politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter, JdSource, ScrapeContext } from "../types";

interface GemPosting {
  id?: string;
  title?: string;
  descriptionHtml?: string;
  extId?: string;
  locations?: { name?: string; city?: string; isRemote?: boolean }[];
  job?: { employmentType?: string };
  jobPostSectionHtml?: { introHtml?: string; outroHtml?: string };
  compensationHtml?: string;
}

interface GemBatchResponse {
  data?: { oatsExternalJobPosting?: GemPosting | null };
  errors?: { message?: string }[];
}

const DETAIL_QUERY = `query ExternalJobPostingQuery($boardId: String!, $extId: String!) {
  oatsExternalJobPosting(boardId: $boardId, extId: $extId) {
    id title descriptionHtml extId
    locations { name city isRemote }
    job { employmentType }
    jobPostSectionHtml { introHtml outroHtml }
    compensationHtml
  }
}`;

/**
 * Gem boards at jobs.gem.com expose a public GraphQL batch endpoint. Listings
 * omit descriptions; a second operation keyed by boardId + extId returns them.
 */
export const gemAdapter: Adapter = {
  id: "gem",

  match(url) {
    return url.host === "jobs.gem.com";
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    const [boardId, extId] = segments;
    if (!boardId || !extId) return null;

    ctx.onProgress?.(`Gem board "${boardId}"`);
    const posting = await gemDetail(boardId, extId, ctx);
    if (!posting) return null;

    const sections = posting.jobPostSectionHtml;
    const text = normalizeWhitespace(
      [sections?.introHtml, posting.descriptionHtml, sections?.outroHtml, posting.compensationHtml]
        .filter(Boolean)
        .map((part) => htmlToText(part!))
        .join("\n\n"),
    );
    if (!text) return null;

    const locations = (posting.locations ?? [])
      .map((loc) => loc.name || [loc.city, loc.isRemote ? "Remote" : ""].filter(Boolean).join(" "))
      .filter(Boolean);

    return {
      text,
      title: posting.title,
      company: boardId,
      location: locations.join(" | ") || undefined,
      employmentType: posting.job?.employmentType,
      applyUrl: url.toString(),
      method: "gem-graphql",
    } satisfies JdSource;
  },
};

async function gemDetail(boardId: string, extId: string, ctx: ScrapeContext): Promise<GemPosting | null> {
  const response = await politeFetch("https://jobs.gem.com/api/public/graphql/batch", {
    method: "POST",
    signal: ctx.signal,
    headers: { "Content-Type": "application/json", batch: "true", Accept: "application/json" },
    body: JSON.stringify([
      {
        operationName: "ExternalJobPostingQuery",
        variables: { boardId, extId },
        query: DETAIL_QUERY,
      },
    ]),
  }).catch(() => null);

  if (!response?.ok) return null;
  try {
    const payload = JSON.parse(response.body) as GemBatchResponse[];
    return payload[0]?.data?.oatsExternalJobPosting ?? null;
  } catch {
    return null;
  }
}
