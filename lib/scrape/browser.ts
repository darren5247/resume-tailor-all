import type { Browser } from "playwright";

let browserPromise: Promise<Browser | null> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let leases = 0;

const IDLE_SHUTDOWN_MS = 60_000;

/**
 * Chromium is only started when the HTTP rungs have already failed, and it is
 * shared across the whole run. If Playwright is not installed the caller simply
 * loses this rung rather than the run.
 */
async function launch(): Promise<Browser | null> {
  try {
    const { chromium } = await import("playwright");
    return await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  } catch {
    return null;
  }
}

export async function withPage<T>(
  handler: (page: import("playwright").Page) => Promise<T>,
): Promise<T | null> {
  browserPromise ??= launch();
  const browser = await browserPromise;
  if (!browser) return null;

  leases += 1;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1366, height: 900 },
  });

  try {
    const page = await context.newPage();
    // Images and fonts are pure cost when all we want is the text.
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "font" || type === "media") return route.abort();
      return route.continue();
    });
    return await handler(page);
  } finally {
    await context.close().catch(() => undefined);
    leases -= 1;
    if (leases === 0) scheduleShutdown();
  }
}

function scheduleShutdown() {
  idleTimer = setTimeout(async () => {
    if (leases > 0) return;
    const pending = browserPromise;
    browserPromise = null;
    const browser = await pending;
    await browser?.close().catch(() => undefined);
  }, IDLE_SHUTDOWN_MS);
  idleTimer.unref?.();
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  const browser = await pending;
  await browser?.close().catch(() => undefined);
}

export async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await import("playwright");
    return true;
  } catch {
    return false;
  }
}
