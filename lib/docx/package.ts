import fsp from "node:fs/promises";
import path from "node:path";
import { zipFiles, type ArchiveFile } from "./archive";
import { ensureDir, safeFileName, slugify } from "../paths";

export interface PacketFile extends ArchiveFile {}

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
  /** Structured JD from the Extract step (JobSpec). */
  extractedJd?: unknown;
  metadata: unknown;
}

/**
 * One folder per job: `{YYYY-MM-DD}_{company}_{role}`, dated so repeated
 * applications stay distinguishable. Company/role should already be reconciled
 * from URL + JD extract (see resolveFolderIdentity).
 */
export async function writePacket(request: PacketRequest): Promise<Packet> {
  const date = new Date().toISOString().slice(0, 10);
  const base = [date, slugify(request.company || "company", 32), slugify(request.role || "role", 48)]
    .filter(Boolean)
    .join("_");

  const folder = await uniqueFolder(
    path.join(/* turbopackIgnore: true */ request.outputDir, base),
  );
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
  if (request.extractedJd !== undefined) {
    files.push({
      name: "extracted-jd.json",
      content: JSON.stringify(request.extractedJd, null, 2),
    });
  }
  if (request.coverLetterDocx) {
    files.splice(2, 0, { name: coverName, content: request.coverLetterDocx });
  }

  for (const file of files) {
    const target = path.join(/* turbopackIgnore: true */ folder, file.name);
    await fsp.writeFile(target, file.content);
  }

  const zipName = `${safeFileName(slugify(request.company || "company", 32))}-${safeFileName(
    slugify(request.role || "role", 48),
  )}.zip`;
  const zipPath = path.join(/* turbopackIgnore: true */ folder, zipName);
  await zipFiles(zipPath, files);

  return {
    folder,
    zip: zipPath,
    resume: path.join(/* turbopackIgnore: true */ folder, resumeName),
    resumePdf: path.join(/* turbopackIgnore: true */ folder, resumePdfName),
    coverLetter: request.coverLetterDocx
      ? path.join(/* turbopackIgnore: true */ folder, coverName)
      : null,
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
