/**
 * THE PACKAGE'S OWN SHAPE: the version constant equals package.json, every declared bin is a
 * built file with a shebang, the build output is what `files` publishes, and the tarball carries
 * no fixture, test, source or environment file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { VERSION } from "../src/version.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);

test("VERSION equals package.json, and the package is named and licensed as published", async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(pkg["version"], VERSION);
  assert.equal(pkg["name"], "probe402-check");
  assert.equal(pkg["license"], "Apache-2.0");
  assert.equal(pkg["type"], "module");
  const licence = await readFile(path.join(ROOT, "LICENSE"), "utf8");
  assert.match(licence, /Apache License\s+Version 2\.0/);
});

test("every bin is built, starts with a shebang, and imports nothing outside dist", async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as { bin: Record<string, string> };
  const bins = Object.entries(pkg.bin);
  assert.equal(bins.length, 3);
  for (const [name, rel] of bins) {
    const text = await readFile(path.join(ROOT, rel), "utf8");
    assert.ok(text.startsWith("#!/usr/bin/env node\n"), `${name} (${rel}) has no shebang`);
    for (const m of text.matchAll(/from "([^"]+)"/g)) {
      const spec = m[1]!;
      if (spec.startsWith(".")) assert.ok(spec.endsWith(".js"), `${rel} imports ${spec}: a relative import in dist must end in .js`);
    }
  }
});

test("npm pack publishes dist, examples, README and LICENSE and nothing else", async () => {
  // `npm_execpath` is npm's own cli script, set for every `npm test`; running it through node needs
  // no shell on any platform (Windows refuses to spawn `npm.cmd` without one).
  const npmCli = process.env["npm_execpath"];
  assert.ok(npmCli !== undefined && npmCli !== "", "run this suite through `npm test`, so npm_execpath names npm's cli");
  const { stdout } = await run(process.execPath, [npmCli, "pack", "--dry-run", "--json"], { cwd: ROOT });
  const [report] = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
  const paths = report!.files.map((f) => f.path).sort();
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.includes("LICENSE"));
  assert.ok(paths.includes("package.json"));
  assert.ok(paths.includes("dist/index.js"));
  assert.ok(paths.includes("dist/cli/check.js"));
  assert.ok(paths.includes("examples/agent-decides.ts"));
  for (const p of paths) {
    assert.ok(
      p === "README.md" || p === "LICENSE" || p === "package.json" || p.startsWith("dist/") || p.startsWith("examples/"),
      `the tarball carries ${p}`,
    );
    assert.ok(!/\.env|fixtures|\.test\.|^src\/|^test\//.test(p), `the tarball carries ${p}`);
  }
});
