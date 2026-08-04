import { NextResponse } from "next/server";
import { parseResumeFile } from "@/lib/profile/parse";
import { saveProfile } from "@/lib/profile/store";
import { loadSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Seeds the profile from a master resume. The form stays editable afterwards. */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "That file is larger than 10 MB." }, { status: 400 });
    }

    const settings = await loadSettings();
    const profile = await parseResumeFile(
      { name: file.name, buffer: Buffer.from(await file.arrayBuffer()) },
      settings,
    );

    const save = form.get("save") === "true";
    if (save) await saveProfile(profile);

    return NextResponse.json(profile);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
