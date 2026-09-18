/**
 * THE HOOK THAT SITS WHERE THE PAYMENT HAPPENS.
 *
 * v0.1 of this tool answers when an agent remembers to ask. An agent has to remember. This wraps the
 * fetch an x402 client pays through, so the question is asked by the machinery instead — on the 402,
 * BEFORE the payment is created.
 *
 * HOW IT COMPOSES, AND WHY THAT ORDER. Both published x402 client wrappers take the fetch they will
 * use as their argument and call it before they sign anything:
 *
 *   - `@x402/fetch` 2.26.0:  `wrapFetchWithPayment` takes the fetch and a client, awaits the fetch on
 *     the request, and only if the status is 402 calls `client.createPaymentPayload(...)`.
 *   - `x402-fetch` 1.2.0:    `wrapFetchWithPayment` takes the fetch and a wallet, awaits the fetch on
 *     the input and init, and only if the status is 402 calls `createPaymentHeader(walletClient, …)`.
 *
 * (Written out rather than quoted: the allowlist guard scans these sources for a call to fetch made
 * outside the one door, and a quotation of somebody else's call is indistinguishable from one.)
 *
 * So the check goes UNDERNEATH the payment wrapper, not around it:
 *
 *     const fetchWithPay = wrapFetchWithPayment(wrapFetchWithCheck(fetch), client);
 *
 * The 402 reaches this code before the signer sees it. On `block` it throws `PaymentBlocked`, and the
 * payment is never created; on `allow` or `warn` the 402 is handed back byte for byte and the payment
 * wrapper does exactly what it would have done.
 *
 * WHAT IT DOES NOT TOUCH. It never sees a signer, a key or a wallet, never adds, removes or rewrites a
 * header on the way out, and never changes the payment. It reads the 402's body through a clone, so
 * the payment wrapper still reads the body itself. Its own question goes to probe402's free grade
 * through `fetchPublic`, which is the same allowlisted door the rest of this package uses.
 *
 * A request that already carries a payment header is the payment wrapper's own retry: it is passed
 * straight through, so one payment costs one question and not two.
 *
 * THE POLICY IS THE CALLER'S. `DEFAULT_POLICY` in `policy.ts` is a table of named signals; this code
 * reports the facts and applies whatever table it is handed.
 */
import { checkBeforePaying, type CheckResult } from "./check.ts";
import { compareChallenge, readChallenge, type Challenge, type ChallengeComparison } from "./challenge.ts";
import type { Fact } from "./facts.ts";
import { decide, recordUnavailable, rule, type Decision, type Policy } from "./policy.ts";

/** The shape both x402 client wrappers expect of the fetch they are given. */
export type WrappedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type HookDecision = Decision & {
  /** The address the 402 was returned for. */
  url: string;
  /** probe402's answer, or `null` when probe402 could not be asked. */
  result: CheckResult | null;
  /** The 402 as it was read off the wire, or `null` when its body is not an x402 challenge. */
  challenge: Challenge | null;
  /** The recorded quote against the ways to pay the 402 offers, or `null` when there was nothing to compare. */
  comparison: ChallengeComparison | null;
  /** The readings this decision stood on. */
  facts: Fact[];
  /** One line, for a log. */
  line: string;
};

/** Thrown instead of paying when the policy rules `block`. The decision travels with it. */
export class PaymentBlocked extends Error {
  readonly decision: HookDecision;
  constructor(decision: HookDecision) {
    super(`probe402-check blocked a payment to ${decision.url}: ${decision.because}`);
    this.name = "PaymentBlocked";
    this.decision = decision;
  }
}

export type CheckHookOptions = {
  /** Rulings for the named signals; anything left out keeps its default. */
  policy?: Policy;
  /** How probe402 is asked. The default is one request to the free grade. */
  ask?: (url: string) => Promise<CheckResult>;
  /** Called with every decision, before it is acted on. */
  onDecision?: (decision: HookDecision) => void;
  /** Where a `warn` line is written. The default is standard error. */
  warn?: (line: string) => void;
};

/** The headers an x402 client puts on the request it has already paid for. */
const PAYMENT_HEADERS = ["x-payment", "payment-signature"] as const;

/**
 * Wrap a fetch so every 402 it returns is checked against probe402's record before the caller's
 * x402 client signs anything.
 */
export function wrapFetchWithCheck(innerFetch: WrappedFetch, options: CheckHookOptions = {}): WrappedFetch {
  const ask = options.ask ?? ((url: string): Promise<CheckResult> => checkBeforePaying({ url }));
  const write = options.warn ?? ((line: string): void => void process.stderr.write(`${line}\n`));
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await innerFetch(input, init);
    if (response.status !== 402) return response;
    if (alreadyPaying(input, init)) return response;

    const url = addressOf(input, response);
    const challenge = await readChallengeFrom(response);
    let result: CheckResult | null = null;
    let comparison: ChallengeComparison | null = null;
    let decision: Decision;
    try {
      result = await ask(url);
      comparison = challenge === null || result.kind !== "route" ? null : compareChallenge(challenge, result.quote);
      decision = decide(result, comparison, options.policy);
    } catch (error) {
      decision = rule([recordUnavailable((error as Error).message)], options.policy);
    }
    const hookDecision: HookDecision = {
      ...decision,
      url,
      result,
      challenge,
      comparison,
      facts: [...(result?.facts ?? []), ...challengeFacts(challenge, comparison)],
      line: `probe402-check ${decision.ruling.toUpperCase()} ${url} — ${decision.because}${decision.cite === null ? "" : `. Cite ${decision.cite}`}`,
    };
    options.onDecision?.(hookDecision);
    if (hookDecision.ruling === "block") throw new PaymentBlocked(hookDecision);
    if (hookDecision.ruling === "warn") write(hookDecision.line);
    return response;
  };
}

/** Is this the payment wrapper's own retry, carrying a payment it has already made? */
function alreadyPaying(input: RequestInfo | URL, init?: RequestInit): boolean {
  // x402 v1 marks its retry on the init object itself; v2 marks it with the header.
  if (init !== undefined && (init as Record<string, unknown>)["__is402Retry"] === true) return true;
  const headers = headersOf(input, init);
  return headers !== null && PAYMENT_HEADERS.some((name) => headers.has(name));
}

function headersOf(input: RequestInfo | URL, init?: RequestInit): Headers | null {
  if (init?.headers !== undefined) return new Headers(init.headers);
  if (typeof input === "object" && input !== null && "headers" in input && input.headers instanceof Headers) return input.headers;
  return null;
}

/** The address the challenge is about: what the response says it is, else what was asked for. */
function addressOf(input: RequestInfo | URL, response: Response): string {
  if (response.url !== "") return response.url;
  if (typeof input === "object" && input !== null && "url" in input && typeof input.url === "string") return input.url;
  return String(input);
}

/** The 402's body, read through a clone so the caller's x402 client still reads it itself. */
async function readChallengeFrom(response: Response): Promise<Challenge | null> {
  try {
    const text = await response.clone().text();
    if (text.trim() === "") return null;
    return readChallenge(JSON.parse(text));
  } catch {
    return null;
  }
}

function challengeFacts(challenge: Challenge | null, comparison: ChallengeComparison | null): Fact[] {
  if (challenge === null) {
    return [
      {
        fact: "The 402 being answered could not be read as an x402 payment requirement, so its live quote was not compared with the recorded one.",
        as_of: null,
        cite: null,
      },
    ];
  }
  const facts: Fact[] = [
    {
      fact: `The 402 being answered offers ${challenge.accepts.length} way(s) to pay${
        challenge.accepts.length === 0 ? "" : `: ${challenge.accepts.map(describe).join("; ")}`
      }.`,
      as_of: null,
      cite: null,
    },
  ];
  if (comparison !== null) {
    const same = Object.entries(comparison.fields).filter(([, reading]) => reading === "same").map(([field]) => field);
    facts.push({
      fact:
        `Against the quote probe402 recorded, that 402 reads the same on ${same.length === 0 ? "no field" : same.join(", ")}` +
        `${comparison.different.length === 0 ? "" : `, differs on ${comparison.different.join(", ")}`}` +
        `${comparison.not_compared.length === 0 ? "" : `, and could not be compared on ${comparison.not_compared.join(", ")}`}.`,
      as_of: null,
      cite: null,
    });
  }
  return facts;
}

function describe(quote: { amount_atomic: string | null; asset: string | null; network_as_served: string | null; pay_to: string | null }): string {
  return `${quote.amount_atomic ?? "?"} atomic units of ${quote.asset ?? "?"} on ${quote.network_as_served ?? "?"} to ${quote.pay_to ?? "?"}`;
}
