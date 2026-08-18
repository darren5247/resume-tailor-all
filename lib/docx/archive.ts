import archiver, { type Archiver } from "archiver";
import fs from "node:fs";

function nodeFs(): typeof import("node:fs") {
  return process.getBuiltinModule?.("node:fs") ?? fs;
}

export interface ArchiveFile {
  name: string;
  content: Buffer | string;
}

function newArchive(): Archiver {
  return archiver("zip", { zlib: { level: 9 } });
}

export function zipFiles(destination: string, files: ArchiveFile[]): Promise<void> {
  const archive = newArchive();

  return new Promise((resolve, reject) => {
    const output = nodeFs().createWriteStream(/* turbopackIgnore: true */ destination);

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
    // Runtime output dirs — not project files for NFT tracing.
    archive.directory(/* turbopackIgnore: true */ entry.folder, entry.name);
  }
  void archive.finalize();
  return archive;
}
