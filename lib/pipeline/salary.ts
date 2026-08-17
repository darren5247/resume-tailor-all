/** Fields the job card needs to render stated pay. Extra keys are ignored. */
export interface SalaryFields {
  salaryExpectation?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
}

/**
 * Compact "USD 90k–110k / year" (or the posting's own phrasing) when pay is stated.
 * Returns null when the posting has no cash figure and no currency.
 */
export function formatSalaryLabel(job: SalaryFields): string | null {
  const currency = (job.salaryCurrency ?? "").trim().toUpperCase();
  const range = formatRange(finiteOrNull(job.salaryMin), finiteOrNull(job.salaryMax));
  const expectation = (job.salaryExpectation ?? "").trim();

  if (range) {
    const period = periodSuffix(expectation);
    const body = currency ? `${currency} ${range}` : range;
    return `${body}${period}`;
  }

  if (expectation) {
    if (currency && !mentionsCurrency(expectation, currency)) {
      return `${expectation} · ${currency}`;
    }
    return expectation;
  }

  return currency || null;
}

function formatRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    if (min === max) return compactNumber(min);
    const [lo, hi] = min <= max ? [min, max] : [max, min];
    return `${compactNumber(lo)}–${compactNumber(hi)}`;
  }
  return compactNumber((min ?? max) as number);
}

function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${trimDecimal(value / 1_000)}k`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function trimDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function periodSuffix(expectation: string): string {
  const match = expectation.match(/\b(?:per\s+)?(year|yr|annum|annual|month|mo|week|wk|hour|hr|day)s?\b/i);
  if (!match) return "";
  const unit = match[1].toLowerCase();
  const period =
    unit === "year" || unit === "yr" || unit === "annum" || unit === "annual"
      ? "year"
      : unit === "month" || unit === "mo"
        ? "month"
        : unit === "week" || unit === "wk"
          ? "week"
          : unit === "hour" || unit === "hr"
            ? "hour"
            : "day";
  return ` / ${period}`;
}

function mentionsCurrency(text: string, code: string): boolean {
  if (new RegExp(`\\b${code}\\b`, "i").test(text)) return true;
  return code === "USD" && /\$/.test(text);
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
