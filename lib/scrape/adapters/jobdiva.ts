import * as cheerio from "cheerio";
import { htmlToText } from "../html";
import { politeFetch } from "../http";
import type { Adapter, JdSource, ScrapeContext } from "../types";

/**
 * JobDiva candidate portals are React shells at `/portal/?a=<token>#/jobs/<id>/`.
 * The served HTML is a loader, the REST API behind it answers 401 without a
 * portal session, and the legacy `openjob_outside.jsp` link now redirects back
 * to the shell. What is still open is the portal's own RSS feed, which carries
 * the full description of every recent opening on the same `a` token.
 *
 * The feed is newest-first with no way to ask for one job, so we widen the
 * window once before giving up rather than pulling thousands of postings for
 * every link.
 */
const FEED_SIZES = [300, 1200];

/**
 * One feed covers every job on a portal, and a pasted list is usually many jobs
 * from the same one, so a run of 30 links should not download the same 2MB
 * thirty times. Short-lived because a long-running server would otherwise miss
 * postings added after the first lookup.
 */
const FEED_TTL_MS = 5 * 60 * 1000;
const feedCache = new Map<string, { at: number; feed: Promise<string | null> }>();

export const jobdivaAdapter: Adapter = {
  id: "jobdiva",

  match(url) {
    if (!/(?:^|\.)(?:jobdiva\.(?:com|co\.uk)|jobssos\.com)$/i.test(url.host)) return false;
    return !!(readToken(url) && readJobId(url));
  },

  async fetch(url, ctx) {
    const token = readToken(url);
    const jobId = readJobId(url);
    if (!token || !jobId) return null;

    for (const [index, size] of FEED_SIZES.entries()) {
      ctx.onProgress?.(index === 0 ? "Fetching JobDiva feed" : "Widening JobDiva feed window");

      const feed = await fetchFeed(url.host, token, size, ctx);
      if (!feed) return null;

      const $ = cheerio.load(feed, { xml: true });
      const source = findPosting($, jobId, url);
      if (source) return source;

      // A short feed already held every opening this portal has.
      if ($("item").length < size) return null;
    }
    return null;
  },
};

function fetchFeed(host: string, token: string, size: number, ctx: ScrapeContext): Promise<string | null> {
  const key = `${host}|${token}|${size}`;
  const cached = feedCache.get(key);
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached.feed;

  const feed = requestFeed(host, token, size, ctx).catch(() => {
    feedCache.delete(key);
    return null;
  });
  feedCache.set(key, { at: Date.now(), feed });
  return feed;
}

async function requestFeed(
  host: string,
  token: string,
  size: number,
  ctx: ScrapeContext,
): Promise<string | null> {
  const target = `https://${host}/candidates/myjobs/getjobsrssfeed.jsp?${new URLSearchParams({
    a: token,
    noofjobs: String(size),
    SearchString: "",
    versionid: "2",
  })}`;

  const response = await politeFetch(target, {
    signal: ctx.signal,
    retries: 1,
    accept: "application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
  });
  return response.ok ? response.body : null;
}

function findPosting($: cheerio.CheerioAPI, jobId: string, url: URL): JdSource | null {
  for (const item of $("item").toArray()) {
    const link = $(item).find("link").first().text();
    if (!new RegExp(`[?&]id=${jobId}(?:&|$)`).test(link)) continue;

    const text = htmlToText($(item).find("description").first().text());
    if (!text) return null;

    const { title, location } = parseFeedTitle($(item).find("title").first().text());
    return {
      text,
      title,
      company: parseChannelTitle($("channel > title").first().text()),
      location,
      applyUrl: url.toString(),
      method: "jobdiva-feed",
    } satisfies JdSource;
  }
  return null;
}

/** Portal links carry the tenant token as `a`, before or after the hash. */
function readToken(url: URL): string | null {
  const fromQuery = url.searchParams.get("a");
  if (fromQuery) return fromQuery;

  const hash = url.hash.slice(1);
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(query).get("a");
}

/** `#/jobs/29004267/` on the portal, `?jobid=29004267` after a legacy redirect. */
function readJobId(url: URL): string | null {
  const fromHash = url.hash.match(/\/jobs?\/(\d+)/i);
  if (fromHash) return fromHash[1];

  const fromQuery = url.searchParams.get("jobid") ?? url.searchParams.get("id");
  return fromQuery && /^\d+$/.test(fromQuery) ? fromQuery : null;
}

/** Feed titles read "Data Engineer (26-22689) - IL - Oak Brook". */
function parseFeedTitle(raw: string): { title?: string; location?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const match = trimmed.match(/^(.*?)\s*\(\d+-\d+\)\s*(?:-\s*(.*))?$/);
  if (!match) return { title: trimmed };

  return {
    title: match[1].trim() || undefined,
    location: match[2]?.split(/\s+-\s+/).reverse().join(", ").trim() || undefined,
  };
}

function parseChannelTitle(raw: string): string | undefined {
  return raw.trim().replace(/\s+jobs$/i, "") || undefined;
}
