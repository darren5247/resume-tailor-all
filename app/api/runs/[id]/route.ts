import { NextResponse } from "next/server";
import { getState, loadPersistedRun } from "@/lib/pipeline/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getState(id) ?? (await loadPersistedRun(id));
  if (!state) return NextResponse.json({ error: "Unknown run" }, { status: 404 });
  return NextResponse.json(state);
}
