import { NextResponse } from "next/server";
import {
  createProfile,
  deleteProfile,
  listProfiles,
  renameActiveProfile,
  selectProfile,
} from "@/lib/profile/store";
import { PROFILE_COUNTRIES, type ProfileCountry } from "@/lib/profile/schema";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listProfiles());
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      id?: string;
      label?: string;
      country?: string;
    };

    switch (body.action) {
      case "select": {
        if (!body.id) return NextResponse.json({ error: "Missing profile id." }, { status: 400 });
        return NextResponse.json(await selectProfile(body.id));
      }
      case "create": {
        const country =
          body.country && PROFILE_COUNTRIES.includes(body.country as ProfileCountry)
            ? (body.country as ProfileCountry)
            : undefined;
        return NextResponse.json(await createProfile(body.label, country));
      }
      case "delete":
        return NextResponse.json(await deleteProfile(body.id));
      case "rename": {
        if (!body.label) return NextResponse.json({ error: "Missing label." }, { status: 400 });
        return NextResponse.json(await renameActiveProfile(body.label));
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
