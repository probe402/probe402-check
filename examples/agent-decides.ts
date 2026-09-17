/**
 * THE DEMO: an agent about to pay three listed x402 routes asks probe402 and decides.
 *
 * Run it with Node 24 from the repository root:   node examples/agent-decides.ts
 * (Node 24 runs TypeScript directly; nothing is built.)
 *
 * The three ids are live routes on probe402's list. Two of them are on probe402's paid panel and
 * have been paid by it; the third is on the list and not on the panel. The decision below is the
 * DEMO's own policy, written out so you can read it: probe402 supplies dated readings, and the
 * agent's policy decides what a reading is worth.
 *
 * The policy:
 *   REFUSE  when the payment request the agent holds names a different payment address, amount,
 *           network or asset from the recorded quote.
 *   HOLD    when probe402 holds no route-level reading (a host, or an address not on its list),
 *           when the newest reading is past the route's own cadence, when the newest reading was
 *           not a quote, or when probe402 has never paid the route (no paid-delivery reading).
 *   PAY     when the newest reading is a quote inside cadence, the held request (if any) matches
 *           it, and probe402's own newest paid attempt was graded as settled.
 */
import { checkBeforePaying, type CheckResult, type HeldQuote } from "../src/check.ts";

type Decision = { decision: "PAY" | "HOLD" | "REFUSE"; because: string };

export function decide(result: CheckResult): Decision {
  if (result.kind === "host") return { decision: "HOLD", because: "this is a host, not a route; ask again with the route's full URL" };
  if (result.kind === "not-on-record") return { decision: "HOLD", because: "probe402 holds no record of this address; nothing here says anything about it" };
  if (result.held_quote !== null && result.held_quote.different.length > 0) {
    return { decision: "REFUSE", because: `the payment request I hold differs from the recorded quote on ${result.held_quote.different.join(", ")}` };
  }
  if (result.reading === null) return { decision: "HOLD", because: "no reading in the window" };
  if (result.reading.past_cadence === true) return { decision: "HOLD", because: `the newest reading is ${result.reading.age} old, past the route's cadence` };
  if (result.reading.outcome !== "Quoted") return { decision: "HOLD", because: `the newest reading was "${result.reading.outcome}", not a quote` };
  const newest = result.paid_delivery.newest;
  if (newest === null) return { decision: "HOLD", because: "probe402 has never paid this route, so there is no paid-delivery reading; pay a small amount before a larger one, or ask a human" };
  if (!/^Settled/.test(newest.outcome)) return { decision: "HOLD", because: `probe402's newest paid attempt was graded "${newest.outcome}"` };
  return { decision: "PAY", because: `quoting inside cadence; probe402 paid it on ${newest.attempted_at} and graded the result "${newest.outcome}"` };
}

/** What the agent is about to pay, and the 402 it is holding for each, where it holds one. */
const ABOUT_TO_PAY: ReadonlyArray<{ url: string; held_quote?: HeldQuote }> = [
  {
    // datastand.dev GET /api/data/dev-signals - on the paid panel, paid by probe402.
    url: "ep_67bec7d9e13ef185",
    // The 402 the agent holds. If the operator rotates its payment address, this reads REFUSE,
    // which is the point of comparing.
    held_quote: { pay_to: "0x470a1b647d668d3820add26d70c8371557ff4c6b", network: "eip155:8453", amount_atomic: "20000" },
  },
  {
    // api.myceliasignal.com GET /oracle/econ/calendar/fomc - on the paid panel, paid by probe402.
    url: "ep_addf52df476011b1",
  },
  {
    // api.myceliasignal.com GET /oracle/price/btc/usd - on the list, not on the paid panel.
    url: "ep_e68279cac4e97ffb",
  },
];

async function main(): Promise<void> {
  for (const item of ABOUT_TO_PAY) {
    process.stdout.write(`\n=== about to pay ${item.url}${item.held_quote ? " (holding a 402)" : ""}\n`);
    const result = await checkBeforePaying(item);
    process.stdout.write(`probe402 says: ${result.verdict}\n`);
    const { decision, because } = decide(result);
    process.stdout.write(`agent decides: ${decision} - ${because}\n`);
  }
}

if (process.argv[1] !== undefined && /agent-decides\.[cm]?[jt]s$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
