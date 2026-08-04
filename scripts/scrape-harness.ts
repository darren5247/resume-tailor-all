/**
 * Scrape-only harness. Exercises the full fallback ladder against real URLs
 * without spending a single token, which is the fastest way to find out that an
 * ATS changed a URL shape.
 *
 *   npm run scrape -- urls.txt
 *   npm run scrape -- https://jobs.lever.co/acme/1234 https://...
 *   npm run scrape -- urls.txt --no-browser --show
 */
import fs from "node:fs/promises";
import { closeBrowser } from "../lib/scrape/browser";
import { inspectUrl, parseUrlList } from "../lib/scrape/detect";
import { fetchJobDescription } from "../lib/scrape/fetchJd";
import { ScrapeError } from "../lib/scrape/types";

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const inputs = args.filter((arg) => !arg.startsWith("--"));

  if (inputs.length === 0) {
    console.error("Usage: npm run scrape -- <urls.txt | url...> [--no-browser] [--show]");
    process.exit(1);
  }

  const raw: string[] = [];
  for (const input of inputs) {
    if (input.startsWith("http")) raw.push(input);
    else raw.push(await fs.readFile(input, "utf8"));
  }

  const { urls } = parseUrlList(raw.join("\n"));
  const usePlaywright = !flags.has("--no-browser");
  console.log(`${urls.length} URLs · Chromium fallback ${usePlaywright ? "on" : "off"}\n`);

  let ok = 0;
  const failures: { url: string; reason: string; attempts: string[] }[] = [];
  const methodCounts = new Map<string, number>();

  for (const [index, url] of urls.entries()) {
    const label = `${String(index + 1).padStart(3)}/${urls.length}`;
    const adapter = inspectUrl(url)?.adapterId ?? "-";
    const started = Date.now();

    try {
      const source = await fetchJobDescription(url, { usePlaywright });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      ok += 1;
      methodCounts.set(source.method, (methodCounts.get(source.method) ?? 0) + 1);

      console.log(
        `${label} OK   ${source.method.padEnd(22)} ${String(source.text.length).padStart(6)} chars  ${elapsed}s  ${
          source.title ?? "(no title)"
        }`,
      );
      if (flags.has("--show")) console.log(`${source.text.slice(0, 600)}\n---`);
    } catch (error) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ url, reason, attempts: error instanceof ScrapeError ? error.attempts : [] });
      console.log(`${label} FAIL ${adapter.padEnd(22)} ${" ".repeat(12)} ${elapsed}s  ${reason}`);
    }
  }

  console.log(`\n${ok}/${urls.length} succeeded`);
  for (const [method, count] of [...methodCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${method}`);
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} failed:`);
    for (const failure of failures) {
      console.log(`\n  ${failure.url}\n    ${failure.reason}`);
      for (const attempt of failure.attempts) console.log(`      - ${attempt}`);
    }
  }

  await closeBrowser();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
