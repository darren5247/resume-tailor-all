import * as cheerio from "cheerio";
import { politeFetch } from "../http";
import { htmlToText, normalizeWhitespace } from "../html";
import type { Adapter } from "../types";

/** Personio publishes an XML feed of every open position instead of JSON. */
export const personioAdapter: Adapter = {
  id: "personio",

  match(url) {
    return url.host.includes("jobs.personio.");
  },

  async fetch(url, ctx) {
    const segments = url.pathname.split("/").filter(Boolean);
    const jobIndex = segments.indexOf("job");
    const jobId = jobIndex >= 0 ? segments[jobIndex + 1]?.split("-")[0] : null;
    if (!jobId) return null;

    const response = await politeFetch(`https://${url.host}/xml`, {
      signal: ctx.signal,
      accept: "application/xml,text/xml,*/*",
    }).catch(() => null);
    if (!response?.ok) return null;

    const $ = cheerio.load(response.body, { xmlMode: true });
    const position = $("position")
      .toArray()
      .find((element) => $(element).find("id").first().text().trim() === jobId);
    if (!position) return null;

    const node = $(position);
    const text = normalizeWhitespace(
      node
        .find("jobDescription")
        .toArray()
        .map((element) => {
          const entry = $(element);
          return [entry.find("name").text().trim(), htmlToText(entry.find("value").text())]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n"),
    );
    if (!text) return null;

    return {
      text,
      title: node.find("name").first().text().trim(),
      company: url.host.split(".")[0],
      location: node.find("office").first().text().trim(),
      employmentType: node.find("employmentType").first().text().trim(),
      method: "personio-xml",
    };
  },
};
