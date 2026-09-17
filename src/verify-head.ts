/**
 * THE HEAD VERIFIER.
 *
 * probe402 seals each closed day of its archive into a manifest: the list of every object written
 * that day and every distinct response body, by hash and byte length. The SHA-256 of a manifest is
 * that day's head; the next day's manifest carries it, so the days form a chain. The heads are
 * published on probe402.com/chain and pushed, one row per sealed day, to a public git repository
 * outside the vendor that holds the archive.
 *
 * This file runs the check the mirror's README describes: fetch a day's row from the public copy,
 * fetch that day's manifest, drop the single trailing newline byte, take the SHA-256, compare.
 * With `next: true` it also fetches the next day's manifest and checks that it names the same
 * digest as the head it links back to.
 *
 * No packages; `node:crypto` and the four public surfaces in `public-surfaces.ts`.
 */
import { createHash } from "node:crypto";

import { DAY, chainDayUrl, fetchPublic, headsMirrorTableUrl, type Fetch } from "./public-surfaces.ts";

export type MirrorRow = { date: string; chain_index: number; manifest_sha256: string };

export type HeadVerification = {
  date: string;
  mirror: { url: string; rows: number; through: string | null; row: MirrorRow | null };
  manifest:
    | { url: string; status: number; bytes: number; trailing_newline: boolean; sha256: string }
    | { url: string; status: number; problem: string };
  links: boolean | null;
  next: null | {
    date: string;
    url: string;
    status: number;
    prev_date: string | null;
    prev_manifest_sha256: string | null;
    names_it: boolean | null;
    problem: string | null;
  };
  verdict: "LINKS" | "DOES NOT LINK" | "NO ROW ON THE MIRROR" | "NO MANIFEST SERVED";
};

/** The rows of the mirror's table, in the order they appear. Lines that are not rows are skipped. */
export function parseMirrorTable(text: string): MirrorRow[] {
  const rows: MirrorRow[] = [];
  const row = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d+)\s*\|\s*`([0-9a-f]{64})`\s*\|/;
  for (const line of text.split(/\r?\n/)) {
    const m = row.exec(line);
    if (m === null) continue;
    rows.push({ date: m[1]!, chain_index: Number(m[2]), manifest_sha256: m[3]! });
  }
  return rows;
}

/** The chain head of served manifest bytes: SHA-256 with exactly one trailing 0x0A removed, when present. */
export function chainHeadOf(bytes: Uint8Array): { sha256: string; trailing_newline: boolean } {
  const trailing = bytes.length > 0 && bytes[bytes.length - 1] === 0x0a;
  const body = trailing ? bytes.subarray(0, bytes.length - 1) : bytes;
  return { sha256: createHash("sha256").update(body).digest("hex"), trailing_newline: trailing };
}

export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function verifyHead(date: string, options: { fetch?: Fetch; next?: boolean } = {}): Promise<HeadVerification> {
  if (!DAY.test(date)) throw new Error(`not a calendar day (YYYY-MM-DD): ${date}`);
  const mirrorUrl = headsMirrorTableUrl();
  const mirrorResponse = await fetchPublic(mirrorUrl, options.fetch);
  if (!mirrorResponse.ok) throw new Error(`the public head table answered HTTP ${mirrorResponse.status}`);
  const rows = parseMirrorTable(await mirrorResponse.text());
  const row = rows.find((r) => r.date === date) ?? null;
  const through = rows.length === 0 ? null : rows[rows.length - 1]!.date;
  const mirror = { url: mirrorUrl, rows: rows.length, through, row };

  const manifestUrl = chainDayUrl(date);
  const manifestResponse = await fetchPublic(manifestUrl, options.fetch);
  if (!manifestResponse.ok) {
    return {
      date,
      mirror,
      manifest: { url: manifestUrl, status: manifestResponse.status, problem: `HTTP ${manifestResponse.status}` },
      links: null,
      next: null,
      verdict: "NO MANIFEST SERVED",
    };
  }
  const bytes = new Uint8Array(await manifestResponse.arrayBuffer());
  const head = chainHeadOf(bytes);
  const manifest = { url: manifestUrl, status: manifestResponse.status, bytes: bytes.length, trailing_newline: head.trailing_newline, sha256: head.sha256 };
  if (row === null) return { date, mirror, manifest, links: null, next: null, verdict: "NO ROW ON THE MIRROR" };
  const links = row.manifest_sha256 === head.sha256;

  let next: HeadVerification["next"] = null;
  if (options.next === true) {
    const nd = nextDay(date);
    const nextUrl = chainDayUrl(nd);
    const nextResponse = await fetchPublic(nextUrl, options.fetch);
    if (!nextResponse.ok) {
      next = { date: nd, url: nextUrl, status: nextResponse.status, prev_date: null, prev_manifest_sha256: null, names_it: null, problem: `HTTP ${nextResponse.status}` };
    } else {
      const text = await nextResponse.text();
      let prevDate: string | null = null;
      let prev: string | null = null;
      let problem: string | null = null;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        prevDate = typeof parsed["prev_date"] === "string" ? parsed["prev_date"] : null;
        prev = typeof parsed["prev_manifest_sha256"] === "string" ? parsed["prev_manifest_sha256"] : null;
      } catch (error) {
        problem = `the next day's manifest is not JSON: ${(error as Error).message}`;
      }
      next = {
        date: nd,
        url: nextUrl,
        status: nextResponse.status,
        prev_date: prevDate,
        prev_manifest_sha256: prev,
        names_it: problem === null ? prev === head.sha256 && prevDate === date : null,
        problem,
      };
    }
  }
  return { date, mirror, manifest, links, next, verdict: links ? "LINKS" : "DOES NOT LINK" };
}

/** The verification, printed the way the CLI prints it. */
export function renderVerification(v: HeadVerification): string {
  const lines: string[] = [];
  lines.push(`${v.date}`);
  lines.push(`  head on the public copy (${v.mirror.rows} rows through ${v.mirror.through ?? "none"}): ${v.mirror.row?.manifest_sha256 ?? "no row for this day"}`);
  if ("sha256" in v.manifest) {
    lines.push(`  sha256 of ${v.manifest.url} (${v.manifest.bytes} bytes, trailing newline ${v.manifest.trailing_newline ? "stripped" : "absent"}): ${v.manifest.sha256}`);
  } else {
    lines.push(`  ${v.manifest.url}: ${v.manifest.problem}`);
  }
  if (v.next !== null) {
    if (v.next.problem !== null) lines.push(`  next day ${v.next.date}: ${v.next.problem}`);
    else lines.push(`  next day ${v.next.date} links back to ${v.next.prev_date ?? "?"} ${v.next.prev_manifest_sha256 ?? "?"}: ${v.next.names_it ? "NAMES IT" : "DOES NOT NAME IT"}`);
  }
  lines.push(v.verdict);
  return lines.join("\n");
}
