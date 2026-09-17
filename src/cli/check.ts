#!/usr/bin/env node
/**
 * probe402-check <url-or-endpoint-id> [--pay-to <address>] [--amount <atomic>] [--network <caip2>]
 *                [--asset <address>] [--scheme <name>] [--json]
 *
 * Prints the one-line reading and the address to cite; `--json` prints the whole result.
 * Exit 0 when probe402 answered, 1 when it could not be asked, 2 on usage.
 */
import { checkBeforePaying, type HeldQuote } from "../check.ts";

const USAGE =
  "usage: probe402-check <url-or-endpoint-id> [--pay-to <address>] [--amount <atomic>] [--network <caip2>] " +
  "[--asset <address>] [--scheme <name>] [--json]";

export function parseArgs(argv: readonly string[]): { url: string; held_quote: HeldQuote | null; json: boolean } | { error: string } {
  let url: string | null = null;
  let json = false;
  const held: HeldQuote = {};
  const takes: Record<string, keyof HeldQuote> = {
    "--pay-to": "pay_to",
    "--amount": "amount_atomic",
    "--network": "network",
    "--asset": "asset",
    "--scheme": "scheme",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") {
      json = true;
      continue;
    }
    const field = takes[arg];
    if (field !== undefined) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { error: `${arg} needs a value` };
      held[field] = value;
      i++;
      continue;
    }
    if (arg.startsWith("--")) return { error: `unknown flag ${arg}` };
    if (url !== null) return { error: "one URL or endpoint id at a time" };
    url = arg;
  }
  if (url === null) return { error: "a URL or endpoint id is required" };
  return { url, held_quote: Object.keys(held).length === 0 ? null : held, json };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n${USAGE}\n`);
    return 2;
  }
  try {
    const result = await checkBeforePaying(parsed.held_quote === null ? { url: parsed.url } : { url: parsed.url, held_quote: parsed.held_quote });
    if (parsed.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${result.verdict}\n`);
      if (result.kind === "host") {
        for (const route of result.routes) {
          const paid = route.last_paid_at === null ? "not paid by probe402" : `paid by probe402, last ${route.last_paid_at}`;
          process.stdout.write(`  ${route.method ?? "?"} ${route.path ?? "?"}  ${route.grade_url}  (${paid})\n`);
        }
      }
    }
    return 0;
  } catch (error) {
    process.stderr.write(`probe402-check could not answer: ${(error as Error).message}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && /check\.[cm]?[jt]s$/.test(process.argv[1])) {
  main().then((code) => {
    process.exitCode = code;
  });
}
