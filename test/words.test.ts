/**
 * THE WORD GATE. probe402 refuses two kinds of word on anything it publishes: a claim of primacy
 * (only, unlike, first, best) and a conclusion its record does not license (healthy, degraded,
 * uptime, online, trustworthy, verified). The patterns below are copied from probe402's own suite.
 * This tool speaks for that record when it prints a verdict, so its README, every string its
 * sources and examples carry, and every verdict the fixtures produce go through the same gate. A
 * word inside a code span is a quotation of somebody else's token and is blanked before the scan.
 * The response to a hit is to reword, never to loosen the pattern.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readAnswer } from "../src/check.ts";
import { signalsOf } from "../src/policy.ts";
import { TOOL_DESCRIPTION } from "../src/mcp-server.ts";
import { renderVerification, verifyHead } from "../src/verify-head.ts";
import { chainDayUrl, headsMirrorTableUrl, type Fetch } from "../src/public-surfaces.ts";

const PRIMACY_WORDS = /\b(only|unlike|first|best)\b/i;
const OUTCOME_WORDS = /\b(healthy|degraded|uptime|online|trustworthy|verified)\b/i;

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function outsideCodeSpans(value: string): string {
  return value.replace(/`[^`]*`/g, " ");
}

function outsideFences(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, " ");
}

/** Every quoted string in a TypeScript source: double, single and template literals. */
function stringLiterals(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) out.push(m[0].slice(1, -1));
  return out;
}

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsFiles(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out.sort();
}

function scan(name: string, prose: string): void {
  assert.equal(PRIMACY_WORDS.exec(prose)?.[0], undefined, `${name} claims primacy: ${excerpt(prose, PRIMACY_WORDS)}`);
  assert.equal(OUTCOME_WORDS.exec(prose)?.[0], undefined, `${name} carries a word the record does not license: ${excerpt(prose, OUTCOME_WORDS)}`);
}

function excerpt(text: string, pattern: RegExp): string {
  const m = pattern.exec(text);
  if (m === null || m.index === undefined) return "";
  return JSON.stringify(text.slice(Math.max(0, m.index - 60), m.index + 60));
}

test("the README passes the gate outside code", async () => {
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  const prose = outsideCodeSpans(outsideFences(readme));
  assert.ok(prose.length > 2000, `README blanked to ${prose.length} characters; the scan is reading a stub`);
  scan("README.md", prose);
});

test("every string the sources and examples carry passes the gate", async () => {
  const files = [...(await tsFiles(path.join(ROOT, "src"))), ...(await tsFiles(path.join(ROOT, "examples")))];
  assert.ok(files.length >= 9, `${files.length} files scanned`);
  let strings = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    for (const literal of stringLiterals(await readFile(file, "utf8"))) {
      strings++;
      scan(`${rel} string ${JSON.stringify(literal.slice(0, 40))}`, outsideCodeSpans(literal));
    }
  }
  assert.ok(strings > 100, `${strings} strings scanned`);
  scan("TOOL_DESCRIPTION", TOOL_DESCRIPTION);
});

test("every verdict the recorded answers produce passes the gate", async () => {
  const fixtures = [
    "grade-ep_67bec7d9e13ef185.json",
    "grade-ep_addf52df476011b1.json",
    "grade-ep_e68279cac4e97ffb.json",
    "grade-ep_2ad33c17afc373f4.json",
    "grade-ep_4d864a69497e351a.json",
    "grade-host-api.myceliasignal.com.json",
    "grade-not-covered.json",
  ];
  let verdicts = 0;
  let sentences = 0;
  for (const name of fixtures) {
    const answer = JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
    for (const held of [null, { pay_to: "0x1", amount_atomic: "1", network: "eip155:1", asset: "0x2", scheme: "exact" }]) {
      const result = readAnswer("asked", answer, held);
      verdicts++;
      scan(`${name} verdict`, outsideCodeSpans(result.verdict));
      // The verdict is one sentence; the facts and the signals are the rest of what this tool says.
      for (const fact of result.facts) scan(`${name} fact`, outsideCodeSpans(fact.fact));
      for (const signal of signalsOf(result, null)) scan(`${name} signal ${signal.name}`, outsideCodeSpans(signal.because));
      sentences += result.facts.length;
    }
  }
  assert.equal(verdicts, 14);
  assert.ok(sentences > 40, `${sentences} facts scanned; the scan is reading a stub`);
  const fetch: Fetch = async (url) => {
    if (url === headsMirrorTableUrl()) return new Response(await readFile(new URL("./fixtures/ARCHIVE-CHAIN-2026-09-17.md", import.meta.url)), { status: 200 });
    if (url === chainDayUrl("2026-08-21")) return new Response(await readFile(new URL("./fixtures/chain-2026-08-21.json", import.meta.url)), { status: 200 });
    return new Response("", { status: 404 });
  };
  scan("verify-head rendering", renderVerification(await verifyHead("2026-08-21", { fetch, next: true })));
  scan("verify-head rendering, no row", renderVerification(await verifyHead("2026-09-30", { fetch })));
});

test("RED: the gate fires on a planted claim and not on the same word quoted", () => {
  assert.throws(() => scan("planted", outsideCodeSpans("the best x402 monitor")), /claims primacy/);
  assert.throws(() => scan("planted", outsideCodeSpans("an endpoint that is verified")), /does not license/);
  assert.doesNotThrow(() => scan("quoted", outsideCodeSpans("their `verified` field")));
});
