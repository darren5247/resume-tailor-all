import OpenAI from "openai";
import type { z } from "zod";
import { resolveBaseUrl } from "../settings";
import type { Settings } from "../settings-schema";
import { describeSchema } from "./schemas";

export interface UsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/** USD per 1M tokens. Unlisted models simply report zero rather than a guess. */
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "o4-mini": { input: 1.1, output: 4.4 },
};

export class LlmError extends Error {
  constructor(message: string, readonly label: string) {
    super(message);
    this.name = "LlmError";
  }
}

export class LlmClient {
  readonly usage: UsageTotals = { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
  private readonly client: OpenAI;

  constructor(private readonly settings: Settings) {
    if (!settings.apiKey) {
      throw new LlmError("No OpenAI API key. Add one on the Settings tab.", "config");
    }
    const baseURL = resolveBaseUrl(settings) || undefined;
    this.client = new OpenAI({
      apiKey: settings.apiKey,
      baseURL,
      maxRetries: 3,
      timeout: 120_000,
    });
  }

  /**
   * Ask for JSON, validate it against the zod schema, and on a schema violation
   * hand the model its own error text once. Two rounds is the sweet spot: real
   * models fix a missing field on the first correction, and anything still
   * broken after that is a prompt bug worth surfacing.
   */
  async json<T>(options: {
    schema: z.ZodType<T>;
    system: string;
    user: string;
    label: string;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<T> {
    const schemaText = describeSchema(options.schema as z.ZodType);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: `${options.system}\n\nReply with a single JSON object and nothing else. It must validate against this JSON Schema:\n${schemaText}`,
      },
      { role: "user", content: options.user },
    ];

    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const completion = await this.client.chat.completions.create(
        {
          model: this.settings.model,
          messages,
          temperature: options.temperature ?? 0.3,
          response_format: { type: "json_object" },
        },
        { signal: options.signal },
      );

      this.record(completion.usage);

      const content = completion.choices[0]?.message?.content ?? "";
      const parsedJson = safeParseJson(content);
      if (!parsedJson) {
        lastError = "Response was not valid JSON.";
      } else {
        const result = options.schema.safeParse(parsedJson);
        if (result.success) return result.data;
        lastError = result.error.issues
          .slice(0, 8)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
      }

      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `That response did not fit the schema (${lastError}). Return the corrected JSON object only.`,
      });
    }

    throw new LlmError(`Model could not produce valid ${options.label} JSON: ${lastError}`, options.label);
  }

  private record(usage: OpenAI.Completions.CompletionUsage | undefined) {
    this.usage.calls += 1;
    if (!usage) return;
    this.usage.promptTokens += usage.prompt_tokens ?? 0;
    this.usage.completionTokens += usage.completion_tokens ?? 0;

    const price = PRICING[this.settings.model] ?? PRICING[this.settings.model.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
    if (price) {
      this.usage.costUsd +=
        ((usage.prompt_tokens ?? 0) / 1e6) * price.input + ((usage.completion_tokens ?? 0) / 1e6) * price.output;
    }
  }
}

function safeParseJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export function mergeUsage(target: UsageTotals, source: UsageTotals): UsageTotals {
  return {
    calls: target.calls + source.calls,
    promptTokens: target.promptTokens + source.promptTokens,
    completionTokens: target.completionTokens + source.completionTokens,
    costUsd: target.costUsd + source.costUsd,
  };
}
