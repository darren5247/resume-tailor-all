import { NextResponse } from "next/server";
import { RunSetupError, retryJob } from "@/lib/pipeline/runner";
import { MIN_JD_LENGTH } from "@/lib/scrape/types";

export const runtime = "nodejs";
export const maxDuration = 600;

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

    await retryJob(id, jobId, pasted || undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof RunSetupError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
