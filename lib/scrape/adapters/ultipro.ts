import { politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

/**
 * UKG UltiPro career boards embed the full posting inside a
 * `new US.Opportunity.CandidateOpportunityDetail({...})` call on the
 * OpportunityDetail page. The listings API only returns a short BriefDescription,
 * so detail HTML is the right source for a usable JD.
 */
export const ultiproAdapter: Adapter = {
  id: "ultipro",

  match(url) {
    return /(?:^|\.)ultipro\.(?:com|ca)$/i.test(url.host) && /JobBoard/i.test(url.pathname);
  },

  async fetch(url, ctx) {
    const opportunityId = url.searchParams.get("opportunityId");
    if (!opportunityId) return null;
    if (!/\/OpportunityDetail/i.test(url.pathname)) return null;

    ctx.onProgress?.("Fetching UKG UltiPro opportunity detail");

    const response = await politeFetch(url.toString(), {
      signal: ctx.signal,
      retries: 1,
      headers: {
        // Some boards gate on an "unsupported browser" interstitial without a modern UA.
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) return null;

    const lower = response.body.toLowerCase();
    if (
      lower.includes("opportunityunavailablemessage") ||
      (lower.includes("view other opportunities") && !lower.includes("candidateopportunitydetail"))
    ) {
      return null;
    }

    const opportunity = parseOpportunityDetail(response.body);
    if (!opportunity) return null;

    const descriptionHtml = asString(opportunity.Description) || asString(opportunity.description);
    const text = normalizeWhitespace(htmlToText(descriptionHtml || ""));
    if (!text) return null;

    const locations = Array.isArray(opportunity.Locations) ? opportunity.Locations : [];
    const locationParts = locations
      .map((loc) => {
        if (!loc || typeof loc !== "object") return null;
        const address = (loc as { Address?: Record<string, unknown> }).Address ?? {};
        const city = asString(address.City);
        const state =
          asString((address.State as { Code?: string } | undefined)?.Code) ||
          asString(address.State);
        const country =
          asString((address.Country as { Code?: string } | undefined)?.Code) ||
          asString(address.Country);
        return [city, state, country].filter(Boolean).join(", ") || null;
      })
      .filter(Boolean) as string[];

    return {
      text,
      title: asString(opportunity.Title) || asString(opportunity.title) || undefined,
      company: companyFromPath(url.pathname),
      location: locationParts.join(" | ") || undefined,
      employmentType: employmentTypeFrom(opportunity),
      applyUrl: url.toString(),
      method: "ultipro-html",
    };
  },
};

function companyFromPath(pathname: string): string | undefined {
  const match = pathname.match(/\/([^/]+)\/JobBoard\//i);
  return match?.[1] || undefined;
}

function employmentTypeFrom(opportunity: Record<string, unknown>): string | undefined {
  if (typeof opportunity.FullTime === "boolean") {
    return opportunity.FullTime ? "Full-time" : "Part-time";
  }
  return asString(opportunity.JobCategoryName) || undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

const CANDIDATE_OPPORTUNITY = /new\s+US\.Opportunity\.CandidateOpportunityDetail\s*\(/i;

function parseOpportunityDetail(html: string): Record<string, unknown> | null {
  const match = CANDIDATE_OPPORTUNITY.exec(html);
  if (!match || match.index === undefined) return null;

  const braceIndex = html.indexOf("{", match.index + match[0].length);
  if (braceIndex < 0) return null;

  const payload = extractBalancedObject(html, braceIndex);
  if (!payload) return null;

  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    // Embedded object is often JS-ish: trailing commas and bare keys.
    const cleaned = payload
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    try {
      return JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractBalancedObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}
