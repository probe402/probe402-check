/**
 * THE SIGNALS AND THE POLICY, DRIVEN BY RECORDED ANSWERS.
 *
 * Every route below is a real route on probe402's list and every answer is the bytes probe402.com
 * served for it, recorded through this package's own door (`test/fixtures/README.md`). That matters
 * here more than anywhere else in this repository: the two signals that BLOCK are read off graded
 * words probe402 actually published, and a fixture written by hand would let this file agree with
 * itself about a vocabulary the surface does not use.
 *
 * The three cases the table turns on, and the fixture each is:
 *   - paid and answered           → `grade-ep_67bec7d9e13ef185.json`  → nothing raised
 *   - paid, and never answered    → `grade-ep_4d864a69497e351a.json`  → `never-observed-delivering`
 *   - on the panel, never settled → `grade-ep_2ad33c17afc373f4.json`  → `newest-paid-attempt-refused`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { readAnswer, type CheckResult, type RouteResult } from "../src/check.ts";
import { compareChallenge, readChallenge } from "../src/challenge.ts";
import {
  DEFAULT_POLICY,
  DELIVERED_OUTCOMES,
  MONEY_MOVED_OUTCOMES,
  NOTHING_PAID_OUTCOMES,
  UNCORROBORATED_OUTCOMES,
  decide,
  recordUnavailable,
  rule,
  signalsOf,
  type SignalName,
} from "../src/policy.ts";

async function answer(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
}

async function result(fixture: string, asked: string): Promise<CheckResult> {
  return readAnswer(asked, await answer(fixture), null);
}

function names(signals: ReadonlyArray<{ name: SignalName }>): SignalName[] {
  return signals.map((signal) => signal.name).sort();
}

test("the table is total over the signal names, and two rows block", () => {
  const rulings = Object.values(DEFAULT_POLICY);
  assert.equal(rulings.length, 13, "a signal added without a default would be graded `undefined`");
  assert.deepEqual(
    Object.entries(DEFAULT_POLICY).filter(([, ruling]) => ruling === "block").map(([name]) => name).sort(),
    ["never-observed-delivering", "payment-address-differs"],
  );
  assert.ok(rulings.every((ruling) => ruling === "allow" || ruling === "warn" || ruling === "block"));
  // The vocabulary is probe402's published one, and the four classes do not overlap.
  const all = [...DELIVERED_OUTCOMES, ...NOTHING_PAID_OUTCOMES, ...UNCORROBORATED_OUTCOMES];
  assert.equal(new Set(all).size, all.length);
  assert.ok(DELIVERED_OUTCOMES.every((word) => MONEY_MOVED_OUTCOMES.includes(word)), "a word that answered is a word that moved money");
  assert.ok(!MONEY_MOVED_OUTCOMES.some((word) => NOTHING_PAID_OUTCOMES.includes(word)));
});

test("paid and answered: no signal, and the ruling is allow", async () => {
  const route = await result("grade-ep_67bec7d9e13ef185.json", "ep_67bec7d9e13ef185");
  assert.deepEqual(signalsOf(route, null), []);
  const decision = decide(route, null);
  assert.equal(decision.ruling, "allow");
  assert.equal(decision.cite, "https://probe402.com/grade/ep_67bec7d9e13ef185");
  assert.match(decision.because, /raised nothing this policy acts on/);
});

test("🔴 paid twice and never answered: never-observed-delivering, and it BLOCKS by default", async () => {
  const route = (await result("grade-ep_4d864a69497e351a.json", "ep_4d864a69497e351a")) as RouteResult;
  // The premise: this really is a route probe402 paid, whose every graded word says money moved.
  assert.equal(route.paid_delivery.attempts.length, 2);
  assert.ok(route.paid_delivery.attempts.every((attempt) => MONEY_MOVED_OUTCOMES.includes(attempt.outcome)));
  assert.ok(!route.paid_delivery.attempts.some((attempt) => DELIVERED_OUTCOMES.includes(attempt.outcome)));

  const signals = signalsOf(route, null);
  assert.deepEqual(names(signals), ["never-observed-delivering"]);
  assert.equal(signals[0]?.as_of, "2026-09-16T17:07:52.903Z");
  assert.match(signals[0]?.because ?? "", /paid this route 2 time\(s\) and no attempt came back with an answer/);
  assert.equal(decide(route, null).ruling, "block");

  // The caller's policy is the caller's: one line turns it into a warning.
  assert.equal(decide(route, null, { "never-observed-delivering": "warn" }).ruling, "warn");
  assert.equal(decide(route, null, { "never-observed-delivering": "allow" }).ruling, "allow");
});

test("on the panel and never settled: the refusal is raised, and it does not block", async () => {
  const route = (await result("grade-ep_2ad33c17afc373f4.json", "ep_2ad33c17afc373f4")) as RouteResult;
  assert.equal(route.paid_delivery.on_panel, true);
  assert.equal(route.paid_delivery.last_paid_at, null, "nothing was paid, so there is no last-paid date");
  assert.ok(route.paid_delivery.attempts.every((attempt) => NOTHING_PAID_OUTCOMES.includes(attempt.outcome)));

  const signals = signalsOf(route, null);
  assert.deepEqual(names(signals), ["newest-paid-attempt-refused"]);
  assert.equal(decide(route, null).ruling, "warn");
  // 🔴 Nothing was paid, so probe402 has not observed a payment fail to deliver here.
  assert.ok(!names(signals).includes("never-observed-delivering"), "a refusal before settlement is not a delivery reading");
});

test("a route probe402 has not paid raises its own absence, and it does not block", async () => {
  const route = (await result("grade-ep_e68279cac4e97ffb.json", "ep_e68279cac4e97ffb")) as RouteResult;
  assert.equal(route.paid_delivery.attempts.length, 0);
  assert.deepEqual(names(signalsOf(route, null)), ["never-paid"]);
  assert.equal(decide(route, null).ruling, "warn");
  assert.match(signalsOf(route, null)[0]?.because ?? "", /it is not on the paid panel, so there is no paid-delivery reading/);
});

test("a host and an address not on the record each raise one signal, and neither blocks", async () => {
  const host = await result("grade-host-api.myceliasignal.com.json", "https://api.myceliasignal.com");
  assert.deepEqual(names(signalsOf(host, null)), ["host-not-route"]);
  assert.equal(decide(host, null).ruling, "warn");
  assert.equal(decide(host, null).cite, null);

  const unknown = await result("grade-not-covered.json", "https://example.com/nothing-here");
  assert.deepEqual(names(signalsOf(unknown, null)), ["not-on-record"]);
  assert.equal(decide(unknown, null).ruling, "warn");
  assert.match(signalsOf(unknown, null)[0]?.because ?? "", /says nothing about the endpoint/);
});

test("🔴 a rotated payment address blocks, and any other difference warns", async () => {
  const route = (await result("grade-ep_67bec7d9e13ef185.json", "ep_67bec7d9e13ef185")) as RouteResult;
  const base = { scheme: "exact", network: "eip155:8453", amount: route.quote?.amount_atomic, asset: route.quote?.asset, payTo: route.quote?.pay_to, maxTimeoutSeconds: 60 };

  const rotated = compareChallenge(readChallenge({ x402Version: 2, accepts: [{ ...base, payTo: "0x0000000000000000000000000000000000000001" }] })!, route.quote);
  assert.deepEqual(names(signalsOf(route, rotated)), ["payment-address-differs"]);
  assert.equal(decide(route, rotated).ruling, "block");

  const raised = compareChallenge(readChallenge({ x402Version: 2, accepts: [{ ...base, amount: "2000000" }] })!, route.quote);
  assert.deepEqual(names(signalsOf(route, raised)), ["quote-differs"]);
  assert.equal(decide(route, raised).ruling, "warn");

  const matching = compareChallenge(readChallenge({ x402Version: 2, accepts: [base] })!, route.quote);
  assert.deepEqual(signalsOf(route, matching), [], "a 402 that matches the record raises nothing");
});

test("probe402 being unreachable warns and never blocks: our outage is not their endpoint", () => {
  const decision = rule([recordUnavailable("fetch failed")]);
  assert.equal(decision.ruling, "warn");
  assert.match(decision.because, /probe402 could not be asked: fetch failed/);
  assert.equal(DEFAULT_POLICY["record-unavailable"], "warn");
});

test("the loudest signal decides, and every signal travels with its own ruling", async () => {
  const route = (await result("grade-ep_4d864a69497e351a.json", "ep_4d864a69497e351a")) as RouteResult;
  const rotated = compareChallenge(
    readChallenge({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1", asset: route.quote?.asset, payTo: "0x0000000000000000000000000000000000000001" }] })!,
    route.quote,
  );
  const decision = decide(route, rotated, { "never-observed-delivering": "warn" });
  assert.equal(decision.ruling, "block", "payment-address-differs still blocks when the other row is softened");
  assert.deepEqual(names(decision.signals), ["never-observed-delivering", "payment-address-differs", "quote-differs"]);
  assert.deepEqual(decision.signals.map((signal) => signal.ruling), ["block", "warn", "warn"], "loudest first");
  assert.equal(decision.because.includes("never-observed-delivering"), false, "the reason names the signals that decided it");
  assert.match(decision.because, /^payment-address-differs: /);
});

test("a graded word this version does not know is said so, and is not read as delivery either way", async () => {
  const route = (await result("grade-ep_4d864a69497e351a.json", "ep_4d864a69497e351a")) as RouteResult;
  const invented: RouteResult = {
    ...route,
    paid_delivery: { ...route.paid_delivery, attempts: [{ attempted_at: "2026-09-16T17:07:52.903Z", outcome: "Grade nobody has written yet" }], newest: { attempted_at: "2026-09-16T17:07:52.903Z", outcome: "Grade nobody has written yet" } },
  };
  assert.deepEqual(names(signalsOf(invented, null)), ["paid-word-not-known"]);
  assert.equal(decide(invented, null).ruling, "warn");
  assert.ok(!names(signalsOf(invented, null)).includes("never-observed-delivering"), "an unread word is not a failure to deliver");

  const uncorroborated: RouteResult = {
    ...route,
    paid_delivery: { ...route.paid_delivery, attempts: [{ attempted_at: "2026-09-16T17:07:52.903Z", outcome: UNCORROBORATED_OUTCOMES[0]! }], newest: null },
  };
  assert.deepEqual(names(signalsOf(uncorroborated, null)), ["settlement-not-corroborated"]);
});
