import { NextResponse } from "next/server";
import path from "node:path";
import { streamBlob } from "@/lib/blob-store";
import { getState, loadPersistedRun } from "@/lib/pipeline/store";
import { readFileBuffer } from "@/lib/paths";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const file = new URL(request.url).searchParams.get("file");
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const state = getState(id) ?? (await loadPersistedRun(id));
  if (!state) return NextResponse.json({ error: "Unknown run" }, { status: 404 });

  const wanted = file.split(path.sep).join("/");
  const download = state.jobs.flatMap((job) => job.downloads).find((entry) => entry.file === wanted);
  if (download?.blobUrl) {
    try {
      const blob = await streamBlob(download.blobUrl);
      return new NextResponse(blob.stream, {
        headers: {
          "Content-Type": blob.contentType || CONTENT_TYPES[path.extname(wanted).toLowerCase()] || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(download.label)}"`,
          "Content-Length": String(blob.size),
        },
      });
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
  }

  // The requested path is client-supplied, so resolve it and confirm it still
  // sits inside the run's output directory before reading anything.
  const root = path.resolve(state.outputDir);
  const target = path.resolve(root, file);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "Path is outside the output directory" }, { status: 400 });
  }

  try {
    const data = await readFileBuffer(target);
    const name = path.basename(target);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": CONTENT_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
        "Content-Length": String(data.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
