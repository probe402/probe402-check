/**
 * THE HEAD VERIFIER, DRIVEN WITH TWO REAL SEALED DAYS. `chain-2026-08-21.json` and
 * `chain-2026-08-22.json` are the manifests probe402.com served on 2026-09-17, byte for byte;
 * `ARCHIVE-CHAIN-2026-09-17.md` is the public head table as pushed that morning (25 rows through
 * 2026-09-14). The digest of the first must equal row 0, the second must name it, and one flipped
 * byte must break the link.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { chainDayUrl, headsMirrorTableUrl, type Fetch } from "../src/public-surfaces.ts";
import { chainHeadOf, nextDay, parseMirrorTable, renderVerification, verifyHead } from "../src/verify-head.ts";

const ROW_0 = "f0bca18bc38e9a7d202bedc12def262cd4a17ec61136ee07f911afc775bafc65";
const ROW_1 = "6c7307b90cd4526281918351d2db867a16649334670c2b6d8a181b7bee95fb5b";

async function bytesOf(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
}

function serving(files: Record<string, Uint8Array | number>): { fetch: Fetch; requested: string[] } {
  const requested: string[] = [];
  const fetch: Fetch = async (url) => {
    requested.push(url);
    const body = files[url];
    if (body === undefined) return new Response("not routed", { status: 599 });
    if (typeof body === "number") return new Response("", { status: body });
    return new Response(body, { status: 200 });
  };
  return { fetch, requested };
}

test("the public table parses into rows, in order, and skips everything that is not a row", async () => {
  const rows = parseMirrorTable(await readFile(new URL("./fixtures/ARCHIVE-CHAIN-2026-09-17.md", import.meta.url), "utf8"));
  assert.equal(rows.length, 25);
  assert.deepEqual(rows[0], { date: "2026-08-21", chain_index: 0, manifest_sha256: ROW_0 });
  assert.deepEqual(rows[1], { date: "2026-08-22", chain_index: 1, manifest_sha256: ROW_1 });
  assert.equal(rows[24]!.date, "2026-09-14");
  assert.deepEqual(parseMirrorTable("# no rows\n| date | idx |\n|---|---|\n"), []);
});

test("the served bytes minus one trailing newline hash to the published head, and the newline matters", async () => {
  const bytes = await bytesOf("chain-2026-08-21.json");
  assert.equal(bytes[bytes.length - 1], 0x0a, "the served manifest ends in exactly one newline");
  const head = chainHeadOf(bytes);
  assert.deepEqual(head, { sha256: ROW_0, trailing_newline: true });
  const withNewline = createHash("sha256").update(bytes).digest("hex");
  assert.notEqual(withNewline, ROW_0, "hashing the newline too must give a different digest, or the strip is not load-bearing");
  // Bytes with no trailing newline are hashed whole and say so.
  assert.deepEqual(chainHeadOf(bytes.subarray(0, bytes.length - 1)), { sha256: ROW_0, trailing_newline: false });
});

test("LINKS: a day on the mirror whose manifest hashes to its row, and the next day names it", async () => {
  const { fetch, requested } = serving({
    [headsMirrorTableUrl()]: await bytesOf("ARCHIVE-CHAIN-2026-09-17.md"),
    [chainDayUrl("2026-08-21")]: await bytesOf("chain-2026-08-21.json"),
    [chainDayUrl("2026-08-22")]: await bytesOf("chain-2026-08-22.json"),
  });
  const v = await verifyHead("2026-08-21", { fetch, next: true });
  assert.deepEqual(requested, [headsMirrorTableUrl(), chainDayUrl("2026-08-21"), chainDayUrl("2026-08-22")]);
  assert.equal(v.verdict, "LINKS");
  assert.equal(v.links, true);
  assert.equal(v.mirror.rows, 25);
  assert.equal(v.mirror.through, "2026-09-14");
  assert.equal(v.mirror.row?.manifest_sha256, ROW_0);
  assert.ok("sha256" in v.manifest);
  if ("sha256" in v.manifest) {
    assert.equal(v.manifest.sha256, ROW_0);
    assert.equal(v.manifest.bytes, 109954);
    assert.equal(v.manifest.trailing_newline, true);
  }
  assert.deepEqual(v.next, {
    date: "2026-08-22",
    url: chainDayUrl("2026-08-22"),
    status: 200,
    prev_date: "2026-08-21",
    prev_manifest_sha256: ROW_0,
    names_it: true,
    problem: null,
  });
  const rendered = renderVerification(v);
  assert.match(rendered, /^2026-08-21\n/);
  assert.match(rendered, new RegExp(`head on the public copy \\(25 rows through 2026-09-14\\): ${ROW_0}`));
  assert.match(rendered, new RegExp(`sha256 of https://probe402\\.com/chain/2026-08-21 \\(109954 bytes, trailing newline stripped\\): ${ROW_0}`));
  assert.match(rendered, /next day 2026-08-22 links back to 2026-08-21 f0bca18b.*: NAMES IT/);
  assert.match(rendered, /\nLINKS$/);
});

test("RED: one flipped byte in the served manifest reads DOES NOT LINK with both digests printed", async () => {
  const bytes = await bytesOf("chain-2026-08-21.json");
  const flipped = new Uint8Array(bytes);
  flipped[100] = flipped[100]! ^ 0x01;
  const { fetch } = serving({
    [headsMirrorTableUrl()]: await bytesOf("ARCHIVE-CHAIN-2026-09-17.md"),
    [chainDayUrl("2026-08-21")]: flipped,
  });
  const v = await verifyHead("2026-08-21", { fetch });
  assert.equal(v.verdict, "DOES NOT LINK");
  assert.equal(v.links, false);
  assert.ok("sha256" in v.manifest && v.manifest.sha256 !== ROW_0);
  const rendered = renderVerification(v);
  assert.match(rendered, new RegExp(ROW_0));
  assert.match(rendered, /\nDOES NOT LINK$/);
});

test("RED: the next day carrying a different digest reads DOES NOT NAME IT while the day itself still LINKS", async () => {
  const next = Buffer.from(await bytesOf("chain-2026-08-22.json")).toString("utf8").replace(ROW_0, ROW_1);
  const { fetch } = serving({
    [headsMirrorTableUrl()]: await bytesOf("ARCHIVE-CHAIN-2026-09-17.md"),
    [chainDayUrl("2026-08-21")]: await bytesOf("chain-2026-08-21.json"),
    [chainDayUrl("2026-08-22")]: new Uint8Array(Buffer.from(next, "utf8")),
  });
  const v = await verifyHead("2026-08-21", { fetch, next: true });
  assert.equal(v.verdict, "LINKS");
  assert.equal(v.next?.names_it, false);
  assert.match(renderVerification(v), /DOES NOT NAME IT/);
});

test("a sealed day the mirror has not reached yet, and a day the archive does not serve, are named as such", async () => {
  const { fetch } = serving({
    [headsMirrorTableUrl()]: await bytesOf("ARCHIVE-CHAIN-2026-09-17.md"),
    [chainDayUrl("2026-08-21")]: await bytesOf("chain-2026-08-21.json"),
    [chainDayUrl("2026-09-15")]: await bytesOf("chain-2026-08-21.json"),
    [chainDayUrl("2026-09-30")]: 404,
  });
  const notOnMirror = await verifyHead("2026-09-15", { fetch });
  assert.equal(notOnMirror.verdict, "NO ROW ON THE MIRROR");
  assert.equal(notOnMirror.links, null);
  assert.equal(notOnMirror.mirror.row, null);
  const notServed = await verifyHead("2026-09-30", { fetch });
  assert.equal(notServed.verdict, "NO MANIFEST SERVED");
  assert.ok("problem" in notServed.manifest && notServed.manifest.problem === "HTTP 404");
  const nextMissing = await verifyHead("2026-08-21", { fetch, next: true });
  assert.equal(nextMissing.verdict, "LINKS");
  assert.equal(nextMissing.next?.problem, "HTTP 599");
  assert.equal(nextMissing.next?.names_it, null);
  await assert.rejects(verifyHead("not-a-day", { fetch }), /not a calendar day/);
});

test("nextDay counts in UTC across a month and a year", () => {
  assert.equal(nextDay("2026-08-31"), "2026-09-01");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
  assert.equal(nextDay("2028-02-28"), "2028-02-29");
});
