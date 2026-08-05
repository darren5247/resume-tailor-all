import { NextResponse } from "next/server";
import { parseUrlList } from "@/lib/scrape/detect";
import { RunSetupError, startRun } from "@/lib/pipeline/runner";
import { listRuns } from "@/lib/pipeline/store";

export const runtime = "nodejs";
// Hobby Fluid max is 300s; higher values fail at "Deploying outputs…".
export const maxDuration = 250;

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { urls?: string };
    const { urls, invalid } = parseUrlList(body.urls ?? "");
    const run = await startRun(urls);
    return NextResponse.json({ run, invalid });
  } catch (error) {
    const status = error instanceof RunSetupError ? 400 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
