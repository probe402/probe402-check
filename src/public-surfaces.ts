/**
 * THE PUBLIC SURFACES THIS TOOL READS, AND THE ONE DOOR EVERY REQUEST GOES THROUGH.
 *
 * probe402-check reads four addresses and nothing else:
 *   - a route's free grade, by endpoint id:      https://probe402.com/grade/<ep_id>
 *   - a route's or a host's free grade, by URL:   https://probe402.com/grade?url=<encoded>
 *   - one sealed day's manifest:                  https://probe402.com/chain/<YYYY-MM-DD>
 *   - the public copy of the archive head table:  https://raw.githubusercontent.com/probe402/probe402-chain-heads/main/ARCHIVE-CHAIN.md
 *
 * Every URL the code can form is built here, every request is made by `fetchPublic`, and
 * `fetchPublic` refuses a URL that is not on the list above. `test/public-surfaces.test.ts` drives
 * that refusal with an extra path and scans the sources for any address formed elsewhere.
 *
 * Redirects are refused (`redirect: "error"`): a redirect is a second address, and the list is
 * about where bytes come from.
 */
import { VERSION } from "./version.ts";

export const PROBE402_ORIGIN = "https://probe402.com";
export const HEADS_MIRROR_REPOSITORY = "https://github.com/probe402/probe402-chain-heads";
export const HEADS_MIRROR_TABLE_URL = "https://raw.githubusercontent.com/probe402/probe402-chain-heads/main/ARCHIVE-CHAIN.md";
export const THIS_REPOSITORY = "https://github.com/probe402/probe402-check";

/** The user-agent every request carries, so the record's own demand series can tell this tool apart. */
export const USER_AGENT = `probe402-check/${VERSION} (+${THIS_REPOSITORY})`;

/** A probe402 endpoint id: `ep_` and sixteen hex characters. */
export const ENDPOINT_ID = /^ep_[0-9a-f]{16}$/;
/** A calendar day, `YYYY-MM-DD`. */
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type PublicSurface = "grade-by-id" | "grade-by-url" | "chain-day" | "heads-mirror-table";

/** The allowlist. A URL is fetched when it matches exactly one of these, and refused otherwise. */
export const PUBLIC_SURFACES: ReadonlyArray<{ readonly name: PublicSurface; readonly pattern: RegExp }> = [
  { name: "grade-by-id", pattern: /^https:\/\/probe402\.com\/grade\/ep_[0-9a-f]{16}$/ },
  { name: "grade-by-url", pattern: /^https:\/\/probe402\.com\/grade\?url=[A-Za-z0-9%._~-]+$/ },
  { name: "chain-day", pattern: /^https:\/\/probe402\.com\/chain\/\d{4}-\d{2}-\d{2}$/ },
  {
    name: "heads-mirror-table",
    pattern: /^https:\/\/raw\.githubusercontent\.com\/probe402\/probe402-chain-heads\/main\/ARCHIVE-CHAIN\.md$/,
  },
];

/** Which public surface a URL is, or `null` when it is none of them. */
export function surfaceOf(url: string): PublicSurface | null {
  const matches = PUBLIC_SURFACES.filter((surface) => surface.pattern.test(url));
  return matches.length === 1 ? matches[0]!.name : null;
}

/**
 * The query value for `/grade?url=`: `encodeURIComponent`, with the five characters it leaves
 * alone (`!'()*`) encoded as well, so the formed URL is made of the characters the allowlist names.
 */
export function encodeResource(resource: string): string {
  return encodeURIComponent(resource).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function gradeByIdUrl(endpointId: string): string {
  if (!ENDPOINT_ID.test(endpointId)) throw new Error(`not a probe402 endpoint id: ${endpointId}`);
  return `${PROBE402_ORIGIN}/grade/${endpointId}`;
}

export function gradeByUrlUrl(resource: string): string {
  if (resource.trim() === "") throw new Error("an empty URL cannot be looked up");
  return `${PROBE402_ORIGIN}/grade?url=${encodeResource(resource)}`;
}

export function chainDayUrl(date: string): string {
  if (!DAY.test(date)) throw new Error(`not a calendar day (YYYY-MM-DD): ${date}`);
  return `${PROBE402_ORIGIN}/chain/${date}`;
}

export function headsMirrorTableUrl(): string {
  return HEADS_MIRROR_TABLE_URL;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The one place a request is made. Refuses any URL that is not a public surface on the list. */
export async function fetchPublic(url: string, fetchImpl?: Fetch): Promise<Response> {
  if (surfaceOf(url) === null) {
    throw new Error(`probe402-check refuses to fetch ${url}: it is not one of the public probe402 surfaces this tool reads`);
  }
  const impl: Fetch = fetchImpl ?? ((u, init) => globalThis.fetch(u, init));
  return impl(url, {
    method: "GET",
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    redirect: "error",
  });
}
