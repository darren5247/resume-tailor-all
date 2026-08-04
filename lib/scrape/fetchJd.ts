import { detectAdapter } from "./adapters";
import { teamtailorAdapter } from "./adapters/teamtailor";
import { withPage } from "./browser";
import { isKnownBlocked } from "./detect";
import {
  extractEmbeddedJsonJob,
  extractJobFromUnknownJson,
  extractJsonLdJob,
  extractNextDataJob,
  extractReadableText,
  looksLikeJobDescription,
  normalizeWhitespace,
} from "./html";
import { politeFetch } from "./http";
import { MIN_JD_LENGTH, ScrapeError, isUsable, type JdSource, type ScrapeContext } from "./types";

/** Job descriptions past this point are navigation noise, and tokens cost money. */
const MAX_JD_CHARS = 24_000;

/**
 * The fallback ladder. Each rung is strictly more expensive and less reliable
 * than the one above it, so we stop at the first usable result.
 *
 *   1. ATS API adapter   no browser, no CAPTCHA, cleanest text
 *   2. Teamtailor-style `/jobs.json` on custom career domains
 *   3. JSON-LD JobPosting from the served HTML
 *   4. __NEXT_DATA__, embedded JSON blobs, then densest-text readability
 *   5. Chromium render (+ network JSON capture), then rungs 3 and 4 again
 */
export async function fetchJobDescription(rawUrl: string, ctx: ScrapeContext): Promise<JdSource> {
  const url = new URL(rawUrl);
  const attempts: string[] = [];

  const adapter = detectAdapter(url);
  if (adapter) {
    ctx.onProgress?.(`Trying ${adapter.id} API`);
    try {
      const result = await adapter.fetch(url, ctx);
      if (isUsable(result)) return finalize(result);
      attempts.push(`${adapter.id} API returned nothing usable`);
    } catch (error) {
      attempts.push(`${adapter.id} API failed: ${message(error)}`);
    }
  }

  // Custom domains that run Teamtailor still publish `/jobs.json` even when the
  // host is not *.teamtailor.com. Cheap JSON GET before HTML parsing.
  if (!adapter && /\/jobs\/\d+/.test(url.pathname) && !isKnownBlocked(url)) {
    ctx.onProgress?.("Trying jobs.json feed");
    try {
      const result = await teamtailorAdapter.fetch(url, ctx);
      if (isUsable(result)) return finalize(result);
      attempts.push("jobs.json feed returned nothing usable");
    } catch (error) {
      attempts.push(`jobs.json feed failed: ${message(error)}`);
    }
  }

  let html: string | null = null;
  if (!isKnownBlocked(url)) {
    ctx.onProgress?.("Fetching page HTML");
    try {
      const response = await politeFetch(url.toString(), { signal: ctx.signal });
      if (response.ok) html = response.body;
      else attempts.push(`page returned HTTP ${response.status}`);
    } catch (error) {
      attempts.push(`page fetch failed: ${message(error)}`);
    }
  } else {
    attempts.push(`${url.host} blocks automated access`);
  }

  if (html) {
    const fromHtml = extractFromHtml(html, attempts);
    if (fromHtml) return finalize(fromHtml);
  }

  if (ctx.usePlaywright) {
    ctx.onProgress?.("Rendering page in Chromium");
    try {
      const payloads: unknown[] = [];
      const rendered = await withPage(async (page) => {
        page.on("response", async (response) => {
          try {
            const type = response.headers()["content-type"] ?? "";
            if (!type.includes("json")) return;
            if (response.status() >= 400) return;
            const body = await response.text();
            if (body.length < 200 || body.length > 2_000_000) return;
            payloads.push(JSON.parse(body));
          } catch {
            // Ignore non-JSON or already-consumed bodies.
          }
        });

        await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
        // Give late XHR job payloads a moment after networkidle.
        await new Promise((resolve) => setTimeout(resolve, 800));
        return page.content();
      });

      if (rendered === null) {
        attempts.push("Chromium unavailable (run: npx playwright install chromium)");
      } else {
        for (const payload of payloads) {
          const fromNetwork = extractJobFromUnknownJson(payload, "network-json");
          if (isUsable(fromNetwork) && looksLikeJobDescription(fromNetwork.text)) {
            return finalize(fromNetwork);
          }
        }

        const fromRender = extractFromHtml(rendered, attempts, "rendered-");
        if (fromRender) return finalize(fromRender);

        if (payloads.length) {
          attempts.push(`Chromium captured ${payloads.length} JSON responses without a usable JD`);
        }
      }
    } catch (error) {
      attempts.push(`Chromium render failed: ${message(error)}`);
    }
  } else {
    attempts.push("Chromium fallback disabled in Settings");
  }

  throw new ScrapeError(
    `Could not extract a usable job description from ${url.host}. The page may require login or block scrapers.`,
    attempts,
  );
}

function extractFromHtml(html: string, attempts: string[], prefix = ""): JdSource | null {
  // JSON-LD declares itself a JobPosting, so length alone is enough. The other
  // extractors are guesses about which part of a page matters, and a guess that
  // returns a careers landing page is worse than an honest failure.
  const extractors: [string, (input: string) => JdSource | null, boolean][] = [
    ["jsonld", extractJsonLdJob, true],
    ["next-data", extractNextDataJob, false],
    ["embedded-json", extractEmbeddedJsonJob, false],
    ["readability", extractReadableText, false],
  ];

  for (const [name, extract, trusted] of extractors) {
    let result: JdSource | null = null;
    try {
      result = extract(html);
    } catch (error) {
      attempts.push(`${prefix}${name} threw: ${message(error)}`);
      continue;
    }

    const text = result ? result.text.trim() : "";
    if (!isUsable(result)) {
      attempts.push(`${prefix}${name} produced ${text.length} chars (need ${MIN_JD_LENGTH})`);
      continue;
    }
    if (!trusted && !looksLikeJobDescription(text)) {
      attempts.push(`${prefix}${name} found ${text.length} chars that do not read like a job description`);
      continue;
    }
    return { ...result, method: `${prefix}${result.method}` };
  }
  return null;
}

/** Shared exit path so pasted text and scraped text get identical treatment. */
export function finalize(source: JdSource): JdSource {
  const text = normalizeWhitespace(source.text).slice(0, MAX_JD_CHARS);
  return { ...source, text };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
