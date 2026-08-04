import { NextResponse } from "next/server";
import OpenAI from "openai";
import { loadSettings } from "@/lib/settings";
import { isPlaywrightAvailable } from "@/lib/scrape/browser";

export const runtime = "nodejs";

/** Confirms the key, the model name and the browser fallback in one round trip. */
export async function POST() {
  const settings = await loadSettings();
  const playwright = await isPlaywrightAvailable();

  if (!settings.apiKey) {
    return NextResponse.json({ ok: false, error: "No API key saved.", playwright }, { status: 400 });
  }

  try {
    const client = new OpenAI({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl || undefined,
      maxRetries: 0,
      timeout: 30_000,
    });
    const completion = await client.chat.completions.create({
      model: settings.model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_completion_tokens: 5,
    });

    return NextResponse.json({
      ok: true,
      model: completion.model,
      reply: completion.choices[0]?.message?.content?.trim() ?? "",
      playwright,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error), playwright },
      { status: 400 },
    );
  }
}
