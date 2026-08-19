import { NextResponse } from "next/server";
import { RunSetupError, retryJob } from "@/lib/pipeline/runner";
import { schedulePipeline } from "@/lib/pipeline/schedule";
import { MIN_JD_LENGTH } from "@/lib/scrape/types";
import { ensureRun } from "@/lib/pipeline/store";

export const runtime = "nodejs";
// Hobby Fluid max is 300s; higher values fail at "Deploying outputs…".
export const maxDuration = 250;

/**
 * Re-runs one job. With `pastedJd` the scrape and fetch steps are skipped
 * entirely, which is the escape hatch for login walls and CAPTCHA pages.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const { id, jobId } = await params;

  try {
    const body = (await request.json().catch(() => ({}))) as { pastedJd?: string };
    const pasted = body.pastedJd?.trim();

    if (pasted !== undefined && pasted.length > 0 && pasted.length < MIN_JD_LENGTH) {
      return NextResponse.json(
        { error: `That is only ${pasted.length} characters. Paste the full description (${MIN_JD_LENGTH}+).` },
        { status: 400 },
      );
    }

    const record = await ensureRun(id);
    if (!record) throw new RunSetupError("That run is no longer in memory. Start a new run.");
    if (!record.state.jobs.some((job) => job.id === jobId)) throw new RunSetupError("Unknown job.");

    schedulePipeline(() => retryJob(id, jobId, pasted || undefined));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof RunSetupError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
