import { NextResponse } from "next/server";
import { deleteJob, RunSetupError } from "@/lib/pipeline/runner";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await params;

  try {
    await deleteJob(id, jobId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof RunSetupError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
