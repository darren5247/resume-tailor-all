import { STEPS, type StepId, type StepStatus } from "@/lib/pipeline/types";

const STYLES: Record<StepStatus, string> = {
  pending: "border-line-soft text-fg-faint",
  active: "border-accent-dim bg-accent-deep/50 text-accent animate-pulse-soft",
  done: "border-accent-dim/50 bg-accent-deep/30 text-accent",
  failed: "border-danger/60 bg-danger-deep text-danger",
  skipped: "border-dashed border-line text-fg-faint",
};

export function StepChips({ steps }: { steps: Record<StepId, StepStatus> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STEPS.map((step, index) => (
        <span
          key={step.id}
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] ${STYLES[steps[step.id]]}`}
          title={`${step.label}: ${steps[step.id]}`}
        >
          <span className="opacity-60">{index + 1}</span>
          {step.label}
        </span>
      ))}
    </div>
  );
}
