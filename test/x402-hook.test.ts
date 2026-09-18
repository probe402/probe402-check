/**
 * THE HOOK, DRIVEN AGAINST BOTH PUBLISHED x402 CLIENT WRAPPERS.
 *
 * `payingV2` and `payingV1` below are not inventions: each is the ordering of the wrapper it is
 * named for, taken from the published package's own build —
 *
 *   `@x402/fetch` 2.26.0   `const response = await fetch(request); if (response.status !== 402) return response;`
 *                          `… await response.text() … await client.createPaymentPayload(…) … fetch(clonedRequest.clone())`
 *   `x402-fetch` 1.2.0     `const response = await fetch(input, init); if (response.status !== 402) return response;`
 *                          `… await response.json() … await createPaymentHeader(walletClient, …) … fetch(input, newInit)`
 *
 * — so what these tests hold is the property the hook exists for: the SIGNER IS NOT REACHED when the
 * policy blocks. `signed` counts the calls the real wrapper makes to its wallet. Every test that
 * claims a payment was stopped asserts that counter, not the return value.
 *
 * Both wrappers read the 402's body themselves, after the hook has read it. A hook that consumed
 * the body would break the real wrapper and pass a test that only looked at the status, so the
 * stand-ins read the body the same way theirs do — and one test drives exactly that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { readAnswer, type CheckResult } from "../src/check.ts";
import { PaymentBlocked, wrapFetchWithCheck, type HookDecision, type WrappedFetch } from "../src/x402-hook.ts";

const USDC_ON_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAID = "https://datastand.dev/api/data/dev-signals";
const NEVER_ANSWERED = "https://5108-x402.community.iamstarchild.com/bazaar/crypto/price";

async function recorded(fixture: string, asked: string): Promise<CheckResult> {
  const answer = JSON.parse(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8")) as Record<string, unknown>;
  return readAnswer(asked, answer, null);
}

/** probe402's answer for each of the routes these tests use, from the recorded bytes. */
async function answering(): Promise<{ ask: (url: string) => Promise<CheckResult>; asked: string[] }> {
  const asked: string[] = [];
  const answers = new Map<string, CheckResult>([
    [PAID, await recorded("grade-ep_67bec7d9e13ef185.json", PAID)],
    [NEVER_ANSWERED, await recorded("grade-ep_4d864a69497e351a.json", NEVER_ANSWERED)],
  ]);
  return {
    asked,
    ask: async (url: string) => {
      asked.push(url);
      const answer = answers.get(url);
      if (answer === undefined) throw new Error(`no recorded answer for ${url}`);
      return answer;
    },
  };
}

function challengeBody(payTo: string, amount: string): string {
  return JSON.stringify({
    x402Version: 2,
    resource: { url: PAID },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount, asset: USDC_ON_BASE, payTo, maxTimeoutSeconds: 60, extra: {} }],
  });
}

/** The endpoint: a 402 until a payment header arrives, then 200. It records what it was sent. */
function origin(body: string): { fetch: WrappedFetch; seen: Array<{ url: string; headers: Record<string, string> }> } {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl: WrappedFetch = async (input, init) => {
    const url = typeof input === "object" && input !== null && "url" in input ? input.url : String(input);
    const headers = new Headers(init?.headers ?? (typeof input === "object" && input !== null && "headers" in input ? (input.headers as HeadersInit) : undefined));
    seen.push({ url, headers: Object.fromEntries(headers.entries()) });
    if (headers.has("x-payment")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(body, { status: 402, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetchImpl, seen };
}

/** `@x402/fetch` 2.26.0's ordering, with a counter where the wallet would be. */
function payingV2(underlying: WrappedFetch, signed: { count: number }): WrappedFetch {
  return async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const cloned = request.clone();
    const response = await underlying(request);
    if (response.status !== 402) return response;
    const text = await response.text();
    const parsed = JSON.parse(text) as { accepts: unknown[] };
    assert.ok(Array.isArray(parsed.accepts), "the wrapper must still be able to read the 402 body");
    signed.count++;
    const paid = cloned.clone();
    paid.headers.set("X-PAYMENT", "a signature would go here");
    return underlying(paid);
  };
}

/** `x402-fetch` 1.2.0's ordering: a plain init, its own retry marker, and the same counter. */
function payingV1(underlying: WrappedFetch, signed: { count: number }): WrappedFetch {
  return async (input, init) => {
    const response = await underlying(input, init);
    if (response.status !== 402) return response;
    const parsed = (await response.json()) as { accepts: unknown[] };
    assert.ok(Array.isArray(parsed.accepts), "the wrapper must still be able to read the 402 body");
    signed.count++;
    const newInit = { ...init, headers: { ...((init?.headers as Record<string, string>) ?? {}), "X-PAYMENT": "a signature would go here" }, __is402Retry: true };
    return underlying(input, newInit as RequestInit);
  };
}

test("the 402 is checked before the payment is created, and a clean record lets it through", async () => {
  for (const paying of [payingV2, payingV1]) {
    const { ask, asked } = await answering();
    const endpoint = origin(challengeBody("0x470a1b647d668d3820add26d70c8371557ff4c6b", "20000"));
    const decisions: HookDecision[] = [];
    const signed = { count: 0 };
    const response = await paying(wrapFetchWithCheck(endpoint.fetch, { ask, onDecision: (d) => decisions.push(d) }), signed)(PAID);

    assert.equal(response.status, 200);
    assert.equal(signed.count, 1, "the payment was created exactly once");
    assert.deepEqual(asked, [PAID], "probe402 was asked once, about the address being paid");
    assert.equal(decisions.length, 1, "the retry carrying the payment is not checked again");
    assert.equal(decisions[0]?.ruling, "allow");
    assert.deepEqual(decisions[0]?.comparison?.different, [], "the live 402 was compared with the recorded quote");
    assert.equal(decisions[0]?.challenge?.accepts.length, 1);
    assert.equal(endpoint.seen.length, 2, "the endpoint saw the challenge request and the paid one");
  }
});

test("🔴 a record of payments that never answered stops the payment BEFORE the signer", async () => {
  for (const paying of [payingV2, payingV1]) {
    const { ask, asked } = await answering();
    const endpoint = origin(challengeBody("0xa709b6534f392c5F4CfB986A329B734eCDdC8c6f", "2000"));
    const signed = { count: 0 };
    const wrapped = paying(wrapFetchWithCheck(endpoint.fetch, { ask }), signed);

    await assert.rejects(wrapped(NEVER_ANSWERED), (error: unknown) => {
      assert.ok(error instanceof PaymentBlocked, `a block throws PaymentBlocked, not ${String(error)}`);
      assert.equal(error.decision.ruling, "block");
      assert.match(error.message, /blocked a payment to https:\/\/5108-x402/);
      assert.match(error.decision.because, /never-observed-delivering/);
      assert.equal(error.decision.cite, "https://probe402.com/grade/ep_4d864a69497e351a");
      assert.ok(error.decision.facts.length > 3, "the decision carries the readings it stood on");
      return true;
    });
    assert.equal(signed.count, 0, "🔴 the signer was reached on a blocked payment");
    assert.deepEqual(asked, [NEVER_ANSWERED]);
    assert.equal(endpoint.seen.length, 1, "the endpoint was asked once and never paid");
  }
});

test("🔴 a rotated payment address in the live 402 blocks, and the same 402 unrotated does not", async () => {
  const { ask } = await answering();
  const signed = { count: 0 };
  const rotated = origin(challengeBody("0x0000000000000000000000000000000000000001", "20000"));
  await assert.rejects(payingV2(wrapFetchWithCheck(rotated.fetch, { ask }), signed)(PAID), (error: unknown) => {
    assert.ok(error instanceof PaymentBlocked);
    assert.match(error.decision.because, /payment-address-differs/);
    return true;
  });
  assert.equal(signed.count, 0);

  const straight = origin(challengeBody("0x470a1b647d668d3820add26d70c8371557ff4c6b", "20000"));
  const response = await payingV2(wrapFetchWithCheck(straight.fetch, { ask }), signed)(PAID);
  assert.equal(response.status, 200);
  assert.equal(signed.count, 1, "only the rotated address was stopped");
});

test("a warning is written and the payment goes ahead", async () => {
  const { ask } = await answering();
  const lines: string[] = [];
  const signed = { count: 0 };
  const endpoint = origin(challengeBody("0x470a1b647d668d3820add26d70c8371557ff4c6b", "999999"));
  const response = await payingV2(wrapFetchWithCheck(endpoint.fetch, { ask, warn: (line) => lines.push(line) }), signed)(PAID);
  assert.equal(response.status, 200);
  assert.equal(signed.count, 1, "a warning does not stop a payment");
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /^probe402-check WARN https:\/\/datastand\.dev\/api\/data\/dev-signals — quote-differs: /);
  assert.match(lines[0] ?? "", /Cite https:\/\/probe402\.com\/grade\/ep_67bec7d9e13ef185$/);
});

test("the caller's request reaches the caller's endpoint unchanged, and no header is added on the way", async () => {
  const { ask } = await answering();
  const endpoint = origin(challengeBody("0x470a1b647d668d3820add26d70c8371557ff4c6b", "20000"));
  const checked = wrapFetchWithCheck(endpoint.fetch, { ask });
  await checked(PAID, { headers: { "x-caller": "mine", accept: "application/json" } });
  assert.equal(endpoint.seen.length, 1);
  assert.deepEqual(endpoint.seen[0]?.headers, { "x-caller": "mine", accept: "application/json" }, "the hook must not touch the request");
  assert.equal(endpoint.seen[0]?.url, PAID);
});

test("anything that is not a 402 is passed straight back, with probe402 never asked", async () => {
  const { ask, asked } = await answering();
  const answersOk: WrappedFetch = async () => new Response("hello", { status: 200 });
  const response = await wrapFetchWithCheck(answersOk, { ask })(PAID);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "hello", "the body was not consumed on the way through");
  assert.deepEqual(asked, []);

  const answersError: WrappedFetch = async () => new Response("no", { status: 500 });
  assert.equal((await wrapFetchWithCheck(answersError, { ask })(PAID)).status, 500);
  assert.deepEqual(asked, []);
});

test("🔴 a request that already carries a payment is the wrapper's retry, and is not checked again", async () => {
  const { ask, asked } = await answering();
  const stays402: WrappedFetch = async () => new Response(challengeBody("0x470a1b647d668d3820add26d70c8371557ff4c6b", "20000"), { status: 402 });
  const checked = wrapFetchWithCheck(stays402, { ask });

  // Both markers the two published wrappers use, and both ways a header can arrive.
  await checked(PAID, { headers: { "X-PAYMENT": "already paid" } });
  await checked(new Request(PAID, { headers: { "payment-signature": "already paid" } }));
  await checked(PAID, { __is402Retry: true } as RequestInit);
  assert.deepEqual(asked, [], "a retry carrying a payment must not be checked again");

  // And the same 402 WITHOUT the marker is checked, so the skip is about the payment and not the URL.
  await checked(PAID);
  assert.deepEqual(asked, [PAID]);
});

test("probe402 being unreachable warns, and the payment is the caller's to make", async () => {
  const lines: string[] = [];
  const signed = { count: 0 };
  const endpoint = origin(challengeBody("0x470a1b647d668d3820add26d70c8371557ff4c6b", "20000"));
  const ask = async (): Promise<CheckResult> => {
    throw new Error("fetch failed");
  };
  const decisions: HookDecision[] = [];
  const response = await payingV2(wrapFetchWithCheck(endpoint.fetch, { ask, warn: (line) => lines.push(line), onDecision: (d) => decisions.push(d) }), signed)(PAID);
  assert.equal(response.status, 200);
  assert.equal(signed.count, 1);
  assert.equal(decisions[0]?.ruling, "warn");
  assert.equal(decisions[0]?.result, null);
  assert.match(lines[0] ?? "", /record-unavailable: probe402 could not be asked: fetch failed/);
});

test("a 402 whose body is not an x402 challenge is said so, and the record is still read", async () => {
  const { ask } = await answering();
  const decisions: HookDecision[] = [];
  const html: WrappedFetch = async () => new Response("<html>payment required</html>", { status: 402 });
  await wrapFetchWithCheck(html, { ask, onDecision: (d) => decisions.push(d), warn: () => undefined })(PAID);
  assert.equal(decisions[0]?.challenge, null);
  assert.equal(decisions[0]?.comparison, null);
  assert.equal(decisions[0]?.ruling, "allow", "a body we cannot read is our limit, not a finding about the endpoint");
  assert.ok(
    decisions[0]?.facts.some((fact) => /could not be read as an x402 payment requirement/.test(fact.fact)),
    "the facts must say the live quote was not compared",
  );
});
