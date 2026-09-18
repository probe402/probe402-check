#!/usr/bin/env node
/**
 * probe402-check --mcp
 * probe402-check <url-or-endpoint-id> [--pay-to <address>] [--amount <atomic>] [--network <caip2>]
 *                [--asset <address>] [--scheme <name>] [--explain] [--json]
 *
 * Prints the one-line reading and the address to cite; `--explain` prints the readings it stood on,
 * each with the date it stands at and the address that holds it; `--json` prints the whole result.
 * `--mcp` serves the MCP tool over stdio instead, so one published package name reaches both
 * readers: a person typing a URL, and an MCP client that runs `npx probe402-check --mcp`. The server
 * is imported on that flag alone, so a plain check does not load the MCP SDK.
 *
 * Exit 0 when probe402 answered, 1 when it could not be asked, 2 on usage.
 */
import { checkBeforePaying, type HeldQuote } from "../check.ts";
import { renderFacts } from "../facts.ts";

const USAGE =
  "usage: probe402-check <url-or-endpoint-id> [--pay-to <address>] [--amount <atomic>] [--network <caip2>] " +
  "[--asset <address>] [--scheme <name>] [--explain] [--json]\n" +
  "       probe402-check --mcp   (serve the MCP tool over stdio)";

export function parseArgs(argv: readonly string[]): { url: string; held_quote: HeldQuote | null; json: boolean; explain: boolean } | { error: string } {
  let url: string | null = null;
  let json = false;
  let explain = false;
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
    if (arg === "--explain") {
      explain = true;
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
  return { url, held_quote: Object.keys(held).length === 0 ? null : held, json, explain };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--mcp")) {
    const { serveStdio } = await import("../mcp-server.ts");
    await serveStdio();
    return 0;
  }
  const parsed = parseArgs(argv);
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
      if (parsed.explain) {
        process.stdout.write(`\nThe readings this stood on:\n${renderFacts(result.facts)}\n`);
      }
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
