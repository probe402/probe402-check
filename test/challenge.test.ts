/**
 * THE 402 READ OFF THE WIRE, AND COMPARED WITH THE RECORD.
 *
 * The two challenge bodies here are the shapes the published packages produce — `x402-fetch` 1.2.0
 * (`maxAmountRequired`, a network NAME) and `@x402/fetch` 2.26.0 (`amount`, CAIP-2, a `resource`
 * object) — taken from those packages' own type declarations rather than written from memory.
 *
 * The property that matters is the one a wrong answer would break quietly: a field must read
 * `different` ONLY when the two sides could be put side by side and were not equal. A network the
 * code has no way to line up reads `not-compared`, and a `not-compared` field never raises a signal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { readAnswer, type RouteResult } from "../src/check.ts";
import { caip2Of, compareChallenge, readChallenge, EVM_NETWORK_NAMES } from "../src/challenge.ts";

const USDC_ON_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** The 402 body `x402-fetch` 1.2.0 parses: `maxAmountRequired`, and `network` as a name. */
const V1_BODY = {
  x402Version: 1,
  accepts: [
    {
      scheme: "exact",
      network: "base",
      maxAmountRequired: "20000",
      resource: "https://datastand.dev/api/data/dev-signals",
      description: "",
      mimeType: "application/json",
      outputSchema: {},
      payTo: "0x470A1B647D668D3820ADD26D70C8371557FF4C6B",
      maxTimeoutSeconds: 60,
      asset: USDC_ON_BASE,
      extra: {},
    },
  ],
};

/** The 402 body `@x402/fetch` 2.26.0 parses: `amount`, CAIP-2, and a `resource` object. */
const V2_BODY = {
  x402Version: 2,
  resource: { url: "https://datastand.dev/api/data/dev-signals" },
  accepts: [
    { scheme: "exact", network: "eip155:8453", amount: "20000", asset: USDC_ON_BASE, payTo: "0x470a1b647d668d3820add26d70c8371557ff4c6b", maxTimeoutSeconds: 60, extra: {} },
  ],
};

async function recordedRoute(): Promise<RouteResult> {
  const answer = JSON.parse(await readFile(new URL("./fixtures/grade-ep_67bec7d9e13ef185.json", import.meta.url), "utf8")) as Record<string, unknown>;
  return readAnswer("ep_67bec7d9e13ef185", answer, null) as RouteResult;
}

test("a v1 challenge and a v2 challenge read into the same ways to pay", () => {
  const v1 = readChallenge(V1_BODY);
  const v2 = readChallenge(V2_BODY);
  assert.notEqual(v1, null);
  assert.notEqual(v2, null);
  assert.equal(v1!.x402_version, 1);
  assert.equal(v2!.x402_version, 2);
  assert.equal(v1!.resource, "https://datastand.dev/api/data/dev-signals");
  assert.equal(v2!.resource, "https://datastand.dev/api/data/dev-signals");
  assert.deepEqual(v1!.accepts[0], {
    scheme: "exact",
    network: "eip155:8453",
    network_as_served: "base",
    amount_atomic: "20000",
    asset: USDC_ON_BASE,
    pay_to: "0x470A1B647D668D3820ADD26D70C8371557FF4C6B",
    max_timeout_s: 60,
  });
  assert.equal(v2!.accepts[0]?.network, "eip155:8453");
  assert.equal(v2!.accepts[0]?.network_as_served, "eip155:8453");
  assert.equal(v2!.accepts[0]?.amount_atomic, "20000");
  // A body that is not an x402 challenge is not read as an empty one.
  assert.equal(readChallenge({ error: "payment required" }), null);
  assert.equal(readChallenge("payment required"), null);
  assert.equal(readChallenge(null), null);
});

test("the network names come from the published package, and a name with no chain is not invented", () => {
  assert.equal(caip2Of("base"), "eip155:8453");
  assert.equal(caip2Of("base-sepolia"), "eip155:84532");
  assert.equal(caip2Of("EIP155:8453"), "eip155:8453");
  assert.equal(caip2Of("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"), "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  assert.equal(caip2Of("a-chain-nobody-named"), null);
  assert.equal(caip2Of(""), null);
  assert.equal(caip2Of(null), null);
  assert.equal(EVM_NETWORK_NAMES.length, 15, "the table is the published one; a row added here is a row added there");
  assert.deepEqual(EVM_NETWORK_NAMES.find(([name]) => name === "base"), ["base", 8453]);
});

test("the recorded quote against a matching 402: every field the same, whatever the spelling", async () => {
  const route = await recordedRoute();
  for (const body of [V1_BODY, V2_BODY]) {
    const comparison = compareChallenge(readChallenge(body)!, route.quote);
    assert.deepEqual(comparison.fields, { pay_to: "same", amount_atomic: "same", network: "same", asset: "same", scheme: "same" });
    assert.deepEqual(comparison.different, []);
    assert.deepEqual(comparison.not_compared, []);
    assert.equal(comparison.pay_to_differs, false);
    assert.equal(comparison.offered, 1);
    assert.equal(comparison.matching?.amount_atomic, "20000");
  }
});

test("RED: a rotated payment address, and a raised amount, each read as different and nothing else does", async () => {
  const route = await recordedRoute();
  const rotated = readChallenge({ ...V2_BODY, accepts: [{ ...V2_BODY.accepts[0], payTo: "0x0000000000000000000000000000000000000001" }] })!;
  const comparison = compareChallenge(rotated, route.quote);
  assert.equal(comparison.pay_to_differs, true);
  assert.deepEqual(comparison.different, ["pay_to"]);
  assert.equal(comparison.matching, null);

  const raised = readChallenge({ ...V2_BODY, accepts: [{ ...V2_BODY.accepts[0], amount: "2000000" }] })!;
  const raisedComparison = compareChallenge(raised, route.quote);
  assert.deepEqual(raisedComparison.different, ["amount_atomic"]);
  assert.equal(raisedComparison.pay_to_differs, false);
});

test("several ways to pay: the recorded one being among them is a match, and its absence is not", async () => {
  const route = await recordedRoute();
  const other = { ...V2_BODY.accepts[0], payTo: "0x0000000000000000000000000000000000000002", amount: "999" };
  const both = readChallenge({ ...V2_BODY, accepts: [other, V2_BODY.accepts[0]] })!;
  const comparison = compareChallenge(both, route.quote);
  assert.equal(comparison.offered, 2);
  assert.deepEqual(comparison.different, []);
  assert.equal(comparison.matching?.pay_to, "0x470a1b647d668d3820add26d70c8371557ff4c6b");

  const neither = readChallenge({ ...V2_BODY, accepts: [other] })!;
  assert.deepEqual(compareChallenge(neither, route.quote).different, ["pay_to", "amount_atomic"]);
});

test("🔴 a field that cannot be put side by side reads not-compared, never different", async () => {
  const route = await recordedRoute();
  // A network spelling with no chain behind it: we cannot say it is the recorded one and we cannot
  // say it is not. The same is true of a field the challenge does not carry at all.
  const strange = readChallenge({ x402Version: 2, accepts: [{ network: "a-chain-nobody-named", payTo: route.quote?.pay_to, amount: "20000", asset: USDC_ON_BASE }] })!;
  const comparison = compareChallenge(strange, route.quote);
  assert.equal(comparison.fields.network, "not-compared", "an unlineable network must not be read as a difference");
  assert.equal(comparison.fields.scheme, "not-compared", "a field the challenge does not carry must not be read as a difference");
  assert.deepEqual(comparison.different, []);
  assert.deepEqual(comparison.not_compared, ["network", "scheme"]);

  // And with nothing recorded on our side, every field is not-compared rather than different.
  const nothingRecorded = compareChallenge(readChallenge(V2_BODY)!, null);
  assert.deepEqual(nothingRecorded.different, []);
  assert.deepEqual(nothingRecorded.not_compared, ["pay_to", "amount_atomic", "network", "asset", "scheme"]);
  assert.equal(nothingRecorded.pay_to_differs, false);
});

test("amounts are compared as integers and addresses case-folded, so a spelling is not a difference", async () => {
  const route = await recordedRoute();
  const spelled = readChallenge({
    ...V2_BODY,
    accepts: [{ ...V2_BODY.accepts[0], amount: "020000", payTo: "0x470A1B647D668D3820ADD26D70C8371557FF4C6B", asset: USDC_ON_BASE.toUpperCase(), scheme: "EXACT" }],
  })!;
  assert.deepEqual(compareChallenge(spelled, route.quote).different, []);
});
