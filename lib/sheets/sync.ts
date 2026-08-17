import { formatBadgeLabels, type BadgeSource } from "../pipeline/badges";
import { loadSettings, type Settings } from "../settings";
import {
  appendValues,
  deleteRows,
  getSpreadsheet,
  getValues,
  insertRows,
  updateValues,
  type SheetProperties,
} from "./api";
import { sheetConfigFromSettings, type SheetConfig } from "./config";

export interface SheetJobRow {
  url: string;
  company: string;
  role: string;
  badges: BadgeSource;
  /** Dated output folder basename, e.g. `2026-08-17_acme_senior-data-engineer`. */
  folder?: string;
}

interface Layout {
  config: SheetConfig;
  sheet: SheetProperties;
  hasHeader: boolean;
  urlCol: number;
  badgesCol: number;
  folderCol: number;
  companyCol: number;
  roleCol: number;
  rows: string[][];
}

const URL_HEADERS = /^(url|link|job\s*url|job\s*link|posting(\s*url)?|job\s*posting)$/i;
const BADGE_HEADERS = /^(badge|badges|labels?|tags?|type|hiring(\s*channel)?|channel)$/i;
const FOLDER_HEADERS = /^(folder|resume\s*folder|output\s*folder|packet|directory)$/i;
const COMPANY_HEADERS = /^(company|employer|organization|org)$/i;
const ROLE_HEADERS = /^(role|title|position|job\s*title|job)$/i;
const BADGE_TOKEN = /^(direct hire|agency|startup|hybrid|on-site)$/i;
const FOLDER_VALUE = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*$/i;

export function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let text = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    text = String.fromCharCode(65 + rem) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

function a1(title: string, col: number, row: number): string {
  return `${quoteSheetTitle(title)}!${columnLetter(col)}${row}`;
}

export function normalizeSheetUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(key)) url.searchParams.delete(key);
    }
    let href = url.toString();
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function isFolderCell(value: string): boolean {
  return FOLDER_VALUE.test(value.trim());
}

function isBadgeCell(value: string): boolean {
  const parts = value
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => BADGE_TOKEN.test(part) || /^agency\b/i.test(part));
}

function findHeaderIndex(header: string[], pattern: RegExp): number | null {
  const index = header.findIndex((cell) => {
    const text = cell.trim();
    if (!text || looksLikeUrl(text) || isBadgeCell(text) || isFolderCell(text)) return false;
    return pattern.test(text);
  });
  return index >= 0 ? index : null;
}

function pickSheet(sheets: SheetProperties[], config: SheetConfig): SheetProperties {
  if (config.tab) {
    const named = sheets.find((sheet) => sheet.title.toLowerCase() === config.tab.toLowerCase());
    if (!named) {
      const names = sheets.map((sheet) => sheet.title).join(", ");
      throw new Error(`No tab named "${config.tab}". Available: ${names}.`);
    }
    return named;
  }
  if (config.gid != null) {
    const byGid = sheets.find((sheet) => sheet.sheetId === config.gid);
    if (byGid) return byGid;
  }
  return [...sheets].sort((a, b) => a.index - b.index)[0];
}

function pinnedColumns(urlCol: number): Pick<Layout, "urlCol" | "companyCol" | "roleCol" | "badgesCol" | "folderCol"> {
  return {
    urlCol,
    companyCol: urlCol + 1,
    roleCol: urlCol + 2,
    badgesCol: urlCol + 3,
    folderCol: urlCol + 4,
  };
}

function looksLikeHeaderRow(first: string[]): boolean {
  if (first.some((cell) => looksLikeUrl(cell) || isBadgeCell(cell) || isFolderCell(cell))) return false;
  return first.some(
    (cell) =>
      URL_HEADERS.test(cell.trim()) ||
      BADGE_HEADERS.test(cell.trim()) ||
      FOLDER_HEADERS.test(cell.trim()) ||
      COMPANY_HEADERS.test(cell.trim()) ||
      ROLE_HEADERS.test(cell.trim()),
  );
}

async function loadLayout(settings?: Settings): Promise<Layout | null> {
  const resolved = settings ?? (await loadSettings());
  const config = sheetConfigFromSettings(resolved);
  if (!config) return null;

  const { sheets } = await getSpreadsheet(config.serviceAccount, config.spreadsheetId);
  const sheet = pickSheet(sheets, config);
  const rows = await getValues(
    config.serviceAccount,
    config.spreadsheetId,
    `${quoteSheetTitle(sheet.title)}!A:Z`,
  );

  if (rows.length === 0) {
    return {
      config,
      sheet,
      hasHeader: true,
      ...pinnedColumns(0),
      rows: [],
    };
  }

  const first = rows[0] ?? [];
  if (!looksLikeHeaderRow(first)) {
    const found = first.findIndex(looksLikeUrl);
    return {
      config,
      sheet,
      hasHeader: false,
      ...pinnedColumns(found >= 0 ? found : 0),
      rows,
    };
  }

  return {
    config,
    sheet,
    hasHeader: true,
    ...allocateColumns(first),
    rows,
  };
}

function allocateColumns(
  header: string[],
): Pick<Layout, "urlCol" | "badgesCol" | "folderCol" | "companyCol" | "roleCol"> {
  const urlCol = findHeaderIndex(header, URL_HEADERS) ?? 0;
  const pinned = pinnedColumns(urlCol);
  const used = new Set<number>([urlCol]);

  const take = (found: number | null, fallback: number): number => {
    if (found != null) {
      used.add(found);
      return found;
    }
    let col = fallback;
    while (used.has(col) || (header[col] ?? "").trim()) col += 1;
    used.add(col);
    return col;
  };

  return {
    urlCol,
    companyCol: take(findHeaderIndex(header, COMPANY_HEADERS), pinned.companyCol),
    roleCol: take(findHeaderIndex(header, ROLE_HEADERS), pinned.roleCol),
    badgesCol: take(findHeaderIndex(header, BADGE_HEADERS), pinned.badgesCol),
    folderCol: take(findHeaderIndex(header, FOLDER_HEADERS), pinned.folderCol),
  };
}

function matchingRowIndexes(layout: Layout, url: string): number[] {
  const target = normalizeSheetUrl(url);
  if (!target) return [];
  const start = layout.hasHeader ? 1 : 0;
  const found: number[] = [];
  for (let i = start; i < layout.rows.length; i += 1) {
    const cell = layout.rows[i]?.[layout.urlCol] ?? "";
    if (normalizeSheetUrl(cell) === target) found.push(i);
  }
  return found;
}

function headerRow(layout: Layout): string[] {
  const width = Math.max(layout.urlCol, layout.companyCol, layout.roleCol, layout.badgesCol, layout.folderCol) + 1;
  const row = Array.from({ length: width }, () => "");
  row[layout.urlCol] = "URL";
  row[layout.companyCol] = "Company";
  row[layout.roleCol] = "Role";
  row[layout.badgesCol] = "Badges";
  row[layout.folderCol] = "Folder";
  return row;
}

function cell(row: string[] | undefined, col: number): string {
  return (row?.[col] ?? "").trim();
}

function mergeBadgeLabels(...values: string[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const value of values) {
    for (const part of value.split(/\s*·\s*/).map((entry) => entry.trim()).filter(Boolean)) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(part);
    }
  }
  return labels.join(" · ");
}

function rowIsScattered(row: string[], layout: Layout): boolean {
  for (let col = 0; col < row.length; col += 1) {
    const value = cell(row, col);
    if (!value) continue;
    if (col !== layout.badgesCol && isBadgeCell(value)) return true;
    if (col !== layout.folderCol && isFolderCell(value)) return true;
  }
  return false;
}

function compactRow(row: string[], layout: Layout, extras?: { badges?: string; folder?: string }): string[] {
  const width = Math.max(row.length, layout.folderCol + 1, layout.badgesCol + 1);
  const next = Array.from({ length: width }, (_, col) => row[col] ?? "");
  const badgeParts: string[] = [];
  let folder = extras?.folder?.trim() ?? "";

  for (let col = 0; col < next.length; col += 1) {
    if (col === layout.urlCol) continue;
    const value = cell(next, col);
    if (!value) continue;
    if (isBadgeCell(value)) {
      badgeParts.push(value);
      next[col] = "";
      continue;
    }
    if (isFolderCell(value)) {
      if (!folder) folder = value;
      next[col] = "";
    }
  }

  const badges = mergeBadgeLabels(...badgeParts, extras?.badges ?? "");
  if (badges) next[layout.badgesCol] = badges;
  if (folder) next[layout.folderCol] = folder;
  return next;
}

async function ensureLayout(layout: Layout): Promise<Layout> {
  let ready = layout;

  if (ready.rows.length === 0) {
    const header = headerRow(ready);
    await updateValues(ready.config.serviceAccount, ready.config.spreadsheetId, [
      { range: `${quoteSheetTitle(ready.sheet.title)}!A1:${columnLetter(header.length - 1)}1`, values: [header] },
    ]);
    return { ...ready, rows: [header], hasHeader: true };
  }

  if (!ready.hasHeader) {
    await insertRows(ready.config.serviceAccount, ready.config.spreadsheetId, ready.sheet.sheetId, 0, 1);
    const header = headerRow(ready);
    await updateValues(ready.config.serviceAccount, ready.config.spreadsheetId, [
      { range: `${quoteSheetTitle(ready.sheet.title)}!A1:${columnLetter(header.length - 1)}1`, values: [header] },
    ]);
    ready = { ...ready, rows: [header, ...ready.rows], hasHeader: true };
  } else {
    const current = ready.rows[0] ?? [];
    const header = headerRow(ready);
    const headerUpdates: Array<{ range: string; values: string[][] }> = [];
    for (let col = 0; col < header.length; col += 1) {
      if (!header[col]) continue;
      const existing = cell(current, col);
      if (!existing || isBadgeCell(existing) || isFolderCell(existing)) {
        headerUpdates.push({ range: a1(ready.sheet.title, col, 1), values: [[header[col]]] });
        if (!ready.rows[0]) ready.rows[0] = [];
        ready.rows[0][col] = header[col];
      }
    }
    if (headerUpdates.length > 0) {
      await updateValues(ready.config.serviceAccount, ready.config.spreadsheetId, headerUpdates);
    }
  }

  const start = ready.hasHeader ? 1 : 0;
  const scattered = ready.rows.slice(start).some((row) => rowIsScattered(row, ready));
  if (!scattered) return ready;

  const updates: Array<{ range: string; values: string[][] }> = [];
  const compacted = ready.rows.map((row, index) => {
    if (index < start) return row;
    const next = compactRow(row, ready);
    const width = Math.max(row.length, next.length);
    for (let col = 0; col < width; col += 1) {
      if ((row[col] ?? "") !== (next[col] ?? "")) {
        updates.push({ range: a1(ready.sheet.title, col, index + 1), values: [[next[col] ?? ""]] });
      }
    }
    return next;
  });
  if (updates.length > 0) {
    await updateValues(ready.config.serviceAccount, ready.config.spreadsheetId, updates);
  }
  return { ...ready, rows: compacted };
}

let sheetQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = sheetQueue.then(work, work);
  sheetQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Write badge labels and the resume folder name onto the matching URL row.
 * Appends the job if the URL is new. No-op when Sheets is not configured.
 */
export async function upsertSheetJob(job: SheetJobRow, settings?: Settings): Promise<boolean> {
  return serialized(() => writeSheetJob(job, settings));
}

async function writeSheetJob(job: SheetJobRow, settings?: Settings): Promise<boolean> {
  const labels = formatBadgeLabels(job.badges);
  const folder = job.folder?.trim() ?? "";
  if (!labels && !folder) return false;

  const layout = await loadLayout(settings);
  if (!layout) return false;

  const ready = await ensureLayout(layout);
  const matches = matchingRowIndexes(ready, job.url);

  if (matches.length === 0) {
    const width = Math.max(ready.badgesCol, ready.folderCol, ready.urlCol, ready.companyCol, ready.roleCol) + 1;
    const row = Array.from({ length: width }, () => "");
    row[ready.urlCol] = job.url;
    if (job.company) row[ready.companyCol] = job.company;
    if (job.role) row[ready.roleCol] = job.role;
    if (labels) row[ready.badgesCol] = labels;
    if (folder) row[ready.folderCol] = folder;
    await appendValues(
      ready.config.serviceAccount,
      ready.config.spreadsheetId,
      `${quoteSheetTitle(ready.sheet.title)}!A:A`,
      [row],
    );
    return true;
  }

  const updates: Array<{ range: string; values: string[][] }> = [];
  for (const index of matches) {
    const current = ready.rows[index] ?? [];
    const next = compactRow(current, ready, { badges: labels, folder });
    if (job.company) next[ready.companyCol] = job.company;
    if (job.role) next[ready.roleCol] = job.role;
    const width = Math.max(current.length, next.length);
    for (let col = 0; col < width; col += 1) {
      if ((current[col] ?? "") === (next[col] ?? "")) continue;
      updates.push({ range: a1(ready.sheet.title, col, index + 1), values: [[next[col] ?? ""]] });
    }
    ready.rows[index] = next;
  }
  await updateValues(ready.config.serviceAccount, ready.config.spreadsheetId, updates);
  return true;
}

/** Delete every row whose URL matches. No-op when Sheets is not configured or the URL is absent. */
export async function deleteSheetJob(url: string, settings?: Settings): Promise<boolean> {
  return serialized(() => removeSheetJob(url, settings));
}

async function removeSheetJob(url: string, settings?: Settings): Promise<boolean> {
  const layout = await loadLayout(settings);
  if (!layout) return false;
  const matches = matchingRowIndexes(layout, url);
  if (matches.length === 0) return false;
  await deleteRows(layout.config.serviceAccount, layout.config.spreadsheetId, layout.sheet.sheetId, matches);
  return true;
}

export async function listSheetJobUrls(settings?: Settings): Promise<string[]> {
  const layout = await loadLayout(settings);
  if (!layout) throw new Error("Add a Google Sheet URL and service account JSON on the Settings tab first.");

  const start = layout.hasHeader ? 1 : 0;
  const seen = new Set<string>();
  const urls: string[] = [];
  for (let i = start; i < layout.rows.length; i += 1) {
    const cellValue = (layout.rows[i]?.[layout.urlCol] ?? "").trim();
    if (!looksLikeUrl(cellValue)) continue;
    const key = normalizeSheetUrl(cellValue);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    urls.push(cellValue);
  }
  return urls;
}

export async function testSheetConnection(settings?: Settings): Promise<{
  ok: true;
  spreadsheetId: string;
  tab: string;
  email: string;
  rows: number;
}> {
  const resolved = settings ?? (await loadSettings());
  const config = sheetConfigFromSettings(resolved);
  if (!config) {
    throw new Error("Paste the spreadsheet URL and the service account JSON first.");
  }
  const layout = await loadLayout(resolved);
  if (!layout) throw new Error("Could not open that spreadsheet.");
  const ready = await ensureLayout(layout);
  const start = ready.hasHeader ? 1 : 0;
  return {
    ok: true,
    spreadsheetId: config.spreadsheetId,
    tab: ready.sheet.title,
    email: config.serviceAccount.clientEmail,
    rows: Math.max(0, ready.rows.length - start),
  };
}
