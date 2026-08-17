import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

/**
 * Local runs write under the project root. On Vercel/Lambda the deploy dir is
 * read-only, so runtime paths must live under the writable temp dir.
 */
function writableRoot(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), "resume-tailor");
  }
  return /* turbopackIgnore: true */ process.cwd();
}

export const ROOT = writableRoot();
export const DATA_DIR = path.join(ROOT, "data");
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const DEFAULT_OUTPUT_DIR = path.join(ROOT, "output");

/** Legacy single-profile file; migrated into profiles/ on first load. */
export const PROFILE_FILE = path.join(DATA_DIR, "profile.json");
export const PROFILES_DIR = path.join(DATA_DIR, "profiles");
export const PROFILES_INDEX_FILE = path.join(PROFILES_DIR, "index.json");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/** Filesystem-safe slug used for output folder and file names. */
export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (slug || "untitled").slice(0, maxLength).replace(/-+$/g, "");
}

/** Windows forbids these characters outright; strip them from any user-derived name. */
export function safeFileName(input: string): string {
  return input.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim() || "file";
}
