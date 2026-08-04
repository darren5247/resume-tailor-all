import type { TemplateId } from "../settings-schema";

/**
 * Visual contract shared by the DOCX renderer and the HTML preview.
 * Layout variants stay single-column: ATS parsers still see normal paragraphs.
 */
export type TemplateLayout = "standard" | "band" | "timeline" | "cards";

export interface TemplateStyle {
  id: TemplateId;
  layout: TemplateLayout;
  bodyFont: string;
  headingFont: string;
  /** Hex without the leading hash (docx convention). */
  accent: string;
  nameColor: string;
  bodyColor: string;
  mutedColor: string;
  /** Band / card tint; falls back to accent when unused. */
  surface: string;
  nameSizePt: number;
  headlineSizePt: number;
  headingSizePt: number;
  bodySizePt: number;
  centerHeader: boolean;
  headingRule: boolean;
  headingRuleFullWidth: boolean;
  headerRule: boolean;
  sectionSpaceBefore: number;
  lineSpacing: number;
}

const BASE = {
  bodyColor: "1A1A1A",
  mutedColor: "4A4A4A",
  headlineSizePt: 10.5,
  headingSizePt: 10.5,
  bodySizePt: 10,
  sectionSpaceBefore: 220,
  lineSpacing: 264,
  surface: "FFFFFF",
} as const;

export const TEMPLATE_STYLES: Record<TemplateId, TemplateStyle> = {
  "bold-accent": {
    ...BASE,
    id: "bold-accent",
    layout: "band",
    bodyFont: "Calibri",
    headingFont: "Calibri",
    accent: "0F766E",
    surface: "0F766E",
    nameColor: "FFFFFF",
    nameSizePt: 22,
    centerHeader: false,
    headingRule: true,
    headingRuleFullWidth: true,
    headerRule: false,
  },
  "midnight-navy": {
    ...BASE,
    id: "midnight-navy",
    layout: "band",
    bodyFont: "Calibri",
    headingFont: "Calibri",
    accent: "1E3A5F",
    /** Deeper band than the section accent so the header reads as a solid masthead. */
    surface: "132A47",
    nameColor: "FFFFFF",
    bodyColor: "15202B",
    mutedColor: "5A6A7A",
    nameSizePt: 19.5,
    headlineSizePt: 9.75,
    headingSizePt: 9,
    bodySizePt: 9.25,
    centerHeader: false,
    headingRule: true,
    headingRuleFullWidth: true,
    headerRule: false,
    /** Compact section gaps — long senior resumes should avoid orphan page-2 tails. */
    sectionSpaceBefore: 130,
    /** ~single line (240 = 1.0×) keeps bullets dense without colliding. */
    lineSpacing: 230,
  },
  "classic-serif": {
    ...BASE,
    id: "classic-serif",
    layout: "standard",
    bodyFont: "Times New Roman",
    headingFont: "Times New Roman",
    accent: "000000",
    nameColor: "000000",
    nameSizePt: 20,
    centerHeader: true,
    headingRule: true,
    headingRuleFullWidth: true,
    headerRule: true,
  },
  "executive-slate": {
    ...BASE,
    id: "executive-slate",
    layout: "standard",
    bodyFont: "Calibri",
    headingFont: "Georgia",
    accent: "1E293B",
    surface: "F1F5F9",
    nameColor: "0F172A",
    mutedColor: "64748B",
    nameSizePt: 22,
    headingSizePt: 10,
    bodySizePt: 10,
    centerHeader: false,
    headingRule: true,
    headingRuleFullWidth: true,
    headerRule: true,
    sectionSpaceBefore: 280,
    lineSpacing: 292,
  },
  "minimal-graphite": {
    ...BASE,
    id: "minimal-graphite",
    layout: "standard",
    bodyFont: "Arial",
    headingFont: "Arial",
    accent: "333333",
    nameColor: "111111",
    nameSizePt: 19,
    centerHeader: false,
    headingRule: false,
    headingRuleFullWidth: false,
    headerRule: false,
    sectionSpaceBefore: 300,
    lineSpacing: 288,
  },
  "timeline-rail": {
    ...BASE,
    id: "timeline-rail",
    layout: "timeline",
    bodyFont: "Calibri",
    headingFont: "Calibri",
    accent: "1E3A5F",
    surface: "1E3A5F",
    nameColor: "0F172A",
    nameSizePt: 20,
    centerHeader: false,
    headingRule: true,
    headingRuleFullWidth: true,
    headerRule: false,
  },
  "cobalt-rail": {
    ...BASE,
    id: "cobalt-rail",
    layout: "timeline",
    bodyFont: "Calibri",
    headingFont: "Calibri",
    /** Section rules + company names — deep cobalt, not neon. */
    accent: "1E40AF",
    /** Masthead fill — slightly deeper than accent so the band reads as a solid slab. */
    surface: "172554",
    nameColor: "FFFFFF",
    bodyColor: "0F172A",
    mutedColor: "64748B",
    nameSizePt: 20,
    /** Slightly smaller than Midnight so long pipe-separated headlines wrap cleaner. */
    headlineSizePt: 9.25,
    headingSizePt: 9,
    bodySizePt: 9.25,
    centerHeader: false,
    headingRule: true,
    headingRuleFullWidth: false,
    headerRule: false,
    /** A touch more air than Midnight — rail needs room to breathe between roles. */
    sectionSpaceBefore: 155,
    lineSpacing: 236,
  },
  "boxed-cards": {
    ...BASE,
    id: "boxed-cards",
    layout: "cards",
    bodyFont: "Calibri",
    headingFont: "Calibri",
    accent: "475569",
    surface: "F8FAFC",
    nameColor: "0F172A",
    nameSizePt: 20,
    centerHeader: false,
    headingRule: true,
    headingRuleFullWidth: true,
    headerRule: true,
  },
  "emerald-cards": {
    ...BASE,
    id: "emerald-cards",
    layout: "cards",
    bodyFont: "Calibri",
    headingFont: "Calibri",
    accent: "047857",
    surface: "ECFDF5",
    nameColor: "064E3B",
    nameSizePt: 20,
    centerHeader: false,
    headingRule: true,
    headingRuleFullWidth: true,
    headerRule: false,
  },
};

export function templateStyle(id: TemplateId): TemplateStyle {
  return TEMPLATE_STYLES[id] ?? TEMPLATE_STYLES["bold-accent"];
}

/** CSS-friendly #rrggbb from the docx hex. */
export function hex(color: string): string {
  return color.startsWith("#") ? color : `#${color}`;
}

/** Company accent + split role/location — easier to scan than italic meta on one line. */
export function usesClearHierarchy(style: TemplateStyle): boolean {
  return style.id === "executive-slate" || style.id === "midnight-navy" || style.id === "cobalt-rail";
}

export function isMidnightNavy(style: TemplateStyle): boolean {
  return style.id === "midnight-navy";
}

export function isCobaltRail(style: TemplateStyle): boolean {
  return style.id === "cobalt-rail";
}

/** Dense type scale + tighter vertical rhythm (Midnight Navy, Cobalt Rail). */
export function usesCompactRhythm(style: TemplateStyle): boolean {
  return style.id === "midnight-navy" || style.id === "cobalt-rail";
}

/**
 * Timeline rail sits in a content gutter beside experience only — page margins
 * stay normal so the masthead/summary/skills keep full measure (avoids headline widows).
 */
export function timelineGutterPt(style: TemplateStyle): number {
  if (style.layout !== "timeline") return 0;
  return isCobaltRail(style) ? 14 : 12;
}

/** Vertical rail / dots — lighter than section accent so chronology ≠ hierarchy. */
export function railColor(style: TemplateStyle): string {
  if (isCobaltRail(style)) return "3B82F6";
  return style.accent;
}

/** Masthead underline for navy/cobalt band templates. */
export function bandEdgeColor(style: TemplateStyle): string | undefined {
  if (isMidnightNavy(style)) return "3D5A80";
  if (isCobaltRail(style)) return "60A5FA";
  return undefined;
}

/** On-band secondary text (headline). */
export function bandHeadlineColor(style: TemplateStyle): string {
  if (isCobaltRail(style)) return "BFDBFE";
  if (usesCompactRhythm(style)) return "CBD5E1";
  return "E2E8F0";
}

/** On-band tertiary text (contact). */
export function bandContactColor(style: TemplateStyle): string {
  if (isCobaltRail(style)) return "93C5FD";
  if (usesCompactRhythm(style)) return "94A3B8";
  return "CBD5E1";
}

/**
 * Contact lines for headers: location/phone/email on the first line, profile URLs
 * on their own lines so long LinkedIn paths wrap cleanly.
 */
export function formatContactLines(parts: string[]): string[] {
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  const urls: string[] = [];
  const rest: string[] = [];
  for (const part of cleaned) {
    if (/^https?:\/\//i.test(part) || /linkedin\.com/i.test(part) || /github\.com/i.test(part)) {
      urls.push(part.replace(/^https?:\/\//i, ""));
    } else {
      rest.push(part);
    }
  }

  const lines: string[] = [];
  if (rest.length > 0) lines.push(rest.join("  ·  "));
  for (const url of urls) lines.push(url);
  return lines;
}
