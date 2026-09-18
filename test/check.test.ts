/**
 * THE CHECK, DRIVEN WITH RECORDED ANSWERS. Every fixture under `test/fixtures/` is a real response
 * of probe402.com recorded on 2026-09-17 (see `test/fixtures/README.md`); nothing here is
 * hand-built, so the reader is exercised on the shapes the surface actually serves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { ageWords, checkBeforePaying, compareHeldQuote, readAnswer, type RouteResult } from "../src/check.ts";
import { gradeByIdUrl, gradeByUrlUrl, type Fetch } from "../src/public-surfaces.ts";

async function fixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
}

function answering(routes: Record<string, string>): { fetch: Fetch; requested: string[] } {
  const requested: string[] = [];
  const fetch: Fetch = async (url) => {
    requested.push(url);
    const file = routes[url];
    if (file === undefined) return new Response("not routed", { status: 599 });
    return new Response(await readFile(new URL(`./fixtures/${file}`, import.meta.url)), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, requested };
}

test("a paid panel route: quoting, the recorded quote, the paid attempt, the age, the cite", async () => {
  const routes = { [gradeByIdUrl("ep_67bec7d9e13ef185")]: "grade-ep_67bec7d9e13ef185.json" };
  const { fetch, requested } = answering(routes);
  const result = await checkBeforePaying({ url: "ep_67bec7d9e13ef185" }, { fetch });
  assert.deepEqual(requested, [gradeByIdUrl("ep_67bec7d9e13ef185")], "one request, to the grade by id");
  assert.equal(result.kind, "route");
  const r = result as RouteResult;
  assert.equal(r.endpoint.label, "datastand.dev GET /api/data/dev-signals");
  assert.equal(r.endpoint.cadence, "daily");
  assert.equal(r.reading?.outcome, "Quoted");
  assert.equal(r.reading?.observed_at, "2026-09-17T02:32:23.121Z");
  assert.equal(r.reading?.past_cadence, false);
  assert.equal(r.reading?.age, "9.4 hours");
  assert.deepEqual(r.quote, {
    scheme: "exact",
    network: "eip155:8453",
    amount_atomic: "20000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    pay_to: "0x470a1b647d668d3820add26d70c8371557ff4c6b",
    max_timeout_s: 120,
  });
  assert.equal(r.window.days, 7);
  assert.equal(r.window.observations, 7);
  assert.equal(r.window.quote_changes, 0);
  assert.equal(r.window.absences_filed, 0);
  assert.deepEqual(r.window.by_outcome, { Quoted: 7 });
  assert.equal(r.paid_delivery.on_panel, true);
  assert.equal(r.paid_delivery.last_paid_at, "2026-09-16T17:24:16.130Z");
  assert.equal(r.paid_delivery.attempts.length, 2);
  assert.deepEqual(r.paid_delivery.newest, { attempted_at: "2026-09-16T17:24:16.130Z", outcome: "Settled and answered" });
  assert.equal(r.paid_delivery.record_source, "projection");
  assert.equal(r.held_quote, null);
  assert.equal(r.cite, "https://probe402.com/grade/ep_67bec7d9e13ef185");
  assert.equal(r.method, "https://probe402.com/method");
  assert.match(r.verdict, /^datastand\.dev GET \/api\/data\/dev-signals was quoting 20000 atomic units of 0x8335.* on eip155:8453 to 0x470a1b647d668d3820add26d70c8371557ff4c6b as of 2026-09-17T02:32:23\.121Z \(9\.4 hours ago, inside its daily cadence\)\./);
  assert.match(r.verdict, /The quote did not change across 7 reading\(s\) in 7 days\./);
  assert.match(r.verdict, /probe402 paid this route on 2026-09-16T17:24:16\.130Z and graded the result "Settled and answered"\./);
  assert.match(r.verdict, /Cite https:\/\/probe402\.com\/grade\/ep_67bec7d9e13ef185\.$/);
});

test("a held 402 is compared with the recorded quote: same, then a rotated payment address", async () => {
  const answer = await fixture("grade-ep_67bec7d9e13ef185.json");
  const same = readAnswer("ep_67bec7d9e13ef185", answer, {
    pay_to: "0x470A1B647D668D3820ADD26D70C8371557FF4C6B",
    amount_atomic: "020000",
    network: "eip155:8453",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    scheme: "EXACT",
  }) as RouteResult;
  assert.deepEqual(same.held_quote, { compared: ["pay_to", "amount_atomic", "network", "asset", "scheme"], same: ["pay_to", "amount_atomic", "network", "asset", "scheme"], different: [], pay_to_differs: false });
  assert.match(same.verdict, /The payment request you hold matches the recorded quote on pay_to, amount_atomic, network, asset, scheme\./);

  const rotated = readAnswer("ep_67bec7d9e13ef185", answer, { pay_to: "0x0000000000000000000000000000000000000001", amount_atomic: "20000" }) as RouteResult;
  assert.deepEqual(rotated.held_quote, { compared: ["pay_to", "amount_atomic"], same: ["amount_atomic"], different: ["pay_to"], pay_to_differs: true });
  assert.match(rotated.verdict, /DIFFERS from the recorded quote on pay_to \(the payment address is not the recorded one\)\./);

  // No recorded quote at all: every held field is a difference, not a match.
  assert.deepEqual(compareHeldQuote({ pay_to: "0x1" }, null), { compared: ["pay_to"], same: [], different: ["pay_to"], pay_to_differs: true });
});

test("a route on the list and not on the paid panel says so, with no paid attempt", async () => {
  const routes = { [gradeByUrlUrl("https://api.myceliasignal.com/oracle/price/btc/usd")]: "grade-ep_e68279cac4e97ffb.json" };
  const { fetch, requested } = answering(routes);
  const result = (await checkBeforePaying({ url: "https://api.myceliasignal.com/oracle/price/btc/usd" }, { fetch })) as RouteResult;
  assert.deepEqual(requested, [gradeByUrlUrl("https://api.myceliasignal.com/oracle/price/btc/usd")], "a URL is asked through grade-by-url");
  assert.equal(result.kind, "route");
  assert.equal(result.endpoint.id, "ep_e68279cac4e97ffb");
  assert.equal(result.paid_delivery.on_panel, false);
  assert.equal(result.paid_delivery.newest, null);
  assert.equal(result.paid_delivery.record_source, "none");
  assert.match(result.verdict, /probe402 has not paid this route: it is not on the paid panel, so there is no paid-delivery reading\./);
  assert.equal(result.cite, "https://probe402.com/grade/ep_e68279cac4e97ffb");
});

test("the second panel route reads its own quote and its own newest attempt", async () => {
  const result = readAnswer("ep_addf52df476011b1", await fixture("grade-ep_addf52df476011b1.json"), null) as RouteResult;
  assert.equal(result.quote?.pay_to, "0xD593832Ce9C2B13B192ba50B55dd9AF44e96700d");
  assert.equal(result.quote?.amount_atomic, "50000");
  assert.equal(result.paid_delivery.newest?.attempted_at, "2026-09-16T19:00:02.059Z");
  assert.equal(result.paid_delivery.newest?.outcome, "Settled and answered");
  assert.match(result.verdict, /api\.myceliasignal\.com GET \/oracle\/econ\/calendar\/fomc was quoting 50000 atomic units/);
});

test("a host URL answers the host's routes, each with its grade address and paid state, and grades nothing", async () => {
  const routes = { [gradeByUrlUrl("https://api.myceliasignal.com")]: "grade-host-api.myceliasignal.com.json" };
  const { fetch } = answering(routes);
  const result = await checkBeforePaying({ url: "https://api.myceliasignal.com" }, { fetch });
  assert.equal(result.kind, "host");
  if (result.kind !== "host") return;
  assert.equal(result.host, "api.myceliasignal.com");
  assert.equal(result.routes.length, 112);
  assert.deepEqual(result.counts, { routes: 112, on_panel: 2, paid: 2 });
  const btc = result.routes.find((r) => r.endpoint_id === "ep_e68279cac4e97ffb");
  assert.deepEqual(btc, {
    endpoint_id: "ep_e68279cac4e97ffb",
    method: "GET",
    path: "/oracle/price/btc/usd",
    probe_url: "https://api.myceliasignal.com/oracle/price/btc/usd",
    cadence: "daily",
    grade_url: "https://probe402.com/grade/ep_e68279cac4e97ffb",
    on_panel: false,
    last_paid_at: null,
    attempts: 0,
  });
  const fomc = result.routes.find((r) => r.endpoint_id === "ep_addf52df476011b1");
  assert.equal(fomc?.on_panel, true);
  assert.equal(fomc?.last_paid_at, "2026-09-16T19:00:02.059Z");
  assert.match(result.verdict, /^api\.myceliasignal\.com has 112 route\(s\) on probe402's list; 2 of them on the paid panel and 2 paid by probe402\. This address names a host, not a route, so nothing here grades anything/);
});

test("an address probe402 does not hold is not-on-record, and the answer says nothing about the endpoint", async () => {
  const result = readAnswer("https://example.com/nothing-here", await fixture("grade-not-covered.json"), null);
  assert.equal(result.kind, "not-on-record");
  if (result.kind !== "not-on-record") return;
  assert.equal(result.answer_kind, "not-covered");
  assert.equal(result.reason, "not-in-seed-list");
  assert.match(result.statement ?? "", /statement about our coverage/);
  assert.match(result.verdict, /^probe402 holds no record of https:\/\/example\.com\/nothing-here \(not-in-seed-list\)\. That is a fact about probe402's coverage and says nothing about the endpoint\. There is no reading to cite\.$/);
  assert.ok(!("covered_hosts" in result), "the host list in the answer is not carried into the result");
});

test("an answer that is not 200 is an error, not a reading", async () => {
  const fetch: Fetch = async () => new Response("slow down", { status: 429 });
  await assert.rejects(checkBeforePaying({ url: "ep_67bec7d9e13ef185" }, { fetch }), /HTTP 429/);
});

test("ages are said in the unit a reader would use", () => {
  assert.equal(ageWords(null), "an unknown time");
  assert.equal(ageWords(30), "1 minute(s)");
  assert.equal(ageWords(1800), "30 minute(s)");
  assert.equal(ageWords(33839), "9.4 hours");
  assert.equal(ageWords(3 * 86400), "3.0 days");
});

/**
 * 🔴 THE FACTS A VERDICT STOOD ON. A one-line verdict is readable and is not auditable. Every result
 * carries the readings underneath it, each with the instant it stands at and the address that holds
 * it, so a reader can follow one and check — which is the whole claim this tool makes for itself.
 *
 * The two properties worth a guard: a fact that carries a date carries a REAL one from the answer
 * (not the time the check ran), and an ABSENCE carries no date at all rather than a convenient one.
 */
test("every fact carries its own date and the address that holds it", async () => {
  const result = readAnswer("ep_67bec7d9e13ef185", await fixture("grade-ep_67bec7d9e13ef185.json"), { pay_to: "0x470a1b647d668d3820add26d70c8371557ff4c6b" }) as RouteResult;
  assert.ok(result.facts.length >= 5, `${result.facts.length} facts`);
  for (const fact of result.facts) {
    assert.equal(fact.cite, "https://probe402.com/grade/ep_67bec7d9e13ef185");
    assert.ok(fact.fact.length > 20);
    if (fact.as_of !== null) {
      assert.match(fact.as_of, /^2026-\d\d-\d\dT/, `a fact dated ${fact.as_of}`);
      assert.ok(Date.parse(fact.as_of) <= Date.parse(result.window.to ?? "2027-01-01"), "a fact cannot stand after the window it was read in");
    }
  }
  // The dates are the answer's own, not this run's.
  const dates = result.facts.map((fact) => fact.as_of).filter((date): date is string => date !== null);
  assert.ok(dates.includes("2026-09-17T02:32:23.121Z"), "the newest reading's own instant");
  assert.ok(dates.includes("2026-09-16T17:24:16.130Z"), "the paid attempt's own instant");
  assert.ok(!dates.some((date) => Date.parse(date) > Date.now() - 60_000), "a fact dated now is this run leaking into the record");
  assert.ok(result.facts.some((fact) => /"Settled and answered"/.test(fact.fact)));
  assert.ok(result.facts.some((fact) => /matches the recorded quote on pay_to/.test(fact.fact)));
});

test("🔴 an absence is a fact with no date, and says whose absence it is", async () => {
  const notPaid = readAnswer("ep_e68279cac4e97ffb", await fixture("grade-ep_e68279cac4e97ffb.json"), null) as RouteResult;
  const absence = notPaid.facts.find((fact) => /has not paid this route/.test(fact.fact));
  assert.notEqual(absence, undefined, "a route probe402 has not paid must say so as a fact");
  assert.equal(absence?.as_of, null, "an absence has no instant; a date here would be invented");
  assert.equal(absence?.cite, "https://probe402.com/grade/ep_e68279cac4e97ffb");

  const unknown = readAnswer("https://example.com/nothing-here", await fixture("grade-not-covered.json"), null);
  assert.equal(unknown.facts.length, 1);
  assert.equal(unknown.facts[0]?.as_of, null);
  assert.equal(unknown.facts[0]?.cite, null, "there is no route, so there is nothing to cite");
  assert.match(unknown.facts[0]?.fact ?? "", /fact about probe402's coverage, not about the endpoint/);
});

test("a route probe402 paid and that never answered says so once per payment", async () => {
  const result = readAnswer("ep_4d864a69497e351a", await fixture("grade-ep_4d864a69497e351a.json"), null) as RouteResult;
  const paid = result.facts.filter((fact) => /probe402 paid this route and graded what came back/.test(fact.fact));
  assert.equal(paid.length, 2, "two payments, two facts");
  assert.deepEqual(paid.map((fact) => fact.as_of), ["2026-09-09T10:09:07.732Z", "2026-09-16T17:07:52.903Z"]);
  assert.ok(paid.every((fact) => /"Settled, no answer"/.test(fact.fact)));
});
