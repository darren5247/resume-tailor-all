import type { HiringChannel } from "./schemas";

/**
 * High-confidence hiring-channel and startup labels.
 *
 * Badges should only fire when a posting (or URL / known firm name) makes the
 * call unmistakable. Weak language ("we are hiring", "about us", "join our team")
 * is ignored — agencies use those phrases too.
 */
export interface CompanySignals {
  hiringChannel: HiringChannel;
  clientCompany: string;
  isStartup: boolean;
}

const ATS_OR_BOARD_HOST =
  /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|successfactors\.com|icims\.com|jobvite\.com|smartrecruiters\.com|bamboohr\.com|workable\.com|recruitee\.com|teamtailor\.com|pinpoint\.app|gem\.com|dover\.io|join\.com|rippling\.com|ultipro\.com|oraclecloud\.com|paycomonline\.net|zoho(recruit)?\.com|hireology\.com|jazzhr\.com|breezy\.hr|personio\.(com|de)|adp\.com|comeet\.co|jobdiva\.com|linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|monster\.com|wellfound\.com|angel\.co|angellist\.com)$/i;

/** Staffing ATS — the board itself is used by agencies, not product companies. */
const AGENCY_ATS_HOST = /jobdiva\.com$/i;

const AGENCY_HOST =
  /(roberthalf|teksystems|randstad|adecco|manpowergroup|insightglobal|kforce|aerotek|apexsystems|hays\.com|cybercoders|motionrecruitment|kellyservices|addisongroup|beaconhillstaffing|collabera|actalent)/i;

/**
 * Well-known staffing / recruiting / search firms. Matched against the poster
 * company name after punctuation and Inc/LLC suffixes are stripped.
 */
const KNOWN_AGENCIES = [
  "robert half",
  "robert half technology",
  "teksystems",
  "tek systems",
  "randstad",
  "randstad sourceright",
  "adecco",
  "manpower",
  "manpowergroup",
  "experis",
  "kelly services",
  "insight global",
  "kforce",
  "aerotek",
  "allegis",
  "allegis group",
  "apex systems",
  "akkodis",
  "modis",
  "hays",
  "michael page",
  "pagegroup",
  "page personnel",
  "robert walters",
  "korn ferry",
  "heidrick struggles",
  "spencer stuart",
  "russell reynolds",
  "egon zehnder",
  "harvey nash",
  "actalent",
  "collabera",
  "cybercoders",
  "motion recruitment",
  "mondo",
  "aquent",
  "creative circle",
  "the creative group",
  "beacon hill",
  "addison group",
  "nigel frank",
  "harnham",
  "selby jennings",
  "jefferson frank",
  "genesis10",
  "revature",
  "disys",
  "prounlimited",
  "toptal",
  "andela",
] as const;

const AGENCY_NAME_PATTERN =
  /\b(staffing|recruiting|recruitment)\b|\b(search\s+(firm|group|partners?)|talent\s+(partners?|agency|firm))\b/i;

/** Phrases that almost only appear when a recruiter is posting for a client. */
const AGENCY_BODY = [
  /\bour\s+client's\b/i,
  /\bour\s+client(?:\s+is\b|,|:)/i,
  /\bour\s+end[\s-]client\b/i,
  /\bon\s+behalf\s+of\s+(?:our\s+)?clients?\b/i,
  /\b(?:one\s+of\s+)?our\s+clients?\s+is\b/i,
  /\bthis\s+(?:role|position|opportunity)\s+is\s+(?:with|for)\s+(?:our\s+)?client\b/i,
  /\b(?:staffing|recruit(?:ing|ment))\s+(?:agency|firm)s?\b/i,
  /\bwe\s+are\s+(?:a|an)\s+(?:leading\s+)?(?:national\s+|global\s+)?(?:staffing|recruit(?:ing|ment)|search)\s+(?:agency|firm|company|partner)/i,
  /\bthe\s+client\s+is\s+(?:looking|seeking|hiring|searching)\b/i,
  /\bclient\s+is\s+(?:looking|seeking|hiring)\s+for\b/i,
  /\bplaced\s+with\s+(?:our\s+)?client\b/i,
  /\bcontingent\s+search\b/i,
  /\bexecutive\s+search\s+firm\b/i,
  /\brecruitment\s+process\s+outsourcing\b/i,
];

/** Unmistakable direct-hire language. */
const DIRECT_BODY = [
  /\bdirect[\s-]hire\b/i,
  /\bno\s+(?:third[\s-]party\s+)?agenc(?:y|ies)\b/i,
  /\bplease\s+no\s+agenc(?:y|ies)\b/i,
  /\bprincipals?\s+only\b/i,
  /\bwe\s+are\s+not\s+(?:working|partnering)\s+with\s+agenc(?:y|ies)\b/i,
];

export function classifyCompanySignals(input: {
  text: string;
  company: string;
  url: string;
  llmClientCompany?: string;
}): CompanySignals {
  const body = input.text.slice(0, 12_000);
  const company = input.company.trim();
  const agency = isAgency(body, company, input.url);
  const isStartup = detectStartup(body, input.url);

  if (agency) {
    return {
      hiringChannel: "agency",
      clientCompany: pickClientCompany(body, input.llmClientCompany),
      isStartup,
    };
  }

  if (isDirect(body, company, input.url)) {
    return { hiringChannel: "direct", clientCompany: "", isStartup };
  }

  return { hiringChannel: "unknown", clientCompany: "", isStartup };
}

function isAgency(body: string, company: string, url: string): boolean {
  if (company && (isKnownAgencyName(company) || AGENCY_NAME_PATTERN.test(company))) {
    return true;
  }
  if (hostOf(url) && (AGENCY_HOST.test(hostOf(url)) || AGENCY_ATS_HOST.test(hostOf(url)))) {
    return true;
  }
  return AGENCY_BODY.some((pattern) => pattern.test(body));
}

function isDirect(body: string, company: string, url: string): boolean {
  if (DIRECT_BODY.some((pattern) => pattern.test(body))) return true;
  if (company && joinTeamAtCompany(body, company)) return true;
  if (company && isOwnCareersDomain(url, company)) return true;
  if (company && atsBoardMatchesCompany(url, company)) return true;
  return false;
}

function detectStartup(body: string, url: string): boolean {
  if (/(wellfound\.com|angel\.co|angellist\.com)/i.test(url)) return true;

  return (
    /\bwe(?:['’]re|\s+are)\s+(?:an?\s+)?(?:(?:early|seed|pre[-\s]seed)[-\s]stage\s+)?startup\b/i.test(body) ||
    /\bas\s+an?\s+(?:(?:early|seed)[-\s]stage\s+)?startup\b/i.test(body) ||
    /\bour\s+(?:(?:early|seed)[-\s]stage\s+)?startup\b/i.test(body) ||
    /\bthis\s+(?:(?:early|seed)[-\s]stage\s+)?startup\b/i.test(body) ||
    /\bwe(?:['’]re|\s+are)\s+(?:an?\s+)?(?:early[-\s]stage|seed[-\s]stage|pre[-\s]seed)\s+company\b/i.test(body) ||
    /\b(?:yc|y\s*combinator)[-\s]backed\b/i.test(body) ||
    /\bbacked\s+by\s+y\s*combinator\b/i.test(body) ||
    /\bwe\s+(?:just\s+|recently\s+)?raised\s+(?:our\s+|a\s+)?(?:pre[-\s]seed|seed|series\s+[abc])\b/i.test(body) ||
    /\bour\s+client\s+is\s+(?:an?\s+)?(?:(?:early|seed)[-\s]stage\s+)?startup\b/i.test(body)
  );
}

function isKnownAgencyName(company: string): boolean {
  const normalized = normalizeFirmName(company);
  if (!normalized) return false;
  return KNOWN_AGENCIES.some((agency) => {
    if (normalized === agency) return true;
    if (normalized.startsWith(`${agency} `)) return true;
    // Whole-token contains, so "TEKsystems Inc" matches and "Hayes" does not match "hays".
    return new RegExp(`(?:^|\\s)${escapeRegex(agency)}(?:\\s|$)`).test(normalized);
  });
}

function joinTeamAtCompany(body: string, company: string): boolean {
  const cleaned = company
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const variants = [cleaned];
  const first = cleaned.split(/\s+/)[0] ?? "";
  if (first.length >= 5) variants.push(first);

  return variants.some((name) => {
    if (name.length < 3) return false;
    const escaped = escapeRegex(name);
    return new RegExp(
      `\\b(?:join(?:\\s+us)?\\s+(?:at|the)\\s+${escaped}|join\\s+(?:the\\s+)?${escaped}\\s+team|careers?\\s+at\\s+${escaped}|work\\s+at\\s+${escaped})\\b`,
      "i",
    ).test(body);
  });
}

function isOwnCareersDomain(url: string, company: string): boolean {
  const host = hostOf(url);
  if (!host || ATS_OR_BOARD_HOST.test(host)) return false;
  const slug = slugify(company);
  const hostCore = host.replace(/^(careers|jobs|job|go|boards|apply)\./, "").split(".")[0] ?? "";
  if (slug.length < 3 || hostCore.length < 3) return false;
  return slugsMatch(slug, hostCore);
}

function atsBoardMatchesCompany(url: string, company: string): boolean {
  const host = hostOf(url);
  if (!host || !ATS_OR_BOARD_HOST.test(host)) return false;
  if (AGENCY_ATS_HOST.test(host) || AGENCY_HOST.test(host)) return false;
  if (/(linkedin|indeed|glassdoor|ziprecruiter|monster|wellfound|angel)/i.test(host)) {
    return false;
  }

  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  const board = path.split("/").filter(Boolean)[0] ?? "";
  const slug = slugify(company);
  if (board.length < 3 || slug.length < 3) return false;
  return slugsMatch(board, slug);
}

function pickClientCompany(body: string, llmClient?: string): string {
  const fromLlm = llmClient?.trim() ?? "";
  if (fromLlm && !/^(client|our client|undisclosed|confidential)$/i.test(fromLlm)) {
    return fromLlm;
  }

  const match =
    body.match(
      /\b[Oo]ur\s+client,\s+([A-Z][A-Za-z0-9&.\-']+(?:\s+[A-Z][A-Za-z0-9&.\-']+){0,4})/,
    ) ??
    body.match(
      /\b[Oo]n\s+behalf\s+of\s+(?:(?:[Oo]ur\s+)?client,?\s+)?([A-Z][A-Za-z0-9&.\-']+(?:\s+[A-Z][A-Za-z0-9&.\-']+){0,3})/,
    );
  const name = match?.[1]?.trim() ?? "";
  if (!name || /^(is|a|an|the|looking|seeking|hiring|based)$/i.test(name)) return "";
  return name.replace(/[.,;:]+$/, "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeFirmName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(the|inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|plc|lp|llp)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(name: string): string {
  return normalizeFirmName(name).replace(/\s+/g, "");
}

function slugsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
