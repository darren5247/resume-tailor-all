import { NextResponse } from "next/server";
import { listRuns } from "@/lib/pipeline/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    listRuns().map((run) => ({
      id: run.id,
      createdAt: run.createdAt,
      status: run.status,
      total: run.total,
    })),
  );
}
