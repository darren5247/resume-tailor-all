import { NextResponse } from "next/server";
import { testSheetConnection } from "@/lib/sheets";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await testSheetConnection();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
