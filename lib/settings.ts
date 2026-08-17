import { DEFAULT_OUTPUT_DIR, isEphemeralRuntime, resolveOutputDir } from "./paths";
import { persistLoadSettings, persistSaveSettings } from "./persist";
import { SettingsSchema, TEMPLATE_IDS, migrateSettingsInput, type Settings } from "./settings-schema";

export { SettingsSchema, TEMPLATES, TEMPLATE_IDS } from "./settings-schema";
export type { Settings, TemplateId } from "./settings-schema";

export function defaultSettings(): Settings {
  return { ...SettingsSchema.parse({}), outputDir: DEFAULT_OUTPUT_DIR };
}

/** OpenRouter keys are OpenAI-compatible but must hit openrouter.ai, not api.openai.com. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function looksLikeOpenRouterKey(apiKey: string): boolean {
  return apiKey.startsWith("sk-or-");
}

/** Fill in a provider base URL when the key implies one and nothing else was set. */
export function resolveBaseUrl(settings: Pick<Settings, "apiKey" | "baseUrl">): string {
  if (settings.baseUrl.trim()) return settings.baseUrl.trim();
  if (looksLikeOpenRouterKey(settings.apiKey)) return OPENROUTER_BASE_URL;
  return "";
}

export async function loadSettings(): Promise<Settings> {
  const stored = await persistLoadSettings();
  // Unknown / removed template ids fall back to the default rather than wiping settings.
  if (stored && typeof stored.template === "string" && !(TEMPLATE_IDS as readonly string[]).includes(stored.template)) {
    delete stored.template;
  }
  const parsed = SettingsSchema.safeParse(migrateSettingsInput(stored));
  const settings = parsed.success ? parsed.data : defaultSettings();

  // An env key wins only when nothing was saved, so the UI stays the source of truth.
  if (!settings.apiKey && process.env.OPENAI_API_KEY) {
    settings.apiKey = process.env.OPENAI_API_KEY;
  }
  if (!settings.baseUrl && process.env.OPENAI_BASE_URL) {
    settings.baseUrl = process.env.OPENAI_BASE_URL;
  }
  settings.baseUrl = resolveBaseUrl(settings);
  settings.outputDir = resolveOutputDir(settings.outputDir);
  if (!settings.googleSheetUrl && (process.env.GOOGLE_SHEET_URL || process.env.GOOGLE_SHEET_ID)) {
    settings.googleSheetUrl = (process.env.GOOGLE_SHEET_URL || process.env.GOOGLE_SHEET_ID || "").trim();
  }
  if (!settings.googleSheetTab && process.env.GOOGLE_SHEET_TAB) {
    settings.googleSheetTab = process.env.GOOGLE_SHEET_TAB.trim();
  }
  if (!settings.googleServiceAccountJson && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    settings.googleServiceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  }
  return settings;
}

export async function saveSettings(next: Settings): Promise<Settings> {
  const parsed = SettingsSchema.parse(next);
  // Persist the inferred provider URL so Settings shows what will actually be used.
  if (!parsed.baseUrl.trim() && looksLikeOpenRouterKey(parsed.apiKey)) {
    parsed.baseUrl = OPENROUTER_BASE_URL;
  }

  // Vercel cannot create `D:\…\output`. Keep the stored local folder in Postgres
  // so a later desktop run still writes there; this process uses /tmp instead.
  if (isEphemeralRuntime()) {
    const stored = await persistLoadSettings();
    parsed.outputDir = typeof stored?.outputDir === "string" ? stored.outputDir : "";
    await persistSaveSettings(parsed);
    parsed.outputDir = DEFAULT_OUTPUT_DIR;
    return parsed;
  }

  parsed.outputDir = resolveOutputDir(parsed.outputDir);
  await persistSaveSettings(parsed);
  return parsed;
}

/** Never ship the raw key to the browser; the UI only needs to know one exists. */
export function redactSettings(settings: Settings) {
  let googleEmail = "";
  try {
    const parsed = JSON.parse(settings.googleServiceAccountJson) as { client_email?: unknown };
    if (typeof parsed.client_email === "string") googleEmail = parsed.client_email;
  } catch {
    googleEmail = "";
  }
  return {
    ...settings,
    apiKey: settings.apiKey ? `sk-...${settings.apiKey.slice(-4)}` : "",
    hasApiKey: Boolean(settings.apiKey),
    apiKeyFromEnv: !!process.env.OPENAI_API_KEY,
    googleServiceAccountJson: "",
    hasGoogleServiceAccount: Boolean(settings.googleServiceAccountJson),
    googleServiceAccountEmail: googleEmail,
    googleServiceAccountFromEnv: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    outputDirLocked: isEphemeralRuntime(),
  };
}
