import type { Settings } from "../settings-schema";

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

export interface SheetConfig {
  spreadsheetId: string;
  /** Numeric gid from the URL, when present. */
  gid: number | null;
  /** Tab title from settings; empty means first sheet (or the gid). */
  tab: string;
  serviceAccount: ServiceAccount;
}

const SPREADSHEET_ID_RE = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/i;
const GID_RE = /[?&#]gid=(\d+)/i;

export function parseSpreadsheetRef(raw: string): { spreadsheetId: string; gid: number | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fromUrl = trimmed.match(SPREADSHEET_ID_RE);
  if (fromUrl) {
    const gidMatch = trimmed.match(GID_RE);
    return {
      spreadsheetId: fromUrl[1],
      gid: gidMatch ? Number(gidMatch[1]) : null,
    };
  }

  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) {
    return { spreadsheetId: trimmed, gid: null };
  }
  return null;
}

export function parseServiceAccountJson(raw: string): ServiceAccount {
  let parsed: { client_email?: unknown; private_key?: unknown };
  try {
    parsed = JSON.parse(raw) as { client_email?: unknown; private_key?: unknown };
  } catch {
    throw new Error("Service account JSON is not valid JSON.");
  }
  if (typeof parsed.client_email !== "string" || !parsed.client_email.includes("@")) {
    throw new Error("Service account JSON is missing client_email.");
  }
  if (typeof parsed.private_key !== "string" || !parsed.private_key.includes("BEGIN")) {
    throw new Error("Service account JSON is missing private_key.");
  }
  return {
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

export function serviceAccountEmail(raw: string): string {
  try {
    return parseServiceAccountJson(raw).clientEmail;
  } catch {
    return "";
  }
}

/** Settings plus env fallbacks, same pattern as the LLM key. */
export function resolveSheetSettings(settings: Settings): {
  googleSheetUrl: string;
  googleSheetTab: string;
  googleServiceAccountJson: string;
} {
  return {
    googleSheetUrl: settings.googleSheetUrl.trim() || process.env.GOOGLE_SHEET_URL?.trim() || process.env.GOOGLE_SHEET_ID?.trim() || "",
    googleSheetTab: settings.googleSheetTab.trim() || process.env.GOOGLE_SHEET_TAB?.trim() || "",
    googleServiceAccountJson:
      settings.googleServiceAccountJson.trim() || process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "",
  };
}

export function sheetConfigFromSettings(settings: Settings): SheetConfig | null {
  const resolved = resolveSheetSettings(settings);
  if (!resolved.googleSheetUrl || !resolved.googleServiceAccountJson) return null;

  const ref = parseSpreadsheetRef(resolved.googleSheetUrl);
  if (!ref) return null;

  try {
    return {
      spreadsheetId: ref.spreadsheetId,
      gid: ref.gid,
      tab: resolved.googleSheetTab,
      serviceAccount: parseServiceAccountJson(resolved.googleServiceAccountJson),
    };
  } catch {
    return null;
  }
}

export function isSheetConfigured(settings: Settings): boolean {
  return sheetConfigFromSettings(settings) !== null;
}
