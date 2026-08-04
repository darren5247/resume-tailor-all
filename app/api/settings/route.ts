import { NextResponse } from "next/server";
import { SettingsSchema, loadSettings, redactSettings, saveSettings } from "@/lib/settings";
import { migrateSettingsInput } from "@/lib/settings-schema";

export const runtime = "nodejs";

export async function GET() {
  const settings = await loadSettings();
  return NextResponse.json(redactSettings(settings));
}

export async function POST(request: Request) {
  const body = migrateSettingsInput((await request.json()) as Record<string, unknown>);
  const current = await loadSettings();

  // A blank key means "leave it alone", so saving other fields never wipes it.
  const merged = { ...current, ...body };
  if (typeof body.apiKey !== "string" || body.apiKey.trim() === "") {
    merged.apiKey = current.apiKey;
  }

  const parsed = SettingsSchema.safeParse(merged);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  }

  const saved = await saveSettings(parsed.data);
  return NextResponse.json(redactSettings(saved));
}
