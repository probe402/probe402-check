/**
 * THE FACTS A VERDICT STOOD ON.
 *
 * A one-line verdict is readable and is not auditable: it does not say which reading, taken when, it
 * rests on. So every result carries `facts` as well — each a sentence, the date it stands on, and
 * the grade address that holds it. An agent can put them in its own reasoning; a person can run
 * `probe402-check <url> --explain` and read them; either can follow the citation and check.
 *
 * A fact here is a reading of probe402's record and never a conclusion about an endpoint. Where the
 * record holds nothing, the absence is itself a fact and is stated as probe402's, with no date —
 * because "probe402 has not paid this route" has no date, and pretending otherwise would be a
 * measurement we do not have.
 */
import type { CheckResult, RouteResult } from "./check.ts";

export type Fact = {
  /** The sentence. */
  fact: string;
  /** The instant the fact stands at, `null` when the fact is an absence and has no instant. */
  as_of: string | null;
  /** The published address that holds it, `null` when the answer names no route. */
  cite: string | null;
};

/** Every fact the result rests on, in the order a reader would want them. */
export function factsOf(result: CheckResult): Fact[] {
  if (result.kind === "host") {
    return [
      {
        fact: `${result.host} has ${result.counts.routes} route(s) on probe402's list; ${result.counts.on_panel} on its paid panel and ${result.counts.paid} paid by it. This address names a host, so no route is graded here.`,
        as_of: null,
        cite: null,
      },
    ];
  }
  if (result.kind === "not-on-record") {
    return [
      {
        fact: `probe402 holds no record of ${result.asked} (${result.reason ?? result.answer_kind}). That is a fact about probe402's coverage, not about the endpoint.`,
        as_of: null,
        cite: null,
      },
    ];
  }
  return routeFacts(result);
}

function routeFacts(result: RouteResult): Fact[] {
  const cite = result.cite;
  const out: Fact[] = [];
  const reading = result.reading;
  if (reading === null) {
    out.push({ fact: `probe402 holds ${result.endpoint.label} on its list and has no reading of it in the graded window.`, as_of: result.window.to, cite });
  } else {
    const cadence =
      reading.past_cadence === null
        ? ""
        : reading.past_cadence
          ? `, which is past the ${result.endpoint.cadence ?? "route's own"} cadence it is read on`
          : `, inside the ${result.endpoint.cadence ?? "route's own"} cadence it is read on`;
    out.push({
      fact: `probe402's newest reading of ${result.endpoint.label} was graded "${reading.outcome}". It is ${reading.age} old${cadence}.`,
      as_of: reading.observed_at,
      cite,
    });
    if (result.quote !== null) {
      out.push({
        fact:
          `At that reading the route was asking for ${result.quote.amount_atomic ?? "an amount probe402 did not record"} atomic units of ` +
          `${result.quote.asset ?? "an asset probe402 did not record"} on ${result.quote.network ?? "a network probe402 did not record"}, ` +
          `payable to ${result.quote.pay_to ?? "an address probe402 did not record"}.`,
        as_of: reading.observed_at,
        cite,
      });
    }
  }
  if (result.window.observations !== null && result.window.observations > 0) {
    const changes = result.window.quote_changes === null ? "an unrecorded number of" : `${result.window.quote_changes}`;
    out.push({
      fact: `probe402 holds ${result.window.observations} reading(s) of this route in the graded window of ${result.window.days ?? "the published"} days, in which the quote changed ${changes} time(s).`,
      as_of: result.window.to,
      cite,
    });
  }
  if (result.window.absences_filed !== null && result.window.absences_filed > 0) {
    out.push({
      fact: `probe402 filed ${result.window.absences_filed} absence(s) of its own in that window — times it did not look, recorded as its own gap rather than as the route's.`,
      as_of: result.window.to,
      cite,
    });
  }
  for (const attempt of result.paid_delivery.attempts) {
    out.push({ fact: `probe402 paid this route and graded what came back "${attempt.outcome}".`, as_of: attempt.attempted_at, cite });
  }
  if (result.paid_delivery.attempts.length === 0) {
    out.push({
      fact: result.paid_delivery.on_panel
        ? "This route is on probe402's paid panel and has no paid attempt on the record yet, so probe402 holds no paid-delivery reading of it."
        : "probe402 has not paid this route: it is not on the paid panel, so probe402 holds no paid-delivery reading of it.",
      as_of: null,
      cite,
    });
  }
  if (result.held_quote !== null) {
    const held = result.held_quote;
    out.push({
      fact:
        held.different.length === 0
          ? `The payment request compared against this reading matches the recorded quote on ${held.same.join(", ")}.`
          : `The payment request compared against this reading differs from the recorded quote on ${held.different.join(", ")}.`,
      as_of: result.reading?.observed_at ?? null,
      cite,
    });
  }
  return out;
}

/** The facts as lines, one per fact, with its date and its citation. */
export function renderFacts(facts: readonly Fact[]): string {
  return facts
    .map((fact) => {
      const when = fact.as_of === null ? "no date — an absence" : fact.as_of;
      const where = fact.cite === null ? "" : `\n      cite: ${fact.cite}`;
      return `  - ${fact.fact}\n      as of: ${when}${where}`;
    })
    .join("\n");
}
