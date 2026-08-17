import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { JdSource } from "./types";

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "header", "footer", "ul", "ol", "table", "tr",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "dl", "dt", "dd",
]);

const DROP_TAGS = new Set(["script", "style", "noscript", "svg", "iframe", "nav", "form", "template"]);

/**
 * HTML to text that keeps the shape of a job description. Bullet lists matter
 * here: "5+ years of Python" as a list item reads very differently to the model
 * than the same words melted into a paragraph.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  // Some ATS APIs return escaped HTML (Greenhouse does), so unescape before parsing.
  const unescaped = looksEscaped(html) ? decodeEntities(html) : html;
  const $ = cheerio.load(unescaped);
  $([...DROP_TAGS].join(",")).remove();

  const out: string[] = [];

  const walk = (node: AnyNode) => {
    if (node.type === "text") {
      const text = (node.data ?? "").replace(/\s+/g, " ");
      if (text.trim()) out.push(text);
      return;
    }
    if (node.type !== "tag") return;

    const tag = node.name.toLowerCase();
    if (DROP_TAGS.has(tag)) return;

    if (tag === "br") {
      out.push("\n");
      return;
    }
    if (tag === "li") out.push("\n- ");
    else if (BLOCK_TAGS.has(tag)) out.push("\n");

    for (const child of node.children) walk(child);

    if (BLOCK_TAGS.has(tag) || tag === "li") out.push("\n");
  };

  for (const node of $.root().children().toArray()) walk(node);

  return normalizeWhitespace(out.join(""));
}

/**
 * Phrases that separate a real posting from a careers landing page. Without
 * this, a 600 character cookie banner passes a pure length check and the model
 * cheerfully tailors a resume to nothing.
 *
 * One entry per concept, with the translations a posting might use, because the
 * threshold below counts concepts. Postings routinely arrive in the language of
 * the market they hire for, and an English-only list rejects them wholesale.
 */
const JD_SIGNALS = [
  /responsibilit|responsabilidad|obowi[ąa]zk|aufgaben|missions/i,
  /requirement|requisito|wymagan|anforderungen/i,
  /qualificat|cualificac|perfil buscado|kwalifikacj/i,
  /\byears? of experience\b|años de experiencia|lat[a]? doświadczenia|jahre erfahrung/i,
  /\bskills?\b|habilidades|conocimientos|umiej[ęe]tno[śs]|kenntnisse|compétences/i,
  /you(?:'| wi)ll\b|what you.{0,5}ll do|lo que har|twoim zadaniem/i,
  /we(?:'| a)re looking|buscamos|estamos buscando|poszukujemy|szukamy|wir suchen/i,
  /about (?:the|this) role|sobre el puesto|the role\b|o stanowisku|über die stelle/i,
  /benefits|beneficios|compensation|oferujemy|wynagrodzenie|wir bieten/i,
  /apply|postul|aplikuj|bewerb/i,
];

/**
 * Boards answer an expired link with an apology wrapped in the same chrome as a
 * real posting, which clears both the length and the signal bar. Only checked on
 * short pages, since a live posting can mention that some other role is closed.
 */
const DEAD_POSTING = [
  /can(?:no|')t find the job/i,
  /job (?:you(?:'re| are) looking for )?(?:is |has )?(?:no longer|been removed|expired)/i,
  /no longer (?:available|accepting|being accepted|posted)/i,
  /position (?:has been|is) (?:filled|closed)/i,
  /page not found|404 (?:error|not found)/i,
  /you need to enable javascript/i,
  /ya no (?:est[áa] disponible|se encuentra disponible)/i,
];

const MIN_UNTRUSTED_LENGTH = 700;
const MAX_DEAD_POSTING_LENGTH = 2_000;
const MIN_SIGNALS = 2;

/** Only applied to the guessy rungs; an ATS API or JSON-LD needs no vetting. */
export function looksLikeJobDescription(text: string): boolean {
  if (text.length < MIN_UNTRUSTED_LENGTH) return false;
  if (text.length < MAX_DEAD_POSTING_LENGTH && DEAD_POSTING.some((signal) => signal.test(text))) {
    return false;
  }
  return JD_SIGNALS.filter((signal) => signal.test(text)).length >= MIN_SIGNALS;
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function looksEscaped(html: string): boolean {
  return !html.includes("<") && (html.includes("&lt;") || html.includes("&#60;"));
}

export function decodeEntities(input: string): string {
  return cheerio.load(`<div>${input}</div>`)("div").text();
}

const JS_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};

/**
 * Turns the body of a JavaScript string literal back into the text it stands
 * for. Needed because some servers ship JSON as `JSON.parse('...')` with every
 * quote written `\x22`, which no JSON parser will touch.
 */
export function decodeJsStringLiteral(raw: string): string {
  return raw.replace(
    /\\(u\{[0-9a-fA-F]{1,6}\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (_match, sequence: string) => {
      if (sequence[0] === "x") return String.fromCharCode(parseInt(sequence.slice(1), 16));
      if (sequence[0] === "u") {
        const hex = sequence[1] === "{" ? sequence.slice(2, -1) : sequence.slice(1);
        return String.fromCodePoint(parseInt(hex, 16));
      }
      return JS_ESCAPES[sequence] ?? sequence;
    },
  );
}

/** Every `JSON.parse('...')` payload in a script, decoded but not yet parsed. */
export function collectJsonParseLiterals(script: string): string[] {
  const literals: string[] = [];
  const opener = /JSON\.parse\(\s*'/g;

  let match: RegExpExecArray | null;
  while ((match = opener.exec(script))) {
    const start = match.index + match[0].length;
    let index = start;
    while (index < script.length && script[index] !== "'") {
      index += script[index] === "\\" ? 2 : 1;
    }
    if (index >= script.length) break;

    literals.push(decodeJsStringLiteral(script.slice(start, index)));
    opener.lastIndex = index + 1;
  }
  return literals;
}

interface JsonLdJob {
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?: unknown;
  employmentType?: string | string[];
  validThrough?: string;
}

/** schema.org JobPosting, embedded by a surprising share of career pages. */
export function extractJsonLdJob(html: string): JdSource | null {
  const $ = cheerio.load(html);
  const blocks = $('script[type="application/ld+json"]')
    .toArray()
    .map((element) => $(element).text());

  for (const block of blocks) {
    for (const candidate of collectJsonObjects(block)) {
      const job = findJobPosting(candidate);
      if (!job?.description) continue;

      const text = htmlToText(job.description);
      if (!text) continue;

      return {
        text,
        title: typeof job.title === "string" ? decodeEntities(job.title) : undefined,
        company: readOrgName(job.hiringOrganization),
        location: readLocation(job.jobLocation),
        employmentType: Array.isArray(job.employmentType) ? job.employmentType[0] : job.employmentType,
        method: "jsonld",
      };
    }
  }
  return null;
}

function collectJsonObjects(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    return [JSON.parse(trimmed)];
  } catch {
    // Some pages concatenate several JSON documents into one script tag.
    const matches = trimmed.match(/\{[\s\S]*\}/);
    if (!matches) return [];
    try {
      return [JSON.parse(matches[0])];
    } catch {
      return [];
    }
  }
}

function findJobPosting(value: unknown, depth = 0): JsonLdJob | null {
  if (depth > 6 || !value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const isJob = Array.isArray(type)
    ? type.some((entry) => String(entry).toLowerCase() === "jobposting")
    : String(type ?? "").toLowerCase() === "jobposting";
  if (isJob) return record as JsonLdJob;

  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    const found = findJobPosting(record[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function readOrgName(org: unknown): string | undefined {
  if (typeof org === "string") return org;
  if (org && typeof org === "object") {
    const name = (org as Record<string, unknown>).name;
    if (typeof name === "string") return name;
  }
  return undefined;
}

function readLocation(location: unknown): string | undefined {
  const first = Array.isArray(location) ? location[0] : location;
  if (typeof first === "string") return first;
  if (!first || typeof first !== "object") return undefined;

  const address = (first as Record<string, unknown>).address;
  if (typeof address === "string") return address;
  if (address && typeof address === "object") {
    const record = address as Record<string, unknown>;
    return [record.addressLocality, record.addressRegion, record.addressCountry]
      .map((part) => (typeof part === "string" ? part : (part as { name?: string })?.name))
      .filter(Boolean)
      .join(", ") || undefined;
  }
  return undefined;
}

const DESCRIPTION_KEYS =
  /^(job)?description(html|plain|text)?$|^content$|^body$|^jobdescription$|^content_html$|^content_text$/i;

/** Session/PII blobs that can sit next to a real posting in an Inertia payload. */
const SKIP_JSON_KEYS = /^(auth|errors|csrf_token|existingCandidate|candidateToken|shortlist_summary)$/i;

interface JsonJobCandidate {
  text: string;
  title?: string;
  company?: string;
  location?: string;
  employmentType?: string;
}

/**
 * Walk arbitrary JSON (script tags, XHR payloads, __NEXT_DATA__, Inertia) and
 * keep the longest description-shaped string. Shared by the HTML and Chromium rungs.
 */
export function extractJobFromUnknownJson(value: unknown, method = "embedded-json"): JdSource | null {
  const best: { current: JsonJobCandidate | null } = { current: null };

  const consider = (candidate: JsonJobCandidate | null) => {
    if (!candidate || candidate.text.length <= (best.current?.text.length ?? 0)) return;
    best.current = candidate;
  };

  const visit = (node: unknown, depth: number, title?: string) => {
    if (depth > 10 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1, title);
      return;
    }

    const record = node as Record<string, unknown>;
    const localTitle =
      typeof record.title === "string"
        ? record.title
        : typeof record.name === "string"
          ? record.name
          : title;

    consider(composeSectionedJob(record, localTitle));

    // Rippling and a few others nest role/company HTML under description.
    if (record.description && typeof record.description === "object" && !Array.isArray(record.description)) {
      const nested = record.description as Record<string, unknown>;
      const parts = [nested.role, nested.company, nested.html, nested.text]
        .filter((part): part is string => typeof part === "string" && part.length > 40)
        .map((part) => htmlToText(part));
      const text = normalizeWhitespace(parts.join("\n\n"));
      if (text.length > 600) {
        consider({
          text,
          title: localTitle,
          company: typeof record.companyName === "string" ? record.companyName : undefined,
        });
      }
    }

    for (const [key, entry] of Object.entries(record)) {
      if (SKIP_JSON_KEYS.test(key)) continue;
      if (typeof entry === "string" && DESCRIPTION_KEYS.test(key) && entry.length > 600) {
        const text = htmlToText(entry);
        consider({
          text,
          title: localTitle,
          company:
            typeof record.companyName === "string"
              ? record.companyName
              : typeof record.company === "string"
                ? record.company
                : undefined,
          location: readJsonLocation(record),
          employmentType: readJsonEmploymentType(record),
        });
      } else if (entry && typeof entry === "object") {
        visit(entry, depth + 1, localTitle);
      }
    }
  };

  visit(value, 0);
  if (!best.current) return null;
  return { ...best.current, method };
}

/**
 * Laravel Inertia career pages (Invisible Geeks Recruiting and similar) put the
 * posting on `data-page`, not in a script tag the other extractors look at.
 */
export function extractInertiaJob(html: string): JdSource | null {
  const $ = cheerio.load(html);
  let best: JdSource | null = null;

  for (const element of $("[data-page]").toArray()) {
    const raw = $(element).attr("data-page");
    if (!raw || !raw.includes("{")) continue;
    try {
      const candidate = extractJobFromUnknownJson(JSON.parse(raw), "inertia");
      if (candidate && candidate.text.length > (best?.text.length ?? 0)) best = candidate;
    } catch {
      // Malformed bootstrap; the other rungs still run.
    }
  }

  return best;
}

/**
 * CMS-style postings: `{ title, sections: [{ title, content, items }] }`.
 * Invisible Geeks stores the whole JD this way; a single `content` field would
 * only capture one heading.
 */
function composeSectionedJob(record: Record<string, unknown>, fallbackTitle?: string): JsonJobCandidate | null {
  const sections = record.sections;
  if (!Array.isArray(sections) || sections.length < 2) return null;

  const heading =
    typeof record.title === "string"
      ? record.title
      : typeof record.documentTitle === "string"
        ? record.documentTitle
        : fallbackTitle;

  const parts: string[] = [];
  if (heading) parts.push(heading);

  let used = 0;
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const entry = section as Record<string, unknown>;
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    const content = typeof entry.content === "string" ? htmlToText(entry.content).trim() : "";
    const items = Array.isArray(entry.items)
      ? entry.items.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const body = content || (items.length ? items.map((item) => `- ${item.trim()}`).join("\n") : "");
    if (!body) continue;
    used += 1;
    parts.push(title ? `${title}\n${body}` : body);
  }

  if (used < 2) return null;
  const text = normalizeWhitespace(parts.join("\n\n"));
  if (text.length < 600) return null;

  return {
    text,
    title: heading,
    location: readJsonLocation(record),
    employmentType: readJsonEmploymentType(record),
  };
}

function readJsonLocation(record: Record<string, unknown>): string | undefined {
  if (typeof record.location === "string" && record.location.trim()) return record.location;
  const position = record.position;
  if (position && typeof position === "object") {
    const location = (position as Record<string, unknown>).location;
    if (typeof location === "string" && location.trim()) return location;
  }
  return undefined;
}

function readJsonEmploymentType(record: Record<string, unknown>): string | undefined {
  if (typeof record.employmentType === "string") return record.employmentType;
  const position = record.position;
  if (position && typeof position === "object") {
    const contract = (position as Record<string, unknown>).contractType;
    if (typeof contract === "string") return contract;
  }
  return undefined;
}

/**
 * SPA pages ship their data as JSON in the HTML even when the visible body is
 * empty. Hunt for the longest description-shaped string in any embedded blob.
 */
export function extractEmbeddedJsonJob(html: string): JdSource | null {
  const $ = cheerio.load(html);
  const scripts = $("script")
    .toArray()
    .map((element) => $(element).text())
    .filter((text) => text.length > 200 && text.includes("{"));

  let best: JdSource | null = null;

  const consider = (payload: string) => {
    try {
      const candidate = extractJobFromUnknownJson(JSON.parse(payload), "embedded-json");
      if (candidate && candidate.text.length > (best?.text.length ?? 0)) best = candidate;
    } catch {
      // Not a clean JSON payload; the readability pass will handle this page.
    }
  };

  for (const script of scripts) {
    const start = script.indexOf("{");
    const end = script.lastIndexOf("}");
    if (start >= 0 && end > start) consider(script.slice(start, end + 1));
    for (const literal of collectJsonParseLiterals(script)) consider(literal);
  }

  return best;
}

/** Next.js career sites often SSR the posting into `__NEXT_DATA__`. */
export function extractNextDataJob(html: string): JdSource | null {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return null;
  try {
    return extractJobFromUnknownJson(JSON.parse(match[1]), "next-data");
  } catch {
    return null;
  }
}

/**
 * Last resort before the browser: pick the densest text container on the page.
 * Scores by text length so a real JD beats the nav and cookie banner.
 */
export function extractReadableText(html: string): JdSource | null {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,iframe,nav,header,footer,form").remove();

  const title = $("h1").first().text().trim() || $("title").first().text().trim() || undefined;

  const candidates = $(
    "main, article, [class*='job-description'], [class*='jobDescription'], [id*='job-description'], [class*='description'], [class*='content'], [role='main'], body",
  ).toArray();

  let best = "";
  for (const element of candidates) {
    const text = htmlToText($.html(element));
    if (text.length > best.length && text.length < 60_000) best = text;
  }

  if (!best) return null;
  return { text: best, title, method: "readability" };
}
