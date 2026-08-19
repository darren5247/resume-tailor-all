import { NextResponse } from "next/server";
import path from "node:path";
import { Readable } from "node:stream";
import { createBufferArchive, createFolderArchive } from "@/lib/docx/archive";
import { readBlobBuffer } from "@/lib/blob-store";
import { getState, loadPersistedRun } from "@/lib/pipeline/store";
import { slugify } from "@/lib/paths";

export const runtime = "nodejs";
export const maxDuration = 250;

/** One zip of every completed job's folder, streamed rather than staged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getState(id) ?? (await loadPersistedRun(id));
  if (!state) return NextResponse.json({ error: "Unknown run" }, { status: 404 });

  const stamp = new Date(state.createdAt).toISOString().slice(0, 10);
  const blobZips: { name: string; content: Buffer }[] = [];
  const diskFolders: { folder: string; name: string }[] = [];
  const seen = new Set<string>();
  const root = path.resolve(/* turbopackIgnore: true */ state.outputDir);

  for (const job of state.jobs) {
    if (job.status !== "done" || job.downloads.length === 0) continue;
    const zip = job.downloads.find((download) => download.kind === "zip");
    let name = zip?.label || `${path.basename(path.dirname(job.downloads[0].file))}.zip`;
    if (seen.has(name)) name = `${path.parse(name).name}-${slugify(job.id.slice(0, 6))}${path.extname(name) || ".zip"}`;
    seen.add(name);

    if (zip?.blobUrl) {
      try {
        blobZips.push({ name, content: await readBlobBuffer(zip.blobUrl) });
      } catch {
        // Skip a missing blob rather than failing the whole archive.
      }
      continue;
    }

    const folder = path.resolve(/* turbopackIgnore: true */ root, path.dirname(job.downloads[0].file));
    if (folder !== root && !folder.startsWith(root + path.sep)) continue;
    diskFolders.push({ folder, name: path.parse(name).name });
  }

  const count = blobZips.length + diskFolders.length;
  if (count === 0) {
    return NextResponse.json({ error: "Nothing finished yet" }, { status: 400 });
  }

  const archive =
    blobZips.length > 0 ? createBufferArchive(blobZips) : createFolderArchive(diskFolders);

  return new NextResponse(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="resume-tailor-${stamp}-${count}-jobs.zip"`,
    },
  });
}
