import { DEFAULT_OUTPUT_DIR, SETTINGS_FILE, readJson, writeJson } from "./paths";
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
  const stored = await readJson<Record<string, unknown>>(SETTINGS_FILE);
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
  if (!settings.outputDir) settings.outputDir = DEFAULT_OUTPUT_DIR;
  return settings;
}

export async function saveSettings(next: Settings): Promise<Settings> {
  const parsed = SettingsSchema.parse(next);
  if (!parsed.outputDir) parsed.outputDir = DEFAULT_OUTPUT_DIR;
  // Persist the inferred provider URL so Settings shows what will actually be used.
  if (!parsed.baseUrl.trim() && looksLikeOpenRouterKey(parsed.apiKey)) {
    parsed.baseUrl = OPENROUTER_BASE_URL;
  }
  await writeJson(SETTINGS_FILE, parsed);
  return parsed;
}

/** Never ship the raw key to the browser; the UI only needs to know one exists. */
export function redactSettings(settings: Settings) {
  return {
    ...settings,
    apiKey: settings.apiKey ? `sk-...${settings.apiKey.slice(-4)}` : "",
    hasApiKey: Boolean(settings.apiKey),
    apiKeyFromEnv: !!process.env.OPENAI_API_KEY,
  };
}
