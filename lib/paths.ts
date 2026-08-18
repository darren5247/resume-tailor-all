import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

/** Deploy disks are read-only; only os.tmpdir() can hold generated files. */
export function isEphemeralRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Next/Turbopack file tracing hooks `node:fs`. That wrapper throws ENOENT on
 * mkdir of gitignored runtime dirs (`output/`, `data/`) and can hang compile
 * while it walks those trees. `getBuiltinModule` is the unpatched Node fs.
 */
function nodeFs(): typeof import("node:fs/promises") {
  return process.getBuiltinModule?.("node:fs/promises") ?? fs;
}

/**
 * Local runs write under the project root. On Vercel/Lambda the deploy dir is
 * read-only, so runtime paths must live under the writable temp dir.
 */
function writableRoot(): string {
  if (isEphemeralRuntime()) {
    return path.join(os.tmpdir(), "resume-tailor");
  }
  return /* turbopackIgnore: true */ process.cwd();
}

export const ROOT = writableRoot();
export const DATA_DIR = path.join(ROOT, "data");
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const DEFAULT_OUTPUT_DIR = path.join(ROOT, "output");

/**
 * Settings saved on a Windows PC store `D:\…\output`. That path is loaded from
 * Postgres on Vercel (Linux) and mkdir fails with ENOENT. Map anything this
 * host cannot create onto the writable default for this process.
 */
export function resolveOutputDir(stored: string | undefined | null): string {
  const trimmed = stored?.trim() ?? "";
  if (!trimmed || outputDirIsUnusable(trimmed)) return DEFAULT_OUTPUT_DIR;
  return trimmed;
}

function outputDirIsUnusable(dir: string): boolean {
  if (isEphemeralRuntime()) {
    const resolved = path.resolve(dir);
    return resolved !== path.resolve(DEFAULT_OUTPUT_DIR) && !isInside(ROOT, resolved);
  }
  if (process.platform !== "win32") {
    if (/^[A-Za-z]:[\\/]/.test(dir) || dir.startsWith("\\\\")) return true;
  } else if (dir.startsWith("/tmp") || dir.startsWith("/var/task")) {
    return true;
  }
  return false;
}

function isInside(root: string, target: string): boolean {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/** Legacy single-profile file; migrated into profiles/ on first load. */
export const PROFILE_FILE = path.join(DATA_DIR, "profile.json");
export const PROFILES_DIR = path.join(DATA_DIR, "profiles");
export const PROFILES_INDEX_FILE = path.join(PROFILES_DIR, "index.json");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export async function ensureDir(dir: string): Promise<void> {
  const target = path.resolve(dir);
  const io = nodeFs();
  try {
    await io.mkdir(/* turbopackIgnore: true */ target, { recursive: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") return;
    // Tracing hooks can report ENOENT for a directory that is already there.
    try {
      const stat = await io.stat(/* turbopackIgnore: true */ target);
      if (stat.isDirectory()) return;
    } catch {
      // Keep the original mkdir error.
    }
    throw error;
  }
}

export async function writeFile(file: string, contents: string | Buffer): Promise<void> {
  await nodeFs().writeFile(/* turbopackIgnore: true */ file, contents);
}

export async function readFileBuffer(file: string): Promise<Buffer> {
  return nodeFs().readFile(/* turbopackIgnore: true */ file);
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await nodeFs().access(/* turbopackIgnore: true */ target);
    return true;
  } catch {
    return false;
  }
}

export async function removeDir(dir: string): Promise<void> {
  await nodeFs().rm(/* turbopackIgnore: true */ dir, { recursive: true, force: true });
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await nodeFs().readFile(/* turbopackIgnore: true */ file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await writeFile(file, JSON.stringify(value, null, 2));
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
