import { NextResponse } from "next/server";
import { ProfileSchema } from "@/lib/profile/schema";
import { loadProfile, saveProfile } from "@/lib/profile/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await loadProfile());
}

export async function POST(request: Request) {
  const parsed = ProfileSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid profile" }, { status: 400 });
  }
  return NextResponse.json(await saveProfile(parsed.data));
}
