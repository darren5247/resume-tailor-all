/**
 * URL handling with no adapter or Node dependencies, so the browser can count
 * and validate links with exactly the same rules the server applies.
 */

/** Sites that gate every request behind a login or bot wall. */
const KNOWN_BLOCKED = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "dice.com",
  "monster.com",
];

/** A schemeless line only counts as a URL if it starts with a real hostname. */
const SCHEMELESS_HOST = /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/;

export function normalizeUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasScheme = /^https?:\/\//i.test(trimmed);
  if (!hasScheme && !SCHEMELESS_HOST.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

export function hostLabel(url: URL): string {
  return url.host.replace(/^www\./, "");
}

export function isKnownBlocked(url: URL): boolean {
  return KNOWN_BLOCKED.some((host) => url.host.endsWith(host));
}

/** Split a textarea into unique, valid URLs while preserving the pasted order. */
export function parseUrlList(input: string): { urls: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const urls: string[] = [];
  const invalid: string[] = [];

  for (const line of input.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const url = normalizeUrl(trimmed);
    if (!url) {
      invalid.push(trimmed);
      continue;
    }
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(key);
  }

  return { urls, invalid };
}
