import { NextResponse } from "next/server";
import { ProfileSchema } from "@/lib/profile/schema";
import { loadProfile, saveProfile } from "@/lib/profile/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await loadProfile());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const parsed = ProfileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" }, { status: 400 });
    }
    return NextResponse.json(await saveProfile(parsed.data));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
