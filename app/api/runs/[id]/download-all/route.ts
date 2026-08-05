import { NextResponse } from "next/server";
import path from "node:path";
import { Readable } from "node:stream";
import { createFolderArchive } from "@/lib/docx/archive";
import { getState, loadPersistedRun } from "@/lib/pipeline/store";
import { slugify } from "@/lib/paths";

export const runtime = "nodejs";

/** One zip of every completed job's folder, streamed rather than staged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getState(id) ?? (await loadPersistedRun(id));
  if (!state) return NextResponse.json({ error: "Unknown run" }, { status: 404 });

  // Runtime output dir from settings — not part of the deploy NFT graph.
  const root = path.resolve(/* turbopackIgnore: true */ state.outputDir);
  const seen = new Set<string>();
  const entries: { folder: string; name: string }[] = [];

  for (const job of state.jobs) {
    if (job.status !== "done" || job.downloads.length === 0) continue;

    const folder = path.resolve(/* turbopackIgnore: true */ root, path.dirname(job.downloads[0].file));
    if (folder !== root && !folder.startsWith(root + path.sep)) continue;

    let name = path.basename(folder);
    if (seen.has(name)) name = `${name}-${slugify(job.id.slice(0, 6))}`;
    seen.add(name);
    entries.push({ folder, name });
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: "Nothing finished yet" }, { status: 400 });
  }

  const archive = createFolderArchive(entries);
  const stamp = new Date(state.createdAt).toISOString().slice(0, 10);

  return new NextResponse(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="resume-tailor-${stamp}-${entries.length}-jobs.zip"`,
    },
  });
}
