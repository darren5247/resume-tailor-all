import { NextResponse } from "next/server";
import { listSheetJobUrls } from "@/lib/sheets";

export const runtime = "nodejs";

export async function GET() {
  try {
    const urls = await listSheetJobUrls();
    return NextResponse.json({ urls });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
