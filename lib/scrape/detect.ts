import { detectAdapter } from "./adapters";
import { hostLabel, normalizeUrl } from "./url";

export { isKnownBlocked, normalizeUrl, parseUrlList } from "./url";

export interface UrlInfo {
  url: URL;
  host: string;
  /** Short label shown on the job card, e.g. "job-boards.greenhouse.io". */
  label: string;
  adapterId: string | null;
}

export function inspectUrl(raw: string): UrlInfo | null {
  const url = normalizeUrl(raw);
  if (!url) return null;

  return {
    url,
    host: url.host,
    label: hostLabel(url),
    adapterId: detectAdapter(url)?.id ?? null,
  };
}
