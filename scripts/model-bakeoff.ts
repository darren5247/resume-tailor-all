/**
 * Runs the same job description through several models and reports the ATS score
 * next to the credibility signals the score cannot see.
 *
 * The ATS scorer rewards keyword mirroring, so a fabricated resume can outscore an
 * honest one. This harness prints both so a model is chosen on the pair, not the score.
 *
 *   npm run bakeoff -- output/<run-dir>/job-description.txt
 *   npm run bakeoff -- jd.txt --models openai/gpt-4.1,anthropic/claude-sonnet-4 --runs 3
 *
 * The JD is read from disk and the JobSpec is extracted once, so the only variable
 * across rows is the resume-generation call itself.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { LlmClient } from "../lib/llm/client";
import { assembleResume, resumeToText } from "../lib/llm/assemble";
import { extractJobSpec } from "../lib/llm/extractJob";
import { generateResumeDraft } from "../lib/llm/generate";
import { containsTerm, normalize, validateDraft } from "../lib/llm/validate";
import type { JobSpec, ResumeDoc } from "../lib/llm/schemas";
import { profileCorpus, type Profile } from "../lib/profile/schema";
import { loadProfile } from "../lib/profile/store";
import { finalize } from "../lib/scrape/fetchJd";
import { scoreResume } from "../lib/score/ats";
import { loadSettings } from "../lib/settings";

const DEFAULT_MODELS = ["openai/gpt-4.1", "anthropic/claude-sonnet-4"];

interface Row {
  model: string;
  run: number;
  score: number;
  mustHave: string;
  unverified: string[];
  profileMetrics: number;
  resumeMetrics: number;
  pronouns: number;
  dupSkills: string[];
  headlineExact: boolean;
  violations: string[];
  file: string;
  costUsd: number;
}

async function main() {
  const args = process.argv.slice(2);
  const jdPath = args.find((arg) => !arg.startsWith("--"));
  if (!jdPath) {
    console.error("Usage: npm run bakeoff -- <job-description.txt> [--models a,b] [--runs N]");
    process.exit(1);
  }

  const models = flagValue(args, "--models")?.split(",").map((m) => m.trim()).filter(Boolean) ?? DEFAULT_MODELS;
  const runs = Number(flagValue(args, "--runs") ?? 2);

  const settings = await loadSettings();
  const profile = await loadProfile();
  if (!settings.apiKey) throw new Error("No API key in data/settings.json.");
  if (profile.country === "Colombia" && !profile.resumePrompt.trim()) {
    throw new Error("The active profile is Colombia but has no resumePrompt.");
  }

  const jdText = await fs.readFile(jdPath, "utf8");
  const source = finalize({ text: jdText, method: "pasted" });

  // Extract once so every row sees an identical JobSpec.
  const extractor = new LlmClient({ ...settings, model: models[0] });
  const job = await extractJobSpec(extractor, source, "bakeoff://local");
  console.log(`JD: ${job.title || "(no title)"} at ${job.company || "(no company)"}`);
  console.log(`Profile: ${profile.fullName} (${profile.country}) · prompt ${profile.resumePrompt.length} chars`);
  console.log(`mustHave ${job.mustHave.length} · niceToHave ${job.niceToHave.length} · keywords ${job.keywords.length}`);
  console.log(`${models.length} model(s) x ${runs} run(s)\n`);

  const outDir = path.join(settings.outputDir, "_bakeoff");
  await fs.mkdir(outDir, { recursive: true });

  const rows: Row[] = [];
  for (const model of models) {
    for (let run = 1; run <= runs; run += 1) {
      const label = `${model} run ${run}`;
      const started = Date.now();
      try {
        rows.push(await evaluate(model, run, settings, profile, job, outDir));
        const last = rows[rows.length - 1];
        console.log(
          `OK   ${label.padEnd(38)} ATS ${String(last.score).padStart(3)}  ` +
            `unverified ${String(last.unverified.length).padStart(2)}  ` +
            `metrics ${last.resumeMetrics}/${last.profileMetrics}  ` +
            `${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
      } catch (error) {
        console.log(`FAIL ${label.padEnd(38)} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  report(rows, outDir);
}

async function evaluate(
  model: string,
  run: number,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  profile: Profile,
  job: JobSpec,
  outDir: string,
): Promise<Row> {
  const llm = new LlmClient({ ...settings, model });
  const draft = await generateResumeDraft(llm, profile, job, { ...settings, model });
  const resume = assembleResume(profile, job, draft, null);

  // Production scores Colombia with an empty report, so mirror that for comparability
  // and surface validateDraft separately as a credibility signal.
  const score = scoreResume(resume, job, { violations: [], warnings: [] });
  const audit = validateDraft(profile, job, draft);

  const text = resumeToText(resume);
  const file = path.join(outDir, `${model.replace(/[^a-z0-9.]+/gi, "-")}-run${run}.txt`);
  await fs.writeFile(file, renderPlain(resume), "utf8");

  const must = score.breakdown.find((entry) => entry.label === "Must-have coverage");

  return {
    model,
    run,
    score: score.total,
    mustHave: must?.detail ?? "",
    unverified: unverifiedTech(resume, profile),
    profileMetrics: countMetrics(profile.experience.flatMap((entry) => entry.highlights)),
    resumeMetrics: countMetrics(resume.experience.flatMap((entry) => entry.bullets)),
    pronouns: resume.experience.flatMap((entry) => [entry.overview, ...entry.bullets]).filter((line) =>
      /\b(I|my|me)\b/.test(line),
    ).length,
    dupSkills: duplicateSkills(resume),
    headlineExact: normalize(resume.headline) === normalize(job.title),
    violations: audit.violations,
    file,
    costUsd: llm.usage.costUsd,
  };
}

/**
 * Technology on a role's technologies line that cannot be grounded in the profile.
 * Skills-section terms are excluded: parking a gap there is the intended behaviour.
 *
 * Reported as "unverified", not "fabricated". Term matching is surface-based, so a
 * legitimate alias the profile spells differently ("Kafka" vs "Apache Kafka") lands
 * here too. Read the flagged terms before treating a row as dishonest.
 */
function unverifiedTech(resume: ResumeDoc, profile: Profile): string[] {
  const corpus = normalize(profileCorpus(profile));
  const claimed = new Set<string>();
  for (const entry of resume.experience) {
    for (const item of entry.technologies) claimed.add(item.trim());
  }
  return [...claimed].filter((item) => item.length >= 2 && !containsTerm(corpus, item)).sort();
}

/** Bullets carrying at least one digit — the proxy for "concrete scale". */
function countMetrics(lines: string[]): number {
  return lines.filter((line) => /\d/.test(line)).length;
}

/** Items repeated across skill groups, which reads as stuffing to a human. */
function duplicateSkills(resume: ResumeDoc): string[] {
  const seen = new Map<string, number>();
  for (const group of resume.skills) {
    for (const item of group.items) {
      const key = normalize(item);
      if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key).sort();
}

function report(rows: Row[], outDir: string): void {
  if (rows.length === 0) return;
  console.log(`\n${"=".repeat(78)}`);

  const byModel = new Map<string, Row[]>();
  for (const row of rows) {
    byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);
  }

  for (const [model, group] of byModel) {
    const scores = group.map((row) => row.score);
    const avg = (scores.reduce((sum, n) => sum + n, 0) / scores.length).toFixed(1);
    const unverified = group.reduce((sum, row) => sum + row.unverified.length, 0);
    const cost = group.reduce((sum, row) => sum + row.costUsd, 0);

    console.log(`\n${model}`);
    console.log(`  ATS score        avg ${avg}  range ${Math.min(...scores)}-${Math.max(...scores)}`);
    console.log(`  Unverified tech  ${unverified} total across ${group.length} run(s)`);
    console.log(`  Metrics kept     ${group.map((row) => `${row.resumeMetrics}/${row.profileMetrics}`).join(", ")}`);
    console.log(`  Pronoun lines    ${group.map((row) => row.pronouns).join(", ")}`);
    console.log(`  Dup skill items  ${group.map((row) => row.dupSkills.length).join(", ")}`);
    console.log(`  Headline exact   ${group.map((row) => (row.headlineExact ? "yes" : "no")).join(", ")}`);
    if (cost > 0) console.log(`  Cost             $${cost.toFixed(4)}`);

    for (const row of group) {
      const issues = [
        row.unverified.length > 0 ? `unverified: ${row.unverified.join(", ")}` : "",
        row.dupSkills.length > 0 ? `duplicated skills: ${row.dupSkills.join(", ")}` : "",
        ...row.violations,
      ].filter(Boolean);
      if (issues.length > 0) {
        console.log(`    run ${row.run}:`);
        for (const issue of issues) console.log(`      - ${issue}`);
      }
    }
  }

  console.log(`\nResumes written to ${outDir}`);
}

function renderPlain(resume: ResumeDoc): string {
  const lines = [resume.name, resume.headline, resume.contactLine.join("  |  "), "", "SUMMARY", resume.summary, ""];
  lines.push("SKILLS");
  for (const group of resume.skills) lines.push(`${group.label}: ${group.items.join(", ")}`);
  lines.push("", "EXPERIENCE");
  for (const entry of resume.experience) {
    lines.push("", `${entry.company} | ${entry.role} | ${entry.location} | ${entry.period}`, entry.overview);
    for (const bullet of entry.bullets) lines.push(`- ${bullet}`);
    if (entry.technologies.length > 0) lines.push(`Technologies used: ${entry.technologies.join(", ")}`);
  }
  lines.push("", "EDUCATION");
  for (const entry of resume.education) lines.push(`${entry.degree} — ${entry.school} (${entry.period})`);
  lines.push("", "CERTIFICATIONS");
  for (const entry of resume.certifications) lines.push(`${entry.name} — ${entry.issuer} ${entry.date}`);
  return `${lines.join("\n")}\n`;
}

function flagValue(args: string[], flag: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
