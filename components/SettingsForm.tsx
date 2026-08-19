"use client";

import { useState } from "react";
import { TEMPLATES, type Settings } from "@/lib/settings-schema";

type RedactedSettings = Settings & {
  hasApiKey: boolean;
  apiKeyFromEnv: boolean;
  hasGoogleServiceAccount: boolean;
  googleServiceAccountEmail: string;
  googleServiceAccountFromEnv: boolean;
  outputDirLocked?: boolean;
};

export function SettingsForm({ initial }: { initial: RedactedSettings }) {
  const [form, setForm] = useState<RedactedSettings>(initial);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [serviceAccountInput, setServiceAccountInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "sheets" | null>(null);

  const set = <K extends keyof RedactedSettings>(key: K, value: RedactedSettings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy("save");
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          apiKey: apiKeyInput,
          googleServiceAccountJson: serviceAccountInput,
        }),
      });
      const data = (await response.json()) as RedactedSettings & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setForm(data);
      setApiKeyInput("");
      setServiceAccountInput("");
      setStatus("Saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/settings/test", { method: "POST" });
      const data = (await response.json()) as {
        ok: boolean;
        model?: string;
        error?: string;
        playwright?: boolean;
      };
      if (data.ok) {
        setStatus(
          `Connected to ${data.model}. Chromium fallback ${
            data.playwright ? "available" : "not installed (run: npx playwright install chromium)"
          }.`,
        );
      } else {
        setError(data.error ?? "Connection failed.");
      }
    } finally {
      setBusy(null);
    }
  };

  const testSheets = async () => {
    setBusy("sheets");
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/settings/sheets-test", { method: "POST" });
      const data = (await response.json()) as {
        ok?: boolean;
        tab?: string;
        email?: string;
        rows?: number;
        error?: string;
      };
      if (data.ok) {
        setStatus(
          `Opened "${data.tab}" as ${data.email}. ${data.rows ?? 0} job row(s).`,
        );
      } else {
        setError(data.error ?? "Could not reach the spreadsheet.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach the spreadsheet.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="panel p-5">
        <h2 className="text-base text-fg">LLM provider</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Your API key is stored in Postgres on Vercel, or in data/settings.json when you run locally.
          OpenAI keys work as-is; OpenRouter keys (<code className="text-fg-faint">sk-or-...</code>) auto-use
          OpenRouter&apos;s base URL.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="API key">
            <input
              type="password"
              className="field"
              placeholder={
                form.hasApiKey
                  ? `${form.apiKey}${form.apiKeyFromEnv ? " (from environment)" : " (saved)"}`
                  : "sk-... or sk-or-..."
              }
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field label="Model" hint="OpenRouter models look like openai/gpt-4.1-mini or anthropic/claude-sonnet-4.">
            <input
              className="field"
              value={form.model}
              onChange={(event) => set("model", event.target.value)}
              placeholder="gpt-4.1"
            />
          </Field>

          <Field
            label="Base URL"
            hint="Leave blank for OpenAI, or for OpenRouter keys (auto-filled). Override for other OpenAI-compatible proxies."
          >
            <input
              className="field"
              value={form.baseUrl}
              onChange={(event) => set("baseUrl", event.target.value)}
              placeholder="https://openrouter.ai/api/v1"
            />
          </Field>

          <button className="btn" disabled={busy !== null} onClick={() => void test()}>
            {busy === "test" ? "Testing..." : "Test connection"}
          </button>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-base text-fg">Run</h2>
        <p className="mt-0.5 text-xs text-fg-muted">How each batch is processed and where the files land.</p>

        <div className="mt-4 space-y-3">
          <Field label="Batch size" hint="Jobs processed at once. Lower this if you hit rate limits.">
            <input
              type="number"
              min={1}
              max={20}
              className="field"
              value={form.concurrency}
              onChange={(event) => set("concurrency", Number(event.target.value) || 1)}
            />
          </Field>

          {form.outputDirLocked ? (
            <Field
              label="Output folder"
              hint="Vercel cannot write to a folder on your PC. Download each resume from the Generate tab."
            >
              <input className="field" value="Downloads from the Generate tab" disabled />
            </Field>
          ) : (
            <Field label="Output folder" hint="Every run writes a dated folder per job here.">
              <input
                className="field"
                value={form.outputDir}
                onChange={(event) => set("outputDir", event.target.value)}
              />
            </Field>
          )}

          <Field label="Language" hint="The language the resume and cover letter are written in.">
            <input
              className="field"
              value={form.language}
              onChange={(event) => set("language", event.target.value)}
            />
          </Field>

          <Toggle
            checked={form.includeCoverLetter}
            onChange={(value) => set("includeCoverLetter", value)}
            label="Write a cover letter for each job"
          />

          <Toggle
            checked={form.usePlaywrightFallback}
            onChange={(value) => set("usePlaywrightFallback", value)}
            label="Render stubborn pages in Chromium"
            hint="The last scraping fallback. Needs: npx playwright install chromium"
          />
        </div>
      </section>

      <section className="panel p-5 md:col-span-2">
        <h2 className="text-base text-fg">Google Sheet</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Columns are Badges, URL, Folder. When a Direct hire, Agency, Startup, Hybrid, or On-site badge
          appears on a job card, it is written to Badges. After documents are written, the resume folder
          name goes in Folder. Missing headers are added; scattered labels are pulled into those columns.
          Deleting a job here deletes that URL&apos;s row. Share the spreadsheet with the service account as
          Editor.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field
            label="Spreadsheet URL"
            hint="Paste the full docs.google.com/spreadsheets link, or just the spreadsheet id."
          >
            <input
              className="field"
              value={form.googleSheetUrl}
              onChange={(event) => set("googleSheetUrl", event.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </Field>

          <Field label="Tab name" hint="Leave blank to use the first tab, or the gid in the URL.">
            <input
              className="field"
              value={form.googleSheetTab}
              onChange={(event) => set("googleSheetTab", event.target.value)}
              placeholder="Sheet1"
            />
          </Field>

          <div className="md:col-span-2">
            <Field
              label="Service account JSON"
              hint={
                form.hasGoogleServiceAccount
                  ? `Saved as ${form.googleServiceAccountEmail || "a service account"}${
                      form.googleServiceAccountFromEnv ? " (from environment)" : ""
                    }. Paste a new JSON key to replace it.`
                  : "Google Cloud → IAM → Service accounts → Keys → JSON. Enable the Google Sheets API on that project."
              }
            >
              <textarea
                className="field h-28 font-mono text-xs"
                placeholder='{"type":"service_account","client_email":"...@....iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\n..."}'
                value={serviceAccountInput}
                onChange={(event) => setServiceAccountInput(event.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          </div>
        </div>

        <button className="btn mt-3" disabled={busy !== null} onClick={() => void testSheets()}>
          {busy === "sheets" ? "Testing..." : "Test spreadsheet"}
        </button>
      </section>

      <section className="panel p-5 md:col-span-2">
        <h2 className="text-base text-fg">Template</h2>
        <p className="mt-0.5 text-xs text-fg-muted">
          Layout is chosen on the Templates tab with a live preview. Active:{" "}
          <span className="text-accent">
            {TEMPLATES.find((entry) => entry.id === form.template)?.name ?? form.template}
          </span>
          .
        </p>
        <a href="/templates" className="btn mt-3 inline-flex">
          Open Templates
        </a>
      </section>

      <div className="flex items-center gap-3 md:col-span-2">
        <button className="btn btn-primary" disabled={busy !== null} onClick={() => void save()}>
          {busy === "save" ? "Saving..." : "Save settings"}
        </button>
        {status && <span className="text-xs text-accent">{status}</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-fg-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-faint">{hint}</span>}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[#22c55e]"
      />
      <span>
        <span className="block text-xs text-fg">{label}</span>
        {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
      </span>
    </label>
  );
}
