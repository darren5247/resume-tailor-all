import { createSign } from "node:crypto";
import type { ServiceAccount } from "./config";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

interface CachedToken {
  email: string;
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

function signJwt(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(account.privateKey, "base64url");
  return `${header}.${payload}.${signature}`;
}

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cached && cached.email === account.clientEmail && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: signJwt(account),
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google auth failed (${response.status}).`);
  }
  cached = {
    email: account.clientEmail,
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

export class SheetsApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function sheetsFetch(
  account: ServiceAccount,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const token = await accessToken(account);
  const response = await fetch(`${SHEETS_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { error: { message: text } };
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? formatGoogleError((data as { error: unknown }).error, account.clientEmail, response.status)
        : `Google Sheets request failed (${response.status}).`;
    throw new SheetsApiError(response.status, message);
  }
  return data;
}

function formatGoogleError(error: unknown, email: string, status: number): string {
  const message =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : `Google Sheets request failed (${status}).`;
  if (status === 403) {
    return `${message} Share the spreadsheet with ${email} as Editor, and enable the Google Sheets API in that Cloud project.`;
  }
  if (status === 404) {
    return `${message} Check the spreadsheet URL.`;
  }
  return message;
}

export interface SheetProperties {
  sheetId: number;
  title: string;
  index: number;
}

export async function getSpreadsheet(
  account: ServiceAccount,
  spreadsheetId: string,
): Promise<{ sheets: SheetProperties[] }> {
  const data = (await sheetsFetch(
    account,
    `/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title,index)`,
  )) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number } }>;
  };
  const sheets = (data.sheets ?? [])
    .map((entry) => entry.properties)
    .filter((props): props is { sheetId: number; title: string; index: number } =>
      Boolean(props && typeof props.sheetId === "number" && typeof props.title === "string"),
    )
    .map((props) => ({
      sheetId: props.sheetId,
      title: props.title,
      index: typeof props.index === "number" ? props.index : 0,
    }));
  if (sheets.length === 0) throw new Error("That spreadsheet has no tabs.");
  return { sheets };
}

export async function getValues(
  account: ServiceAccount,
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const data = (await sheetsFetch(
    account,
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  )) as { values?: unknown[][] };
  return (data.values ?? []).map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
}

export async function updateValues(
  account: ServiceAccount,
  spreadsheetId: string,
  data: Array<{ range: string; values: string[][] }>,
): Promise<void> {
  if (data.length === 0) return;
  await sheetsFetch(account, `/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data,
    }),
  });
}

export async function appendValues(
  account: ServiceAccount,
  spreadsheetId: string,
  range: string,
  values: string[][],
): Promise<void> {
  await sheetsFetch(
    account,
    `/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values }),
    },
  );
}

export async function insertRows(
  account: ServiceAccount,
  spreadsheetId: string,
  sheetId: number,
  startIndex: number,
  count = 1,
): Promise<void> {
  if (count <= 0) return;
  await sheetsFetch(account, `/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex,
              endIndex: startIndex + count,
            },
            inheritFromBefore: false,
          },
        },
      ],
    }),
  });
}

export async function deleteRows(
  account: ServiceAccount,
  spreadsheetId: string,
  sheetId: number,
  rowIndexes: number[],
): Promise<void> {
  const unique = [...new Set(rowIndexes)].sort((a, b) => b - a);
  if (unique.length === 0) return;
  await sheetsFetch(account, `/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: unique.map((startIndex) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex,
            endIndex: startIndex + 1,
          },
        },
      })),
    }),
  });
}
