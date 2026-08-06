import { htmlToText } from "../html";
import { fetchJson, politeFetch, type HttpResponse } from "../http";
import type { Adapter, JdSource, ScrapeContext } from "../types";

interface AdpRequisition {
  itemID?: string;
  clientRequisitionID?: string;
  requisitionTitle?: string;
  requisitionDescription?: string;
  postDate?: string;
  workLevelCode?: { shortName?: string };
  requisitionLocations?: {
    nameCode?: { shortName?: string };
    address?: {
      cityName?: string;
      countrySubdivisionLevel1?: { codeValue?: string };
      countryCode?: string;
    };
  }[];
  customFieldGroup?: {
    stringFields?: { stringValue?: string; nameCode?: { codeValue?: string } }[];
  };
}

interface AdpListing {
  jobRequisitions?: AdpRequisition[];
  meta?: { totalNumber?: number };
}

/** The career center only serves 20 requisitions per page. */
const PAGE_SIZE = 20;
/** Enough to cover a mid-size board without turning one URL into 50 requests. */
const MAX_LISTING_PAGES = 5;

/**
 * ADP Workforce Now career centers render every posting client side into the
 * same `recruitment.html` URL, so there is no HTML to scrape and no JSON-LD.
 * The public career center API behind that page needs no auth and returns the
 * description as HTML.
 *
 * Legacy `/jobs/apply/posting.html?client=<slug>` links are a second problem:
 * they carry a client slug rather than the `cid` the API wants, and they 302 to
 * themselves once to plant a cookie before revealing the real target. Replaying
 * that redirect by hand is what recovers the `cid`.
 */
export const adpAdapter: Adapter = {
  id: "adp-workforcenow",

  match(url) {
    if (!/^(?:workforcenow|wfn[\w-]*)\.adp\.com$/i.test(url.host)) return false;
    return (
      /\/(?:recruitment|intermediateRedirect|posting)\.html$/i.test(url.pathname) ||
      url.searchParams.has("cid")
    );
  },

  async fetch(url, ctx) {
    const params = allParams(url);
    let cid = params.get("cid");
    const jobId = params.get("jobId");

    if (!cid) {
      ctx.onProgress?.("Resolving legacy ADP career center link");
      cid = await resolveCid(url, ctx);
    }
    if (!cid) return null;
    if (!jobId) {
      throw new Error("link points at the career center search page, not a single posting");
    }

    ctx.onProgress?.("Fetching ADP career center requisition");
    const requisition =
      (await getRequisition(url.origin, cid, jobId, ctx)) ??
      (await findByListing(url.origin, cid, jobId, ctx));

    return requisition ? toSource(requisition, url) : null;
  },
};

/**
 * ADP links put their query string after the hash as often as before it, and a
 * hash is never sent to the server, so both halves have to be searched.
 */
function allParams(url: URL): URLSearchParams {
  const merged = new URLSearchParams(url.search);
  const hash = url.hash.slice(1);
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash;
  for (const [key, value] of new URLSearchParams(query)) {
    if (!merged.has(key)) merged.set(key, value);
  }
  return merged;
}

/**
 * The first GET answers 302 to the same URL with a Set-Cookie; only a request
 * carrying that cookie is redirected on to the modern career center, whose URL
 * contains the `cid`.
 */
async function resolveCid(url: URL, ctx: ScrapeContext): Promise<string | null> {
  let target = url.toString();
  let cookie: string | null = null;

  for (let hop = 0; hop < 4; hop += 1) {
    const response: HttpResponse | null = await politeFetch(target, {
      signal: ctx.signal,
      retries: 1,
      redirect: "manual",
      headers: cookie ? { Cookie: cookie } : undefined,
    }).catch(() => null);
    if (!response) return null;

    if (response.cookie) cookie = cookie ? `${cookie}; ${response.cookie}` : response.cookie;
    if (!response.location) return null;

    const next = new URL(response.location, target);
    const cid = next.searchParams.get("cid");
    if (cid) return cid;
    if (next.toString() === target && !response.cookie) return null;
    target = next.toString();
  }
  return null;
}

async function getRequisition(
  origin: string,
  cid: string,
  jobId: string,
  ctx: ScrapeContext,
): Promise<AdpRequisition | null> {
  const requisition = await fetchJson<AdpRequisition>(
    `${apiBase(origin)}/${encodeURIComponent(jobId)}?${new URLSearchParams({
      cid,
      lang: "en_US",
      locale: "en_US",
    })}`,
    { signal: ctx.signal, retries: 1 },
  );

  // A closed posting still answers 200, just with the description stripped out.
  return requisition?.requisitionDescription ? requisition : null;
}

/**
 * Career centers link jobs by `itemID`, by the client's own requisition number
 * or by an `ExternalJobID` custom field depending on their age. Only the first
 * two are accepted as a path parameter, so an unrecognised id has to be looked
 * up in the listing before the description can be fetched.
 */
async function findByListing(
  origin: string,
  cid: string,
  jobId: string,
  ctx: ScrapeContext,
): Promise<AdpRequisition | null> {
  ctx.onProgress?.("Searching ADP career center listing");

  for (let page = 0; page < MAX_LISTING_PAGES; page += 1) {
    const listing = await fetchJson<AdpListing>(
      `${apiBase(origin)}?${new URLSearchParams({
        cid,
        lang: "en_US",
        locale: "en_US",
        $top: String(PAGE_SIZE),
        // $skip is 1-based on this endpoint.
        $skip: String(page * PAGE_SIZE + 1),
      })}`,
      { signal: ctx.signal, retries: 1 },
    );

    const requisitions = listing?.jobRequisitions ?? [];
    if (requisitions.length === 0) return null;

    const hit = requisitions.find((requisition) => idsOf(requisition).includes(jobId));
    if (hit?.itemID) return getRequisition(origin, cid, hit.itemID, ctx);

    const total = listing?.meta?.totalNumber;
    if (total !== undefined && (page + 1) * PAGE_SIZE >= total) return null;
  }
  return null;
}

function apiBase(origin: string): string {
  return `${origin}/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions`;
}

function idsOf(requisition: AdpRequisition): string[] {
  const external = requisition.customFieldGroup?.stringFields?.find(
    (field) => field.nameCode?.codeValue?.toLowerCase() === "externaljobid",
  );
  return [requisition.itemID, requisition.clientRequisitionID, external?.stringValue].filter(
    (value): value is string => !!value,
  );
}

function toSource(requisition: AdpRequisition, url: URL): JdSource | null {
  const text = htmlToText(requisition.requisitionDescription ?? "");
  if (!text) return null;

  return {
    text,
    title: requisition.requisitionTitle?.trim() || undefined,
    location: locationOf(requisition),
    employmentType: requisition.workLevelCode?.shortName?.trim() || undefined,
    applyUrl: url.toString(),
    method: "adp-careercenter-api",
  };
}

function locationOf(requisition: AdpRequisition): string | undefined {
  const labels = (requisition.requisitionLocations ?? [])
    .map((location) => {
      const address = location.address ?? {};
      const specific = [
        address.cityName,
        address.countrySubdivisionLevel1?.codeValue,
        address.countryCode,
      ]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(", ");
      return specific || location.nameCode?.shortName?.trim() || "";
    })
    .filter(Boolean);

  return [...new Set(labels)].join(" | ") || undefined;
}
