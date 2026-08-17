import path from "node:path";
import { LlmClient, mergeUsage } from "../llm/client";
import { assembleResume } from "../llm/assemble";
import { extractJobSpec } from "../llm/extractJob";
import { classifyCompanySignals } from "../llm/companySignals";
import { generateCoverLetter, generateResumeDraft } from "../llm/generate";
import { repairInstruction, validateDraft, type ValidationReport } from "../llm/validate";
import type { CoverLetter, JobSpec, ResumeDoc } from "../llm/schemas";
import { renderCoverLetterDocx } from "../docx/coverLetter";
import { renderResumeDocx } from "../docx/resume";
import { writePacket } from "../docx/package";
import { renderResumePdf } from "../pdf/resume";
import { detectTargetRole } from "../profile/detectRole";
import { firstName } from "../profile/schema";
import { inspectUrl } from "../scrape/detect";
import { fetchJobDescription, finalize } from "../scrape/fetchJd";
import { ScrapeError, type JdSource } from "../scrape/types";
import { scoreResume } from "../score/ats";
import { deleteSheetJob, isSheetConfigured, upsertSheetJob } from "../sheets";
import { checkSalaryEligibility, workplaceAlert } from "./eligibility";
import { resolveFolderIdentity } from "./naming";
import { getJobController, getRun, update, updateJob } from "./store";
import { initialSteps, type DownloadRef, type StepId } from "./types";

/**
 * The six-step state machine for one URL. Every step reports into the run store
 * as it starts and finishes, which is what drives the live progress cards.
 */
export async function processJob(runId: string, jobId: string, pastedJd?: string): Promise<void> {
  const record = getRun(runId);
  if (!record) return;

  const { settings, profile, controller } = record;
  const job = record.state.jobs.find((entry) => entry.id === jobId);
  if (!job || job.status === "cancelled") return;

  const jobAbort = getJobController(runId, jobId);
  const signal = combineSignals(controller.signal, jobAbort?.signal);

  const url = job.url;
  let current: StepId = "scrape";

  const setStep = (step: StepId, status: "active" | "done" | "failed" | "skipped", note?: string) => {
    current = step;
    updateJob(runId, jobId, (state) => {
      state.steps[step] = status;
      if (note !== undefined) state.note = note;
    });
  };
  const note = (text: string) =>
    updateJob(runId, jobId, (state) => {
      state.note = text;
    });

  updateJob(runId, jobId, (state) => {
    if (state.status === "cancelled") return;
    state.status = "running";
    state.startedAt = Date.now();
    state.finishedAt = null;
    state.error = null;
    state.attempts = [];
    state.canPaste = false;
    state.hiringChannel = "unknown";
    state.clientCompany = "";
    state.isStartup = false;
    state.workplaceType = "unspecified";
    state.salaryExpectation = "";
    state.salaryMin = null;
    state.salaryMax = null;
    state.salaryCurrency = "";
    state.warnings = [];
    state.violations = [];
    state.downloads = [];
    state.steps = initialSteps();
    state.note = pastedJd ? "Using pasted job description..." : "Starting...";
  });

  if (!jobStillPresent(runId, jobId)) return;
  if (getRun(runId)?.state.jobs.find((entry) => entry.id === jobId)?.status === "cancelled") return;

  let llm: LlmClient;
  try {
    throwIfAborted(signal);
    llm = new LlmClient(settings);
  } catch (error) {
    return fail(runId, jobId, current, error, []);
  }

  try {
    throwIfAborted(signal);
    let source: JdSource;

    if (pastedJd) {
      setStep("scrape", "skipped");
      setStep("fetch", "done", "Using pasted job description");
      source = finalize({ text: pastedJd, method: "pasted" });
    } else {
      setStep("scrape", "active", "Detecting job board...");
      const info = inspectUrl(url);
      if (!info) throw new Error("That does not look like a valid URL.");
      setStep("scrape", "done", info.adapterId ? `Detected ${info.adapterId}` : "No known ATS, will parse the page");

      setStep("fetch", "active", "Fetching job description...");
      source = await fetchJobDescription(url, {
        usePlaywright: settings.usePlaywrightFallback,
        signal,
        onProgress: note,
      });
      setStep("fetch", "done", `Job description via ${source.method}`);
    }

    throwIfAborted(signal);
    setStep("extract", "active", "Extracting structured JD...");
    const spec: JobSpec = await extractJobSpec(llm, source, url, signal);
    const identity = resolveFolderIdentity({
      url,
      source,
      spec,
      fallbackLabel: job.label,
    });
    // Keep JobSpec truthful to the posting for resume generation; use the
    // reconciled identity for UI labels and the dated output folder name.
    if (
      identity.company &&
      identity.company !== "company" &&
      (!spec.company.trim() || /^[a-z0-9_-]+$/.test(spec.company.trim()))
    ) {
      spec.company = identity.company;
    }
    const signals = classifyCompanySignals({
      text: source.text,
      company: spec.company || identity.company,
      url,
      llmClientCompany: spec.clientCompany,
    });
    spec.hiringChannel = signals.hiringChannel;
    spec.clientCompany = signals.clientCompany;
    spec.isStartup = signals.isStartup;
    updateJob(runId, jobId, (state) => {
      state.company = identity.company || state.company;
      state.role = identity.role || state.role;
      state.hiringChannel = spec.hiringChannel;
      state.clientCompany = spec.hiringChannel === "agency" ? spec.clientCompany : "";
      state.isStartup = spec.isStartup;
      state.workplaceType = spec.workplaceType;
      state.salaryExpectation = spec.salaryExpectation.trim();
      state.salaryMin = spec.salaryMin;
      state.salaryMax = spec.salaryMax;
      state.salaryCurrency = spec.salaryCurrency.trim().toUpperCase();
    });
    const channelNote = [
      spec.hiringChannel === "agency"
        ? spec.clientCompany
          ? `Agency · client: ${spec.clientCompany}`
          : "Agency posting"
        : spec.hiringChannel === "direct"
          ? "Direct hire"
          : "",
      spec.isStartup ? "Startup" : "",
    ]
      .filter(Boolean)
      .join(" · ") || identity.title;
    setStep("extract", "done", channelNote);
    void syncJobToSheet(runId, jobId);

    throwIfAborted(signal);
    const colombia = profile.country === "Colombia";
    setStep("generate", "active", "Checking salary / eligibility...");
    const salaryEligibility = checkSalaryEligibility(spec);
    if (!salaryEligibility.ok) throw new Error(salaryEligibility.reason);
    const officeAlert = workplaceAlert(spec);
    if (officeAlert) note(officeAlert);

    const detectedRole = colombia ? null : detectTargetRole(profile, spec);
    setStep(
      "generate",
      "active",
      colombia
        ? "Generating resume from resume prompt..."
        : detectedRole
          ? `Generating resume for ${detectedRole}...`
          : "Generating resume & cover letter...",
    );
    let draft = await generateResumeDraft(llm, profile, spec, settings, signal, undefined, detectedRole);
    setStep(
      "generate",
      "done",
      colombia ? "Used profile resume prompt" : detectedRole ? `Used ${detectedRole} base resume` : undefined,
    );

    throwIfAborted(signal);
    setStep("validate", "active", colombia ? "Assembling resume..." : "Fact-checking against your profile...");
    let report: ValidationReport = colombia
      ? { violations: [], warnings: officeAlert ? [officeAlert] : [] }
      : validateDraft(profile, spec, draft);
    if (officeAlert && !colombia) {
      report = { ...report, warnings: [officeAlert, ...report.warnings] };
    }

    // One repair round-trip (US only). Colombia follows the resume prompt alone —
    // no validation rewrite that injects extra instructions.
    if (!colombia && report.violations.length > 0) {
      note(`Fixing ${report.violations.length} unsupported claim(s)...`);
      draft = await generateResumeDraft(
        llm,
        profile,
        spec,
        settings,
        signal,
        repairInstruction(report),
        detectedRole,
      );
      const second = validateDraft(profile, spec, draft);
      report = { violations: second.violations, warnings: [...report.warnings, ...second.warnings] };
    }

    const resume: ResumeDoc = assembleResume(profile, spec, draft, detectedRole);
    const score = scoreResume(resume, spec, report);
    updateJob(runId, jobId, (state) => {
      state.atsScore = score.total;
      state.matchedKeywords = score.matched;
      state.missingKeywords = score.missing;
      state.warnings = report.warnings;
      state.violations = report.violations;
    });
    setStep("validate", "done", `ATS ${score.total}/100`);

    throwIfAborted(signal);
    if (!jobStillPresent(runId, jobId)) return;
    let letter: CoverLetter | null = null;
    if (settings.includeCoverLetter) {
      note("Writing cover letter...");
      letter = await generateCoverLetter(llm, profile, spec, draft, settings, signal);
    }

    throwIfAborted(signal);
    if (!jobStillPresent(runId, jobId)) return;
    setStep("zip", "active", "Rendering documents...");
    const [resumeDocx, resumePdf] = await Promise.all([
      renderResumeDocx(resume, settings.template),
      renderResumePdf(resume, settings.template),
    ]);
    const coverDocx = letter ? await renderCoverLetterDocx(letter, resume, spec, settings.template) : null;

    throwIfAborted(signal);
    if (!jobStillPresent(runId, jobId)) return;
    const packet = await writePacket({
      outputDir: settings.outputDir,
      company: identity.company,
      role: identity.role,
      firstName: firstName(profile),
      resumeDocx,
      resumePdf,
      coverLetterDocx: coverDocx,
      jobDescription: `${url}\n\n${source.text}`,
      extractedJd: spec,
      metadata: {
        url,
        scrapedVia: source.method,
        company: identity.company,
        role: identity.role,
        hiringChannel: spec.hiringChannel,
        clientCompany: spec.clientCompany,
        isStartup: spec.isStartup,
        workplaceType: spec.workplaceType,
        salaryExpectation: spec.salaryExpectation,
        salaryMin: spec.salaryMin,
        salaryMax: spec.salaryMax,
        salaryCurrency: spec.salaryCurrency,
        folderTitle: identity.title,
        location: spec.location,
        seniority: spec.seniority,
        template: settings.template,
        model: settings.model,
        generatedAt: new Date().toISOString(),
        atsScore: score.total,
        atsBreakdown: score.breakdown,
        matchedKeywords: score.matched,
        missingKeywords: score.missing,
        warnings: report.warnings,
        unresolvedViolations: report.violations,
        detectedRole: detectedRole ?? null,
        usage: llm.usage,
        sheetConfigured: isSheetConfigured(settings),
      },
    });

    const person = firstName(profile);
    const downloads: DownloadRef[] = [
      { label: `Resume-${person}.docx`, file: rel(settings.outputDir, packet.resume), kind: "resume" },
      { label: `Resume-${person}.pdf`, file: rel(settings.outputDir, packet.resumePdf), kind: "resume-pdf" },
    ];
    if (packet.coverLetter) {
      downloads.push({ label: `Coverletter-${person}.docx`, file: rel(settings.outputDir, packet.coverLetter), kind: "cover" });
    }
    downloads.push({ label: path.basename(packet.zip), file: rel(settings.outputDir, packet.zip), kind: "zip" });

    if (!jobStillPresent(runId, jobId)) return;
    setStep("zip", "done");
    updateJob(runId, jobId, (state) => {
      if (state.status === "cancelled") return;
      state.downloads = downloads;
      state.status = "done";
      state.note = "";
      state.finishedAt = Date.now();
      state.usage = llm.usage;
    });
    update(runId, (state) => {
      state.usage = mergeUsage(state.usage, llm.usage);
    });
    void syncJobToSheet(runId, jobId, path.basename(packet.folder));
  } catch (error) {
    update(runId, (state) => {
      state.usage = mergeUsage(state.usage, llm.usage);
    });
    fail(runId, jobId, current, error, error instanceof ScrapeError ? error.attempts : []);
  }
}

function fail(runId: string, jobId: string, step: StepId, error: unknown, attempts: string[]): void {
  const aborted = error instanceof Error && (error.name === "AbortError" || error.message === "cancelled");
  updateJob(runId, jobId, (state) => {
    if (state.status === "cancelled" || state.status === "done") return;
    state.steps[step] = aborted ? "pending" : "failed";
    state.status = aborted ? "cancelled" : "failed";
    state.error = aborted ? "Cancelled." : error instanceof Error ? error.message : String(error);
    state.attempts = attempts;
    // Anything that died before the model saw a description can be rescued by
    // pasting it in; a failure after that is not the scraper's fault.
    state.canPaste = !aborted && (step === "scrape" || step === "fetch");
    state.note = "";
    state.finishedAt = Date.now();
  });
}

function jobStillPresent(runId: string, jobId: string): boolean {
  return Boolean(getRun(runId)?.state.jobs.some((entry) => entry.id === jobId));
}

async function syncJobToSheet(runId: string, jobId: string, folder?: string): Promise<void> {
  const record = getRun(runId);
  const job = record?.state.jobs.find((entry) => entry.id === jobId);
  if (!record || !job || !isSheetConfigured(record.settings)) return;
  const url = job.url;
  try {
    await upsertSheetJob(
      {
        url,
        company: job.company,
        role: job.role,
        badges: job,
        folder,
      },
      record.settings,
    );
  } catch (error) {
    if (!jobStillPresent(runId, jobId)) return;
    const message = error instanceof Error ? error.message : String(error);
    updateJob(runId, jobId, (state) => {
      if (!state.warnings.includes(`Google Sheet: ${message}`)) {
        state.warnings.push(`Google Sheet: ${message}`);
      }
    });
    return;
  }
  if (!jobStillPresent(runId, jobId)) {
    await deleteSheetJob(url, record.settings).catch(() => undefined);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("cancelled");
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const live = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (live.length === 0) return new AbortController().signal;
  if (live.length === 1) return live[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(live);

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of live) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function rel(outputDir: string, absolute: string): string {
  return path.relative(outputDir, absolute).split(path.sep).join("/");
}
