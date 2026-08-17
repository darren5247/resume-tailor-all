import { z } from "zod";

/**
 * Pure settings shape with no filesystem access, so the Settings form can share
 * exactly one definition with the server instead of restating it.
 *
 * Order matches the reference Templates tab: pick one, preview updates on the right.
 */
export const TEMPLATE_IDS = [
  "bold-accent",
  "midnight-navy",
  "classic-serif",
  "executive-slate",
  "minimal-graphite",
  "timeline-rail",
  "cobalt-rail",
  "boxed-cards",
  "emerald-cards",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TEMPLATES: { id: TemplateId; name: string; description: string }[] = [
  {
    id: "bold-accent",
    name: "Bold Accent",
    description: "Teal header band, high-contrast name. Modern default for tech roles.",
  },
  {
    id: "midnight-navy",
    name: "Midnight Navy",
    description: "Navy accent rules, Stack-style Company|Location then Role|Period place, open section spacing.",
  },
  {
    id: "classic-serif",
    name: "Classic Serif",
    description: "Centered serif headers with hairline rules. Traditional look for finance and law.",
  },
  {
    id: "executive-slate",
    name: "Executive Slate",
    description: "Georgia headings, slate bars with a left rail, and clearer role hierarchy. Senior and calm.",
  },
  {
    id: "minimal-graphite",
    name: "Minimal Graphite",
    description: "No bands or boxes, maximum ATS readability. Plain headings and generous spacing.",
  },
  {
    id: "timeline-rail",
    name: "Timeline Rail",
    description: "Midnight navy rail and dots mark each role. Clear career chronology without a header band.",
  },
  {
    id: "cobalt-rail",
    name: "Cobalt Rail",
    description: "Career rail beside experience only, cobalt accents, compact senior type. No header band.",
  },
  {
    id: "boxed-cards",
    name: "Boxed Cards",
    description: "Outlined cards for each experience entry. Separates roles without breaking the single column.",
  },
  {
    id: "emerald-cards",
    name: "Emerald Cards",
    description: "A softer emerald version of the boxed card layout. Light tint, same ATS-safe flow.",
  },
];

export const SettingsSchema = z.object({
  apiKey: z.string().default(""),
  model: z.string().default("gpt-4.1"),
  baseUrl: z.string().default(""),
  concurrency: z.number().int().min(1).max(20).default(10),
  outputDir: z.string().default(""),
  language: z.string().default("English"),
  template: z.enum(TEMPLATE_IDS).default("bold-accent"),
  includeCoverLetter: z.boolean().default(true),
  usePlaywrightFallback: z.boolean().default(true),
  googleSheetUrl: z.string().default(""),
  googleSheetTab: z.string().default(""),
  googleServiceAccountJson: z.string().default(""),
});

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Strip legacy bullet-count fields from settings. Those now live on the profile.
 */
export function migrateSettingsInput(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const stored = { ...(raw ?? {}) };
  delete stored.maxBulletsPerRole;
  delete stored.bulletsPerCompany;
  return stored;
}

/** Read a legacy bullets array from raw settings (before stripping). */
export function legacyBulletsPerCompany(
  raw: Record<string, unknown> | null | undefined,
): [number, number, number] | null {
  if (!raw) return null;
  if (Array.isArray(raw.bulletsPerCompany) && raw.bulletsPerCompany.length >= 3) {
    const tuple = raw.bulletsPerCompany.slice(0, 3).map((n) => {
      const value = typeof n === "number" ? n : Number(n);
      return Math.min(20, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
    });
    return [tuple[0], tuple[1], tuple[2]];
  }
  if (typeof raw.maxBulletsPerRole === "number") {
    const n = Math.min(20, Math.max(1, Math.round(raw.maxBulletsPerRole)));
    return [n, Math.max(1, n - 1), Math.max(1, n - 2)];
  }
  return null;
}