#!/usr/bin/env node
/**
 * probe402-verify-head <YYYY-MM-DD> [--next] [--json]
 *
 * Fetches the day's head from the public copy of the head table and the day's manifest from
 * probe402.com, recomputes the head, and prints LINKS or DOES NOT LINK with both digests.
 * `--next` also fetches the following day's manifest and checks that it names the same digest.
 * Exit 0 on LINKS, 1 on DOES NOT LINK, 2 when the check could not be made or on usage.
 */
import { renderVerification, verifyHead } from "../verify-head.ts";

const USAGE = "usage: probe402-verify-head <YYYY-MM-DD> [--next] [--json]";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const next = args.includes("--next");
  const positional = args.filter((a) => !a.startsWith("--"));
  const date = positional[0];
  if (date === undefined || positional.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  try {
    const verification = await verifyHead(date, { next });
    process.stdout.write(`${json ? JSON.stringify(verification, null, 2) : renderVerification(verification)}\n`);
    if (verification.verdict === "LINKS") return verification.next !== null && verification.next.names_it === false ? 1 : 0;
    if (verification.verdict === "DOES NOT LINK") return 1;
    return 2;
  } catch (error) {
    process.stderr.write(`probe402-verify-head could not check ${date}: ${(error as Error).message}\n`);
    return 2;
  }
}

main().then((code) => {
  process.exitCode = code;
});
