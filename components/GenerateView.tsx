"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JobCard } from "./JobCard";
import { parseUrlList } from "@/lib/scrape/url";
import { summarize, type RunState } from "@/lib/pipeline/types";

export function GenerateView({
  ready,
  readyMessage,
  profileLabel,
  templateName,
}: {
  ready: boolean;
  readyMessage: string;
  profileLabel: string;
  templateName: string;
}) {
  const [urlsText, setUrlsText] = useState("");
  const [run, setRun] = useState<RunState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  const linkCount = useMemo(() => parseUrlList(urlsText).urls.length, [urlsText]);
  const counts = run ? summarize(run) : null;
  const running = run?.status === "running";

  useEffect(() => {
    if (!run?.id) return;
    const source = new EventSource(`/api/runs/${run.id}/stream`);
    sourceRef.current = source;

    source.onmessage = (event) => {
      try {
        setRun(JSON.parse(event.data) as RunState);
      } catch {
        // Ignore a torn frame; the next one carries the whole state anyway.
      }
    };
    source.addEventListener("missing", () => source.close());
    source.onerror = () => {
      // EventSource retries on its own; only a closed stream is terminal.
      if (source.readyState === EventSource.CLOSED) sourceRef.current = null;
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [run?.id]);

  const refresh = useCallback(async () => {
    if (!run?.id) return;
    const response = await fetch(`/api/runs/${run.id}`);
    if (response.ok) setRun((await response.json()) as RunState);
  }, [run?.id]);

  const start = async () => {
    setStarting(true);
    setError(null);
    setInvalid([]);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urlsText }),
      });
      const data = (await response.json()) as { run?: RunState; invalid?: string[]; error?: string };
      if (!response.ok || !data.run) {
        setError(data.error ?? "Could not start the run.");
        return;
      }
      setRun(data.run);
      setInvalid(data.invalid ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!run?.id) return;
    await fetch(`/api/runs/${run.id}/cancel`, { method: "POST" });
  };

  const batchLabel = run
    ? `running batch ${run.currentBatch}/${run.batchCount} · jobs ${
        (run.currentBatch - 1) * run.batchSize + 1
      }-${Math.min(run.currentBatch * run.batchSize, run.total)} of ${run.total}`
    : "";

  return (
    <>
      <section className="panel p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-base text-fg">Job URLs</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              One per line. Jobs run in batches of {run?.batchSize ?? 10}. Generating for{" "}
              <span className="text-accent">{profileLabel}</span>
              {" · "}
              template <span className="text-accent">{templateName}</span>.
            </p>
          </div>
          <span className="text-xs text-accent">{linkCount} links</span>
        </div>

        <textarea
          className="field h-44"
          placeholder={"https://job-boards.greenhouse.io/acme/jobs/1234567\nhttps://jobs.lever.co/acme/8f2c...\nhttps://apply.workable.com/acme/j/AB12CD34/"}
          value={urlsText}
          onChange={(event) => setUrlsText(event.target.value)}
          spellCheck={false}
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn btn-primary"
            disabled={starting || running || linkCount === 0 || !ready}
            onClick={() => void start()}
          >
            {starting ? "Starting..." : running ? "Processing..." : "Generate resumes"}
          </button>

          {running && (
            <>
              <span className="text-xs text-fg-muted">{batchLabel}</span>
              <button className="btn btn-danger" onClick={() => void cancel()}>
                Cancel
              </button>
            </>
          )}

          {!ready && <span className="text-xs text-warn">{readyMessage}</span>}
        </div>

        {error && <div className="mt-3 text-xs text-danger">{error}</div>}

        {invalid.length > 0 && (
          <div className="mt-3 text-xs text-warn">
            Skipped {invalid.length} line(s) that are not URLs: {invalid.slice(0, 3).join(", ")}
            {invalid.length > 3 ? "..." : ""}
          </div>
        )}
      </section>

      {run && counts && (
        <section className="panel p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base text-fg">Progress</h2>
              <p className="mt-0.5 text-xs text-fg-muted">
                {counts.done} done · {counts.running} running · {counts.failed} failed
                {counts.cancelled > 0 && ` · ${counts.cancelled} cancelled`}
                {run.usage.calls > 0 && (
                  <>
                    {" "}
                    · {(run.usage.promptTokens + run.usage.completionTokens).toLocaleString()} tokens
                    {run.usage.costUsd > 0 && ` · $${run.usage.costUsd.toFixed(3)}`}
                  </>
                )}
              </p>
            </div>

            {counts.done > 0 && (
              <a className="btn btn-primary" href={`/api/runs/${run.id}/download-all`}>
                Download All ({counts.done})
              </a>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {run.jobs.map((job) => (
              <JobCard key={job.id} job={job} runId={run.id} onChanged={() => void refresh()} />
            ))}
          </div>

          <p className="mt-4 text-[11px] text-fg-faint">
            Files are written to {run.outputDir}
          </p>
        </section>
      )}
    </>
  );
}
