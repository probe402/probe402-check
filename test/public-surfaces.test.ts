/**
 * THE ALLOWLIST GUARD. Every outbound URL this code can form is one of the public probe402
 * surfaces in `src/public-surfaces.ts`, every request goes through `fetchPublic`, and
 * `fetchPublic` refuses anything else. Driven red with an extra path, a look-alike host, a plain
 * http scheme, and a scan of the sources for an address formed anywhere else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HEADS_MIRROR_REPOSITORY,
  HEADS_MIRROR_TABLE_URL,
  PROBE402_ORIGIN,
  PUBLIC_SURFACES,
  THIS_REPOSITORY,
  USER_AGENT,
  chainDayUrl,
  encodeResource,
  fetchPublic,
  gradeByIdUrl,
  gradeByUrlUrl,
  headsMirrorTableUrl,
  surfaceOf,
} from "../src/public-surfaces.ts";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out.sort();
}

test("every URL a builder forms is on the allowlist, and matches exactly one surface", () => {
  const formed = [
    gradeByIdUrl("ep_67bec7d9e13ef185"),
    gradeByUrlUrl("https://datastand.dev/api/data/dev-signals"),
    gradeByUrlUrl("https://api.myceliasignal.com"),
    gradeByUrlUrl("api.myceliasignal.com"),
    gradeByUrlUrl("https://x.example/a b?c=d&e=(f)!'*"),
    chainDayUrl("2026-08-21"),
    headsMirrorTableUrl(),
  ];
  const seen = new Set<string>();
  for (const url of formed) {
    const surface = surfaceOf(url);
    assert.notEqual(surface, null, `${url} is not on the allowlist`);
    seen.add(surface!);
    assert.equal(PUBLIC_SURFACES.filter((s) => s.pattern.test(url)).length, 1, `${url} matches more than one surface`);
  }
  assert.equal(seen.size, PUBLIC_SURFACES.length, "a surface on the allowlist has no builder that forms it");
  assert.equal(PUBLIC_SURFACES.length, 4);
});

test("encodeResource leaves nothing outside the characters the grade-by-url surface names", () => {
  const encoded = encodeResource("https://x.example/a b?c=d&e=(f)!'*~._-");
  assert.match(encoded, /^[A-Za-z0-9%._~-]+$/);
  assert.equal(decodeURIComponent(encoded), "https://x.example/a b?c=d&e=(f)!'*~._-");
});

test("builders refuse an input that could not form an allowlisted URL", () => {
  assert.throws(() => gradeByIdUrl("ep_zz"), /not a probe402 endpoint id/);
  assert.throws(() => gradeByIdUrl("ep_67bec7d9e13ef185/../coverage"), /not a probe402 endpoint id/);
  assert.throws(() => chainDayUrl("2026-8-1"), /not a calendar day/);
  assert.throws(() => chainDayUrl("2026-08-21/../../method"), /not a calendar day/);
  assert.throws(() => gradeByUrlUrl("  "), /empty/);
});

test("RED: fetchPublic refuses one extra path, a look-alike host and a plain scheme, and makes no request", async () => {
  const requested: string[] = [];
  const spy = async (url: string): Promise<Response> => {
    requested.push(url);
    return new Response("{}", { status: 200 });
  };
  const refused = [
    `${PROBE402_ORIGIN}/coverage`,
    `${PROBE402_ORIGIN}/grade/ep_67bec7d9e13ef185/now`,
    `${PROBE402_ORIGIN}/chain`,
    `${PROBE402_ORIGIN}/grade?url=https://datastand.dev/x`,
    "https://probe402.com.example.net/grade/ep_67bec7d9e13ef185",
    "http://probe402.com/grade/ep_67bec7d9e13ef185",
    "https://raw.githubusercontent.com/probe402/probe402-chain-heads/main/README.md",
    "https://raw.githubusercontent.com/someone-else/probe402-chain-heads/main/ARCHIVE-CHAIN.md",
  ];
  for (const url of refused) {
    await assert.rejects(fetchPublic(url, spy), /refuses to fetch/, `${url} was not refused`);
  }
  assert.deepEqual(requested, [], "a refused URL reached the fetch implementation");
  // And the door opens for an allowlisted one, carrying the user-agent and refusing redirects.
  let init: RequestInit | null = null;
  const response = await fetchPublic(gradeByIdUrl("ep_67bec7d9e13ef185"), async (url, i) => {
    requested.push(url);
    init = i;
    return new Response("{}", { status: 200 });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(requested, [gradeByIdUrl("ep_67bec7d9e13ef185")]);
  assert.equal(init!.redirect, "error", "a redirect would be a second address; it must be refused");
  assert.equal((init!.headers as Record<string, string>)["user-agent"], USER_AGENT);
  assert.match(USER_AGENT, /^probe402-check\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/probe402\/probe402-check\)$/);
});

test("the sources form no address anywhere else, and make no request outside fetchPublic", async () => {
  const declared = new Set([PROBE402_ORIGIN, HEADS_MIRROR_REPOSITORY, HEADS_MIRROR_TABLE_URL, THIS_REPOSITORY]);
  const files = await sourceFiles(SRC);
  assert.ok(files.length >= 7, `the scan found ${files.length} source files`);
  let literals = 0;
  let fetchCalls = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    for (const m of text.matchAll(/["'`](https?:\/\/[^"'`\s]*)["'`]/g)) {
      literals++;
      assert.ok(declared.has(m[1]!), `${rel} forms an address of its own: ${m[1]}`);
      assert.equal(rel, "public-surfaces.ts", `${rel} declares an address; only public-surfaces.ts may`);
    }
    for (const m of text.matchAll(/\bfetch\s*\(/g)) {
      fetchCalls++;
      assert.equal(rel, "public-surfaces.ts", `${rel} calls fetch directly at offset ${m.index}; every request goes through fetchPublic`);
    }
    // A literal that starts a URL by concatenation is the same hole: the origin is spelled once.
    for (const m of text.matchAll(/["'`](https?:\/\/[^"'`\s]*)/g)) {
      assert.ok(declared.has(m[1]!.replace(/["'`].*$/, "")), `${rel} spells an address fragment: ${m[1]}`);
    }
  }
  assert.equal(literals, 4, `expected the four declared addresses, found ${literals} address literals`);
  assert.equal(fetchCalls, 1, `expected the one fetch call inside fetchPublic, found ${fetchCalls}`);
});
