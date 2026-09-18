/**
 * THE DEMO: an agent meets three 402s at the moment of paying, and probe402's record decides.
 *
 * Run it with Node 24 from the repository root:   node examples/agent-pays.ts
 * (Node 24 runs TypeScript directly; nothing is built. It takes about fifteen seconds.)
 *
 * WHAT IS REAL HERE AND WHAT IS NOT. The three routes are live routes on probe402's list and every
 * reading printed is fetched from probe402.com while this runs. THE PAYMENT IS NOT: there is no
 * wallet, no key and no signer anywhere in this file or in this package. `payingFetch` below is a
 * ten-line stand-in for the published x402 client wrapper — it is composed exactly the way
 * `@x402/fetch`'s `wrapFetchWithPayment` composes, and where that one would sign, this one writes a
 * line saying it signed. `challengingOrigin` plays the three endpoints, returning the 402 each of
 * them was recorded quoting.
 *
 * So what you are watching is the ORDER: the endpoint answers 402, `wrapFetchWithCheck` asks
 * probe402 about that exact URL, the policy rules on what comes back, and only then does the payment
 * wrapper get its hands on the challenge. On `block` it never does.
 *
 * WHAT THE THREE READ, AND WHY.
 *   1. datastand.dev — probe402 pays this route and its newest paid attempt was graded "Settled and
 *      answered". Nothing is raised. The agent pays.
 *   2. 2s.io — probe402 is on this route's paid panel and every paid attempt it holds was graded
 *      "Refused before settlement": the endpoint would not take probe402's payment. That warns. A
 *      warning does not stop anything; the agent pays, having been told.
 *   3. 5108-x402.community.iamstarchild.com — probe402 paid this route twice, both payments are
 *      corroborated on Base, and neither came back with an answer. That blocks. The signer is never
 *      reached.
 *
 * The amounts and payment addresses in the challenges below are the ones probe402 recorded on
 * 2026-09-18. If an operator rotates its payment address, the live record stops matching the
 * challenge and the run reads REFUSE on that route — which is the reason to compare at all.
 */
import { wrapFetchWithCheck, PaymentBlocked, type HookDecision, type WrappedFetch } from "../src/x402-hook.ts";

type Route = { url: string; amount_atomic: string; pay_to: string };

/** The three routes, and the 402 each was recorded quoting. */
const ROUTES: readonly Route[] = [
  { url: "https://datastand.dev/api/data/dev-signals", amount_atomic: "20000", pay_to: "0x470a1b647d668d3820add26d70c8371557ff4c6b" },
  { url: "https://2s.io/api/domain/whois", amount_atomic: "2500", pay_to: "0x2b6D4988Db4723E6908Db86Ab2b8dFBc51FC32C5" },
  { url: "https://5108-x402.community.iamstarchild.com/bazaar/crypto/price", amount_atomic: "2000", pay_to: "0xa709b6534f392c5F4CfB986A329B734eCDdC8c6f" },
];

const USDC_ON_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** The three endpoints, played locally. Nothing in this demo touches them. */
const challengingOrigin: WrappedFetch = async (input, init) => {
  const address = typeof input === "object" && input !== null && "url" in input ? input.url : String(input);
  const route = ROUTES.find((candidate) => candidate.url === address);
  if (route === undefined) return new Response("no such route", { status: 404 });
  const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
  if (headers.has("x-payment")) return new Response(JSON.stringify({ ok: true, note: "the endpoint answered a paid request" }), { status: 200 });
  const challenge = {
    x402Version: 2,
    resource: { url: route.url },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: route.amount_atomic,
        asset: USDC_ON_BASE,
        payTo: route.pay_to,
        maxTimeoutSeconds: 60,
        extra: {},
      },
    ],
  };
  return new Response(JSON.stringify(challenge), { status: 402, headers: { "content-type": "application/json" } });
};

/**
 * A stand-in for the published x402 client wrapper, composed the way it composes: call the fetch it
 * was given, and on a 402 create a payment and retry. Where the real one signs with a wallet, this
 * one says so and sets a header. No key exists in this file.
 */
function payingFetch(underlying: WrappedFetch): WrappedFetch {
  return async (input, init) => {
    const response = await underlying(input, init);
    if (response.status !== 402) return response;
    const challenge = (await response.json()) as { accepts: Array<{ amount: string; payTo: string }> };
    const selected = challenge.accepts[0]!;
    process.stdout.write(`  the x402 client signs a payment of ${selected.amount} atomic units to ${selected.payTo}\n`);
    return underlying(input, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), "x-payment": "a signature would go here" } });
  };
}

async function main(): Promise<void> {
  const decisions: HookDecision[] = [];
  const checkedOrigin = wrapFetchWithCheck(challengingOrigin, {
    // Printed as the hook decides, so the order on screen is the order on the wire.
    onDecision: (decision) => {
      decisions.push(decision);
      process.stdout.write(`  the endpoint answers 402\n`);
      process.stdout.write(`  probe402 says: ${decision.result?.verdict ?? "probe402 could not be asked"}\n`);
      if (decision.ruling === "allow") process.stdout.write(`  ruling: ALLOW — ${decision.because}\n`);
    },
    warn: (line) => process.stdout.write(`  ${line}\n`),
  });
  const fetchWithPay = payingFetch(checkedOrigin);

  for (const route of ROUTES) {
    process.stdout.write(`\n=== the agent wants ${route.url}\n`);
    try {
      const response = await fetchWithPay(route.url);
      process.stdout.write(`  the endpoint answered HTTP ${response.status}\n`);
    } catch (error) {
      if (!(error instanceof PaymentBlocked)) throw error;
      process.stdout.write(`  ruling: BLOCK — ${error.decision.because}\n`);
      process.stdout.write(`  no payment was created. Cite ${error.decision.cite ?? "the grade address above"}\n`);
    }
  }

  process.stdout.write(`\n=== what happened\n`);
  for (const decision of decisions) {
    process.stdout.write(`  ${decision.ruling.padEnd(5)} ${decision.url}\n`);
    for (const signal of decision.signals) process.stdout.write(`        ${signal.ruling}: ${signal.name} — ${signal.because}\n`);
  }
}

if (process.argv[1] !== undefined && /agent-pays\.[cm]?[jt]s$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
