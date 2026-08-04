import archiver, { type Archiver } from "archiver";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ensureDir, safeFileName, slugify } from "../paths";

export interface PacketFile {
  name: string;
  content: Buffer | string;
}

export interface Packet {
  /** Absolute path of the job folder. */
  folder: string;
  /** Absolute path of the zip. */
  zip: string;
  resume: string;
  resumePdf: string;
  coverLetter: string | null;
}

export interface PacketRequest {
  outputDir: string;
  company: string;
  role: string;
  firstName: string;
  resumeDocx: Buffer;
  resumePdf: Buffer;
  coverLetterDocx: Buffer | null;
  jobDescription: string;
  metadata: unknown;
}

/**
 * One folder per job, dated so repeated applications to the same company stay
 * distinguishable, plus a zip of exactly that folder for one-click sending.
 */
export async function writePacket(request: PacketRequest): Promise<Packet> {
  const date = new Date().toISOString().slice(0, 10);
  const base = [date, slugify(request.company || "company", 32), slugify(request.role || "role", 48)]
    .filter(Boolean)
    .join("_");

  const folder = await uniqueFolder(path.join(request.outputDir, base));
  await ensureDir(folder);

  const person = safeFileName(request.firstName || "Candidate");
  const resumeName = `Resume-${person}.docx`;
  const resumePdfName = `Resume-${person}.pdf`;
  const coverName = `Coverletter-${person}.docx`;

  const files: PacketFile[] = [
    { name: resumeName, content: request.resumeDocx },
    { name: resumePdfName, content: request.resumePdf },
    { name: "job-description.txt", content: request.jobDescription },
    { name: "metadata.json", content: JSON.stringify(request.metadata, null, 2) },
  ];
  if (request.coverLetterDocx) {
    files.splice(2, 0, { name: coverName, content: request.coverLetterDocx });
  }

  for (const file of files) {
    await fsp.writeFile(path.join(folder, file.name), file.content);
  }

  const zipName = `${safeFileName(slugify(request.company || "company", 32))}-${safeFileName(
    slugify(request.role || "role", 48),
  )}.zip`;
  const zipPath = path.join(folder, zipName);
  await zipFiles(zipPath, files);

  return {
    folder,
    zip: zipPath,
    resume: path.join(folder, resumeName),
    resumePdf: path.join(folder, resumePdfName),
    coverLetter: request.coverLetterDocx ? path.join(folder, coverName) : null,
  };
}

async function uniqueFolder(candidate: string): Promise<string> {
  let folder = candidate;
  let counter = 2;
  while (await exists(folder)) {
    folder = `${candidate}-${counter}`;
    counter += 1;
  }
  return folder;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

function newArchive(): Archiver {
  return archiver("zip", { zlib: { level: 9 } });
}

export function zipFiles(destination: string, files: PacketFile[]): Promise<void> {
  const archive = newArchive();

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);

    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);

    for (const file of files) {
      archive.append(file.content, { name: file.name });
    }
    void archive.finalize();
  });
}

/** Bulk download: stream a zip of many folders without staging it on disk. */
export function createFolderArchive(entries: { folder: string; name: string }[]): Archiver {
  const archive = newArchive();
  for (const entry of entries) {
    archive.directory(entry.folder, entry.name);
  }
  void archive.finalize();
  return archive;
}
