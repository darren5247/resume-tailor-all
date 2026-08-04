"use client";

import { useState } from "react";
import { ResumePreview } from "./ResumePreview";
import { TEMPLATES, type TemplateId } from "@/lib/settings-schema";
import type { ResumeDoc } from "@/lib/llm/schemas";

export function TemplatesView({
  initialTemplate,
  previewResume,
  usingSample,
}: {
  initialTemplate: TemplateId;
  previewResume: ResumeDoc;
  usingSample: boolean;
}) {
  const [selected, setSelected] = useState<TemplateId>(initialTemplate);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const select = async (id: TemplateId) => {
    if (id === selected && !error) return;
    const previous = selected;
    setSelected(id);
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: id }),
      });
      const data = (await response.json()) as { error?: string; template?: TemplateId };
      if (!response.ok) {
        setSelected(previous);
        setError(data.error ?? "Could not save template.");
        return;
      }
      const name = TEMPLATES.find((entry) => entry.id === (data.template ?? id))?.name ?? id;
      setStatus(`${name} selected — used on the next Generate run.`);
    } catch (caught) {
      setSelected(previous);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="panel flex min-h-[70vh] flex-col p-5">
        <p className="text-xs leading-relaxed text-fg-muted">
          Every template is single-column and ATS-safe — parsers read them all cleanly. Pick one and the preview
          on the right updates with {usingSample ? "a sample resume" : "your active profile"}.
        </p>

        <div className="mt-4 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {TEMPLATES.map((template) => {
            const active = template.id === selected;
            return (
              <button
                key={template.id}
                type="button"
                disabled={busy}
                onClick={() => void select(template.id)}
                className={`w-full rounded-lg border px-3.5 py-3 text-left transition-colors ${
                  active
                    ? "border-accent-dim bg-accent-deep/30"
                    : "border-transparent hover:border-line hover:bg-panel-2/70"
                }`}
              >
                <div className={`text-sm ${active ? "text-accent" : "text-fg"}`}>{template.name}</div>
                <div className="mt-0.5 text-xs leading-relaxed text-fg-muted">{template.description}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-3 min-h-[1.25rem] text-xs">
          {status && <span className="text-accent">{status}</span>}
          {error && <span className="text-danger">{error}</span>}
        </div>
      </section>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-2 text-sm text-fg">Preview</div>
        <div className="flex justify-center rounded-xl border border-line bg-panel-2/50 p-4">
          <ResumePreview resume={previewResume} templateId={selected} />
        </div>
        <p className="mt-2 text-[11px] text-fg-faint">
          Preview is scaled to fit. The generated DOCX uses the same layout rules at full page size.
        </p>
      </aside>
    </div>
  );
}
