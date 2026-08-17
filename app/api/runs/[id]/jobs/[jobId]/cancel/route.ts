import { NextResponse } from "next/server";
import { cancelJob } from "@/lib/pipeline/runner";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await params;
  const cancelled = cancelJob(id, jobId);
  if (!cancelled) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
