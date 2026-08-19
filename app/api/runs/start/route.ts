import { NextResponse } from "next/server";
import { parseUrlList } from "@/lib/scrape/url";
import { RunSetupError, executeRun, startRun } from "@/lib/pipeline/runner";
import { schedulePipeline } from "@/lib/pipeline/schedule";

export const runtime = "nodejs";
// Hobby Fluid max is 300s; higher values fail at "Deploying outputs…".
export const maxDuration = 250;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { urls?: string };
    const { urls, invalid } = parseUrlList(body.urls ?? "");
    const run = await startRun(urls);
    schedulePipeline(() => executeRun(run.id));
    return NextResponse.json({ run, invalid });
  } catch (error) {
    const status = error instanceof RunSetupError ? 400 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
