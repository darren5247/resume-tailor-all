import { NextResponse } from "next/server";
import { cancelRun } from "@/lib/pipeline/runner";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cancelled = await cancelRun(id);
  if (!cancelled) return NextResponse.json({ error: "Unknown run" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
