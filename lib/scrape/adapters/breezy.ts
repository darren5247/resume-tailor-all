import { fetchJson } from "../http";
import { htmlToText } from "../html";
import type { Adapter } from "../types";

interface BreezyPosition {
  id?: string;
  name?: string;
  description?: string;
  location?: { name?: string; city?: string; country?: { name?: string } };
  type?: { name?: string };
  url?: string;
}

export const breezyAdapter: Adapter = {
  id: "breezy",

  match(url) {
    return url.host.endsWith("breezy.hr");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    const positionIndex = segments.indexOf("p");
    const rawId = positionIndex >= 0 ? segments[positionIndex + 1] : null;
    if (!rawId) return null;

    // Breezy slugs are "{uuid}-{job-title}"; the uuid is the first five groups.
    const id = rawId.split("-").slice(0, 5).join("-");
    const positions = await fetchJson<BreezyPosition[]>(`https://${url.host}/json`, { signal: ctx.signal });
    const position = positions?.find((entry) => entry.id === id || rawId.startsWith(entry.id ?? "\u0000"));
    if (!position?.description) return null;

    const text = htmlToText(position.description);
    if (!text) return null;

    return {
      text,
      title: position.name,
      company: url.host.split(".")[0],
      location: position.location?.name ?? [position.location?.city, position.location?.country?.name].filter(Boolean).join(", "),
      employmentType: position.type?.name,
      applyUrl: position.url,
      method: "breezy-api",
    };
  },
};
