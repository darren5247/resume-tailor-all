const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * One in-flight request per host at a time. Thirty URLs can easily contain ten
 * Greenhouse links, and hammering a single host is how you earn a 429.
 */
const hostQueues = new Map<string, Promise<unknown>>();

function serializeByHost<T>(host: string, task: () => Promise<T>): Promise<T> {
  const previous = hostQueues.get(host) ?? Promise.resolve();
  const next = previous.then(task, task);
  hostQueues.set(
    host,
    next.catch(() => undefined),
  );
  return next;
}

export interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  retries?: number;
  /** Treat 404 as a definitive answer instead of retrying it. */
  accept?: string;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  body: string;
  finalUrl: string;
  contentType: string;
}

export async function politeFetch(url: string, options: FetchOptions = {}): Promise<HttpResponse> {
  const host = new URL(url).host;
  return serializeByHost(host, () => attempt(url, options));
}

async function attempt(url: string, options: FetchOptions): Promise<HttpResponse> {
  const retries = options.retries ?? 2;
  let lastError: unknown;

  for (let index = 0; index <= retries; index += 1) {
    if (index > 0) {
      // 600ms, then 1.8s. Enough to clear a burst limit without stalling a 30 URL run.
      await delay(600 * 3 ** (index - 1));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onExternalAbort);

    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: options.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
        body: options.body,
        redirect: "follow",
        signal: controller.signal,
      });

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && index < retries) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      return {
        ok: response.ok,
        status: response.status,
        body: await response.text(),
        finalUrl: response.url || url,
        contentType: response.headers.get("content-type") ?? "",
      };
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T | null> {
  const response = await politeFetch(url, {
    accept: "application/json,text/plain,*/*",
    ...options,
  }).catch(() => null);

  if (!response?.ok) return null;
  try {
    return JSON.parse(response.body) as T;
  } catch {
    return null;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
