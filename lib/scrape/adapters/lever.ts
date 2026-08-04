import { fetchJson } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

interface LeverPosting {
  text?: string;
  description?: string;
  descriptionPlain?: string;
  additional?: string;
  additionalPlain?: string;
  lists?: { text?: string; content?: string }[];
  categories?: { location?: string; team?: string; commitment?: string };
  hostedUrl?: string;
}

export const leverAdapter: Adapter = {
  id: "lever",

  match(url) {
    return url.host.endsWith("lever.co");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    const [company, postingId] = segments;
    if (!company || !postingId) return null;

    const posting = await fetchJson<LeverPosting>(
      `https://api.lever.co/v0/postings/${encodeURIComponent(company)}/${encodeURIComponent(postingId)}`,
      { signal: ctx.signal },
    );
    if (!posting) return null;

    // Lever splits the JD into an intro plus titled lists; stitch them back together.
    const parts = [posting.descriptionPlain ?? htmlToText(posting.description ?? "")];
    for (const list of posting.lists ?? []) {
      if (list.text) parts.push(`\n${list.text}`);
      if (list.content) parts.push(htmlToText(list.content));
    }
    parts.push(posting.additionalPlain ?? htmlToText(posting.additional ?? ""));

    const text = normalizeWhitespace(parts.filter(Boolean).join("\n"));
    if (!text) return null;

    return {
      text,
      title: posting.text,
      company,
      location: posting.categories?.location,
      employmentType: posting.categories?.commitment,
      applyUrl: posting.hostedUrl,
      method: "lever-api",
    };
  },
};
