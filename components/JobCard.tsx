"use client";

import { useState } from "react";
import { StepChips } from "./StepChips";
import type { HiringChannel, WorkplaceType } from "@/lib/llm/schemas";
import { formatSalaryLabel } from "@/lib/pipeline/salary";
import type { JobState } from "@/lib/pipeline/types";

const STATUS_BADGE: Record<JobState["status"], string> = {
  queued: "border-line text-fg-faint",
  running: "border-accent-dim/60 bg-accent-deep/40 text-accent",
  done: "border-accent-dim/60 bg-accent-deep/40 text-accent",
  failed: "border-danger/60 bg-danger-deep text-danger",
  cancelled: "border-line text-fg-muted",
};

const HIRING_BADGE: Record<
  Exclude<HiringChannel, "unknown">,
  { label: string; className: string }
> = {
  direct: {
    label: "Direct hire",
    className: "border-accent-dim/50 bg-accent-deep/30 text-accent",
  },
  agency: {
    label: "Agency",
    className: "border-warn/50 bg-warn/10 text-warn",
  },
};

const STARTUP_BADGE = {
  label: "Startup",
  className: "border-info/50 bg-info-deep/40 text-info",
};

const WORKPLACE_ALERT: Record<
  Extract<WorkplaceType, "hybrid" | "onsite">,
  { label: string; className: string }
> = {
  hybrid: {
    label: "Hybrid",
    className: "border-warn/50 bg-warn/10 text-warn",
  },
  onsite: {
    label: "On-site",
    className: "border-warn/50 bg-warn/10 text-warn",
  },
};

export function JobCard({ job, runId, onChanged }: { job: JobState; runId: string; onChanged: () => void }) {
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<"retry" | "paste" | "cancel" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const failed = job.status === "failed";
  const done = job.status === "done";
  const cancellable = job.status === "queued" || job.status === "running";
  const hiringBadge =
    job.hiringChannel === "direct" || job.hiringChannel === "agency"
      ? HIRING_BADGE[job.hiringChannel]
      : null;
  const workplaceBadge =
    job.workplaceType === "hybrid" || job.workplaceType === "onsite"
      ? WORKPLACE_ALERT[job.workplaceType]
      : null;
  const salaryLabel = formatSalaryLabel(job);

  const send = async (kind: "retry" | "paste") => {
    setBusy(kind);
    setActionError(null);
    try {
      const response = await fetch(`/api/runs/${runId}/jobs/${job.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "paste" ? { pastedJd: pasted } : {}),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setActionError(data.error ?? "That did not work.");
      } else {
        onChanged();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const cancelJob = async () => {
    setBusy("cancel");
    setActionError(null);
    try {
      const response = await fetch(`/api/runs/${runId}/jobs/${job.id}/cancel`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setActionError(data.error ?? "Could not cancel.");
      } else {
        onChanged();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const deleteJob = async () => {
    setBusy("delete");
    setActionError(null);
    try {
      const response = await fetch(`/api/runs/${runId}/jobs/${job.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setActionError(data.error ?? "Could not delete.");
      } else {
        onChanged();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        failed ? "border-danger/40 bg-danger-deep/20" : "border-line bg-panel-2/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-6 shrink-0 text-right text-xs text-fg-faint">{job.index + 1}</span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-sm text-fg">{job.company || job.label}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_BADGE[job.status]}`}>
                {job.status}
              </span>
              {hiringBadge && (
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${hiringBadge.className}`}
                  title={
                    job.hiringChannel === "agency" && job.clientCompany
                      ? `Agency posting · client: ${job.clientCompany}`
                      : hiringBadge.label
                  }
                >
                  {hiringBadge.label}
                  {job.hiringChannel === "agency" && job.clientCompany ? ` · ${job.clientCompany}` : ""}
                </span>
              )}
              {job.isStartup && (
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STARTUP_BADGE.className}`}
                  title="Posting identifies this employer as a startup"
                >
                  {STARTUP_BADGE.label}
                </span>
              )}
              {workplaceBadge && (
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${workplaceBadge.className}`}
                  title={`Job requires ${workplaceBadge.label.toLowerCase()} work`}
                >
                  {workplaceBadge.label}
                </span>
              )}
              {job.atsScore !== null && (
                <span className="rounded border border-accent-dim/50 bg-accent-deep/30 px-1.5 py-0.5 text-[10px] text-accent">
                  ATS {job.atsScore}/100
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {cancellable && (
                <button className="btn" disabled={busy !== null} onClick={() => void cancelJob()}>
                  {busy === "cancel" ? "Cancelling..." : "Cancel"}
                </button>
              )}
              <button className="btn btn-danger" disabled={busy !== null} onClick={() => void deleteJob()}>
                {busy === "delete" ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>

          {job.role && <div className="mt-0.5 text-sm text-fg-muted">{job.role}</div>}
          {salaryLabel && (
            <div className="mt-0.5 text-xs text-accent" title="Stated compensation from the posting">
              {salaryLabel}
            </div>
          )}

          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 block truncate text-[11px] text-fg-faint hover:text-accent"
            title={job.url}
          >
            {job.url}
          </a>

          <div className="mt-3">
            <StepChips steps={job.steps} />
          </div>

          {job.note && <div className="mt-2 text-xs text-fg-muted">{job.note}</div>}

          {workplaceBadge && (done || failed) && (
            <div className="mt-2 text-xs text-warn">
              Job requires {workplaceBadge.label.toLowerCase()} work.
            </div>
          )}

          {failed && job.error && (
            <div className="mt-3 text-xs leading-relaxed text-danger">{job.error}</div>
          )}

          {failed && job.attempts.length > 0 && (
            <details className="mt-2 text-[11px] text-fg-faint">
              <summary className="cursor-pointer hover:text-fg-muted">What was tried ({job.attempts.length})</summary>
              <ul className="mt-1 list-inside list-disc space-y-0.5 pl-1">
                {job.attempts.map((attempt, index) => (
                  <li key={index}>{attempt}</li>
                ))}
              </ul>
            </details>
          )}

          {failed && job.canPaste && (
            <div className="mt-3">
              <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-faint">
                Paste job description (for blocked / captcha pages)
              </div>
              <textarea
                className="field h-28"
                placeholder="Paste the full job description text here, then generate with pasted JD."
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button className="btn btn-danger" disabled={busy !== null} onClick={() => void send("retry")}>
                  {busy === "retry" ? "Retrying..." : "Retry scrape"}
                </button>
                <button
                  className="btn"
                  disabled={busy !== null || pasted.trim().length < 400}
                  onClick={() => void send("paste")}
                >
                  {busy === "paste" ? "Generating..." : "Generate with pasted JD"}
                </button>
                {pasted.trim().length > 0 && pasted.trim().length < 400 && (
                  <span className="text-[11px] text-fg-faint">{pasted.trim().length}/400 characters</span>
                )}
              </div>
            </div>
          )}

          {failed && !job.canPaste && (
            <button className="btn btn-danger mt-3" disabled={busy !== null} onClick={() => void send("retry")}>
              {busy === "retry" ? "Retrying..." : "Retry job"}
            </button>
          )}

          {actionError && <div className="mt-2 text-xs text-danger">{actionError}</div>}

          {done && job.downloads.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-[10px] uppercase tracking-wide text-fg-faint">Downloads</div>
              <div className="flex flex-wrap gap-2">
                {job.downloads.map((download) => (
                  <a
                    key={download.file}
                    className="btn"
                    href={`/api/runs/${runId}/download?file=${encodeURIComponent(download.file)}`}
                  >
                    {download.label}
                  </a>
                ))}
              </div>
            </div>
          )}

          {done && (job.missingKeywords.length > 0 || job.warnings.length > 0 || job.violations.length > 0) && (
            <div className="mt-3 text-[11px]">
              <button className="text-fg-faint hover:text-fg-muted" onClick={() => setShowDetail((value) => !value)}>
                {showDetail ? "Hide" : "Show"} match detail
              </button>

              {showDetail && (
                <div className="mt-2 space-y-2 border-l border-line pl-3">
                  {job.violations.length > 0 && (
                    <div>
                      <div className="text-danger">Unsupported claims left in the resume</div>
                      <ul className="mt-0.5 list-inside list-disc text-fg-muted">
                        {job.violations.map((violation, index) => (
                          <li key={index}>{violation}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {job.missingKeywords.length > 0 && (
                    <div>
                      <div className="text-fg-muted">Posting keywords not present ({job.missingKeywords.length})</div>
                      <div className="mt-0.5 text-fg-faint">{job.missingKeywords.join(", ")}</div>
                    </div>
                  )}
                  {job.warnings.length > 0 && (
                    <div>
                      <div className="text-warn">Warnings</div>
                      <ul className="mt-0.5 list-inside list-disc text-fg-muted">
                        {job.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
