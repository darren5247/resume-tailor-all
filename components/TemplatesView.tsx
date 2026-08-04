"use client";

import { useEffect, useState } from "react";
import { ResumePreview } from "./ResumePreview";
import { TEMPLATES, type TemplateId } from "@/lib/settings-schema";
import type { ResumeDoc } from "@/lib/llm/schemas";

const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.25;
const ZOOM_DEFAULT = 1;
const ZOOM_STORAGE_KEY = "resume-preview-zoom";

function clampZoom(value: number): number {
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(stepped.toFixed(2))));
}

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
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(ZOOM_STORAGE_KEY);
      if (!stored) return;
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) setZoom(clampZoom(parsed));
    } catch {
      // sessionStorage can be blocked; keep the default zoom.
    }
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
    } catch {
      // Ignore persistence failures.
    }
  }, [zoom]);

  const zoomOut = () => setZoom((current) => clampZoom(current - ZOOM_STEP));
  const zoomIn = () => setZoom((current) => clampZoom(current + ZOOM_STEP));
  const zoomReset = () => setZoom(ZOOM_DEFAULT);

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

  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const canZoomOut = zoom > ZOOM_MIN;
  const canZoomIn = zoom < ZOOM_MAX;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,540px)]">
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm text-fg">Preview</div>
          <div className="flex items-center gap-1" role="group" aria-label="Preview zoom">
            <button
              type="button"
              className="rounded border border-line bg-panel px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-line hover:bg-panel-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Zoom out"
              disabled={!canZoomOut}
              onClick={zoomOut}
            >
              −
            </button>
            <button
              type="button"
              className="min-w-[3.25rem] rounded border border-line bg-panel px-2 py-0.5 text-xs tabular-nums text-fg-muted transition-colors hover:border-line hover:bg-panel-2 hover:text-fg"
              aria-label={`Reset zoom to ${Math.round(ZOOM_DEFAULT * 100)} percent`}
              title="Reset zoom"
              onClick={zoomReset}
            >
              {zoomLabel}
            </button>
            <button
              type="button"
              className="rounded border border-line bg-panel px-2 py-0.5 text-xs text-fg-muted transition-colors hover:border-line hover:bg-panel-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Zoom in"
              disabled={!canZoomIn}
              onClick={zoomIn}
            >
              +
            </button>
          </div>
        </div>
        <div className="max-h-[min(78vh,920px)] overflow-auto rounded-xl border border-line bg-panel-2/50 p-4">
          <div className="mx-auto w-fit" style={{ zoom }}>
            <ResumePreview resume={previewResume} templateId={selected} />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-fg-faint">
          Zoom {zoomLabel}. The generated PDF uses the same layout rules at full page size.
        </p>
      </aside>
    </div>
  );
}
