/** A job description recovered from somewhere on the fallback ladder. */
export interface JdSource {
  text: string;
  title?: string;
  company?: string;
  location?: string;
  employmentType?: string;
  applyUrl?: string;
  /** Which rung of the ladder produced this, e.g. "greenhouse-api" or "jsonld". */
  method: string;
}

export interface ScrapeContext {
  /** Chromium is expensive to start, so the last rung is opt-in. */
  usePlaywright: boolean;
  signal?: AbortSignal;
  onProgress?: (note: string) => void;
}

export interface Adapter {
  id: string;
  /** Cheap URL test; a match only means "try me first", never "I will succeed". */
  match(url: URL): boolean;
  fetch(url: URL, ctx: ScrapeContext): Promise<JdSource | null>;
}

export class ScrapeError extends Error {
  constructor(message: string, readonly attempts: string[]) {
    super(message);
    this.name = "ScrapeError";
  }
}

/** Below this, whatever we found is boilerplate rather than a job description. */
export const MIN_JD_LENGTH = 400;

export function isUsable(source: JdSource | null): source is JdSource {
  return !!source && source.text.trim().length >= MIN_JD_LENGTH;
}
